import {
  confirm,
  intro,
  outro,
  password as passwordPrompt,
  select,
  spinner,
  text,
} from "@clack/prompts";
import type { EndpointProbeResult } from "@gambi/core/endpoint";
import { probeEndpoint } from "@gambi/core/endpoint";
import type {
  ParticipantAuthHeaders,
  ParticipantCapabilities,
  RuntimeConfig,
} from "@gambi/core/types";
import { HEALTH_CHECK_INTERVAL } from "@gambi/core/types";
import { nanoid } from "nanoid";
import {
  isLoopbackLikeHost,
  isRemoteHubUrl,
  listNetworkCandidates,
  rankNetworkCandidatesForHub,
  replaceEndpointHost,
} from "../utils/network-endpoint.ts";
import { Command, Option } from "../utils/option.ts";
import { handleCancel, isInteractive, LLM_PROVIDERS } from "../utils/prompt.ts";
import {
  type DiscoveredRoom,
  discoverRoomsOnNetwork,
} from "../utils/room-discovery.ts";
import {
  hasRuntimeConfig,
  loadRuntimeConfigFile,
  promptRuntimeConfig,
} from "../utils/runtime-config.ts";
import { detectSpecs, formatSpecs } from "../utils/specs.ts";

interface ErrorResponse {
  error: string;
}

interface JoinResponse {
  participant: {
    id: string;
    nickname: string;
    model: string;
    endpoint: string;
  };
  roomId: string;
}

interface JoinDraftInputs {
  authHeaders: ParticipantAuthHeaders;
  code: string;
  config: RuntimeConfig;
  hubUrl: string;
  localEndpoint: string;
  model: string;
  networkEndpoint: string | undefined;
  nickname: string | undefined;
  noNetworkRewrite: boolean;
  noSpecs: boolean;
  password: string | undefined;
}

interface JoinInputs {
  authHeaders: ParticipantAuthHeaders;
  capabilities: ParticipantCapabilities;
  code: string;
  config: RuntimeConfig;
  hubUrl: string;
  localEndpoint: string;
  model: string;
  nickname: string | undefined;
  noSpecs: boolean;
  password: string | undefined;
  publishedEndpoint: string;
}

interface ResolvePublishedEndpointParams {
  hubUrl: string;
  interactive: boolean;
  localEndpoint: string;
  networkEndpoint: string | undefined;
  noNetworkRewrite: boolean;
  stderr: NodeJS.WritableStream;
  stdout: NodeJS.WritableStream;
}

function parseHeaderAssignment(input: string): { name: string; value: string } {
  const separatorIndex = input.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === input.length - 1) {
    throw new Error(
      `Invalid header assignment '${input}'. Use the format Header=Value.`
    );
  }

  const name = input.slice(0, separatorIndex).trim();
  const value = input.slice(separatorIndex + 1).trim();
  if (!(name && value)) {
    throw new Error(
      `Invalid header assignment '${input}'. Header name and value are required.`
    );
  }

  return { name, value };
}

function resolveAuthHeaders(
  rawHeaders: string[],
  envHeaders: string[]
): ParticipantAuthHeaders {
  const authHeaders: ParticipantAuthHeaders = {};

  for (const header of rawHeaders) {
    const { name, value } = parseHeaderAssignment(header);
    authHeaders[name] = value;
  }

  for (const header of envHeaders) {
    const { name, value: envVar } = parseHeaderAssignment(header);
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(
        `Environment variable '${envVar}' is required for header '${name}'.`
      );
    }
    authHeaders[name] = envValue;
  }

  return authHeaders;
}

function getEndpointHost(endpoint: string): string {
  return new URL(endpoint).hostname;
}

function getRankedPublishedEndpoints(
  hubUrl: string,
  localEndpoint: string
): string[] {
  const rankedCandidates = rankNetworkCandidatesForHub(
    hubUrl,
    listNetworkCandidates()
  );
  const publishedEndpoints = rankedCandidates.map((candidate) =>
    replaceEndpointHost(localEndpoint, candidate.address)
  );

  return [...new Set(publishedEndpoints)];
}

function writeRemoteLoopbackExplanation(
  stdout: NodeJS.WritableStream,
  hubUrl: string,
  localEndpoint: string
): void {
  stdout.write("\n");
  stdout.write("Remote hub detected with a loopback endpoint.\n");
  stdout.write(`  Hub URL: ${hubUrl}\n`);
  stdout.write(`  Local endpoint: ${localEndpoint}\n`);
  stdout.write(
    "  localhost only works on your own machine, so the hub needs a network-reachable URL.\n\n"
  );
}

async function promptAuthHeaders(): Promise<ParticipantAuthHeaders> {
  const shouldAddHeaders = await confirm({
    message: "Does this endpoint require auth headers?",
    initialValue: false,
  });
  handleCancel(shouldAddHeaders);

  if (!shouldAddHeaders) {
    return {};
  }

  const authHeaders: ParticipantAuthHeaders = {};

  while (true) {
    const headerNameResult = await text({
      message: "Header name (leave empty to finish):",
      placeholder: "Authorization",
    });
    handleCancel(headerNameResult);

    const headerName = (headerNameResult as string).trim();
    if (!headerName) {
      return authHeaders;
    }

    const headerValueResult = await passwordPrompt({
      message: `Value for ${headerName}:`,
      validate: (value) =>
        value?.trim() ? undefined : "Header value is required",
    });
    handleCancel(headerValueResult);

    authHeaders[headerName] = (headerValueResult as string).trim();
  }
}

async function promptEndpoint(currentEndpoint: string): Promise<string> {
  if (currentEndpoint !== "http://localhost:11434") {
    return currentEndpoint;
  }

  const providerOptions = [
    ...LLM_PROVIDERS.map((provider) => ({
      value: `http://localhost:${provider.port}`,
      label: `${provider.name} (localhost:${provider.port})`,
    })),
    { value: "custom", label: "Custom URL" },
  ];

  const providerResult = await select({
    message: "LLM Provider:",
    options: providerOptions,
  });
  handleCancel(providerResult);

  if (providerResult === "custom") {
    const urlResult = await text({
      message: "Endpoint URL:",
      placeholder: "http://localhost:11434",
      validate: (value) => (value ? undefined : "Endpoint URL is required"),
    });
    handleCancel(urlResult);
    return urlResult as string;
  }

  return providerResult as string;
}

async function promptModels(
  endpoint: string,
  authHeaders: ParticipantAuthHeaders,
  stderr: NodeJS.WritableStream
): Promise<{ model: string; probe: EndpointProbeResult } | null> {
  const s = spinner();
  s.start("Detecting available models...");

  const probe = await probeEndpoint(endpoint, { authHeaders });

  if (probe.models.length === 0) {
    s.stop("No models found");
    stderr.write(`No models found at ${endpoint}\n`);
    stderr.write(
      "Make sure your LLM server is running and has models available.\n"
    );
    return null;
  }

  s.stop(`Found ${probe.models.length} model(s)`);

  const modelResult = await select({
    message: "Select model:",
    options: probe.models.map((model) => ({ value: model, label: model })),
  });
  handleCancel(modelResult);

  return { model: modelResult as string, probe };
}

function formatParticipantCount(count: number): string {
  return `${count} participant${count === 1 ? "" : "s"}`;
}

function formatDiscoveredRoomOption(room: DiscoveredRoom): string {
  return `${room.code} - ${room.name} - ${formatParticipantCount(room.participantCount)} - ${room.hubName}`;
}

async function promptManualRoomCode(seedHubUrl: string): Promise<{
  code: string;
  hubUrl: string;
}> {
  const codeResult = await text({
    message: "Room code:",
    validate: (value) => (value ? undefined : "Room code is required"),
  });
  handleCancel(codeResult);

  return {
    code: codeResult as string,
    hubUrl: seedHubUrl,
  };
}

async function promptRoomSelection(
  seedHubUrl: string,
  stdout: NodeJS.WritableStream
): Promise<{ code: string; hubUrl: string }> {
  const s = spinner();
  s.start("Detecting available rooms...");

  const rooms = await discoverRoomsOnNetwork({ seedHubUrl });
  if (rooms.length === 0) {
    s.stop("No rooms discovered automatically");
    stdout.write(
      "No rooms were found on the configured hub or local network.\n"
    );
    return promptManualRoomCode(seedHubUrl);
  }

  s.stop(`Found ${rooms.length} room(s)`);

  const roomResult = await select({
    message: "Select room:",
    options: [
      ...rooms.map((room) => ({
        value: room.id,
        label: formatDiscoveredRoomOption(room),
      })),
      { value: "__manual__", label: "Enter a room code manually" },
    ],
  });
  handleCancel(roomResult);

  if (roomResult === "__manual__") {
    return promptManualRoomCode(seedHubUrl);
  }

  const selectedRoom = rooms.find((room) => room.id === roomResult);
  if (!selectedRoom) {
    return promptManualRoomCode(seedHubUrl);
  }

  stdout.write(
    `Using discovered room ${selectedRoom.code} on hub ${selectedRoom.hubUrl}\n`
  );

  return {
    code: selectedRoom.code,
    hubUrl: selectedRoom.hubUrl,
  };
}

async function promptManualPublishedEndpoint(
  localEndpoint: string
): Promise<string> {
  const manualEndpointResult = await text({
    message: "Published network endpoint:",
    placeholder: replaceEndpointHost(localEndpoint, "192.168.1.50"),
    validate: (value) => {
      if (!value?.trim()) {
        return "Published endpoint is required";
      }

      try {
        new URL(value);
        return undefined;
      } catch {
        return "Enter a valid URL";
      }
    },
  });
  handleCancel(manualEndpointResult);
  return (manualEndpointResult as string).trim();
}

async function resolvePublishedEndpoint(
  params: ResolvePublishedEndpointParams
): Promise<string | null> {
  const {
    hubUrl,
    interactive,
    localEndpoint,
    networkEndpoint,
    noNetworkRewrite,
    stderr,
    stdout,
  } = params;

  try {
    new URL(localEndpoint);
  } catch {
    stderr.write(`Invalid endpoint URL: ${localEndpoint}\n`);
    return null;
  }

  if (networkEndpoint) {
    try {
      const normalizedNetworkEndpoint = new URL(networkEndpoint).toString();
      stdout.write(
        `Using manually published network endpoint: ${normalizedNetworkEndpoint}\n`
      );
      return normalizedNetworkEndpoint;
    } catch {
      stderr.write(`Invalid --network-endpoint URL: ${networkEndpoint}\n`);
      return null;
    }
  }

  if (noNetworkRewrite || !isRemoteHubUrl(hubUrl)) {
    return localEndpoint;
  }

  if (!isLoopbackLikeHost(getEndpointHost(localEndpoint))) {
    return localEndpoint;
  }

  const rankedPublishedEndpoints = getRankedPublishedEndpoints(
    hubUrl,
    localEndpoint
  );

  if (!interactive) {
    if (rankedPublishedEndpoints.length === 1) {
      const publishedEndpoint = rankedPublishedEndpoints[0];
      if (!publishedEndpoint) {
        return null;
      }
      stdout.write(
        `Remote hub detected. Publishing ${publishedEndpoint} instead of ${localEndpoint}.\n`
      );
      return publishedEndpoint;
    }

    if (rankedPublishedEndpoints.length === 0) {
      stderr.write(
        "Remote hub detected, but no LAN IP could be inferred for your local endpoint.\n"
      );
      stderr.write(
        "Pass --network-endpoint with the URL that the hub can reach, or use --no-network-rewrite to opt out.\n"
      );
      return null;
    }

    stderr.write(
      "Remote hub detected and multiple LAN endpoints are possible for your machine:\n"
    );
    for (const candidate of rankedPublishedEndpoints) {
      stderr.write(`  - ${candidate}\n`);
    }
    stderr.write(
      "Pass --network-endpoint to choose one explicitly, or use interactive mode to select it.\n"
    );
    return null;
  }

  writeRemoteLoopbackExplanation(stdout, hubUrl, localEndpoint);

  const options = rankedPublishedEndpoints.map((publishedEndpoint, index) => ({
    value: publishedEndpoint,
    label:
      index === 0
        ? `Use ${publishedEndpoint} (Recommended)`
        : `Use ${publishedEndpoint}`,
  }));

  options.push(
    { value: "__manual__", label: "Enter network endpoint manually" },
    { value: "__keep__", label: `Keep ${localEndpoint}` }
  );

  const selectedEndpoint = await select({
    message: "How should this endpoint be published to the hub?",
    options,
  });
  handleCancel(selectedEndpoint);

  if (selectedEndpoint === "__manual__") {
    return await promptManualPublishedEndpoint(localEndpoint);
  }

  if (selectedEndpoint === "__keep__") {
    stdout.write(
      "Keeping the current endpoint. A remote hub may reject this loopback URL.\n"
    );
    return localEndpoint;
  }

  return selectedEndpoint as string;
}

async function collectInteractiveInputs(
  defaults: {
    authHeaders: ParticipantAuthHeaders;
    code: string | undefined;
    config: RuntimeConfig;
    hubUrl: string;
    localEndpoint: string;
    model: string | undefined;
    networkEndpoint: string | undefined;
    nickname: string | undefined;
    noNetworkRewrite: boolean;
    noSpecs: boolean;
    password: string | undefined;
  },
  stdout: NodeJS.WritableStream,
  stderr: NodeJS.WritableStream
): Promise<JoinInputs | null> {
  intro("gambi join");

  let {
    authHeaders,
    code,
    hubUrl,
    localEndpoint,
    model,
    nickname,
    password,
    noSpecs,
  } = defaults;

  if (!code) {
    const roomSelection = await promptRoomSelection(hubUrl, stdout);
    code = roomSelection.code;
    hubUrl = roomSelection.hubUrl;
  }

  localEndpoint = await promptEndpoint(localEndpoint);
  authHeaders = await promptAuthHeaders();

  let capabilities: ParticipantCapabilities | undefined;

  if (!model) {
    const result = await promptModels(localEndpoint, authHeaders, stderr);
    if (!result) {
      return null;
    }
    model = result.model;
    capabilities = result.probe.capabilities;
  }

  if (nickname === undefined) {
    const nicknameResult = await text({
      message: "Nickname (leave empty for auto-generated):",
      placeholder: `${model}@${nanoid().slice(0, 6)}`,
    });
    handleCancel(nicknameResult);
    const resolvedNickname = (nicknameResult as string).trim();
    if (resolvedNickname) {
      nickname = resolvedNickname;
    }
  }

  if (password === undefined) {
    const passwordResult = await passwordPrompt({
      message: "Room password (leave empty if none):",
    });
    handleCancel(passwordResult);
    const resolvedPassword = (passwordResult as string).trim();
    if (resolvedPassword) {
      password = resolvedPassword;
    }
  }

  if (!noSpecs) {
    const specsResult = await confirm({
      message: "Share machine specs (CPU, RAM, GPU)?",
      initialValue: true,
    });
    handleCancel(specsResult);
    noSpecs = !(specsResult as boolean);
  }

  if (!capabilities) {
    const probe = await probeEndpoint(localEndpoint, { authHeaders });
    capabilities = probe.capabilities;
  }

  const publishedEndpoint = await resolvePublishedEndpoint({
    hubUrl,
    interactive: true,
    localEndpoint,
    networkEndpoint: defaults.networkEndpoint,
    noNetworkRewrite: defaults.noNetworkRewrite,
    stderr,
    stdout,
  });
  if (!publishedEndpoint) {
    return null;
  }

  let config: RuntimeConfig;
  try {
    config = await promptRuntimeConfig("participant", defaults.config);
  } catch (error) {
    stderr.write(`${error}\n`);
    return null;
  }

  return {
    authHeaders,
    capabilities,
    code,
    config,
    hubUrl,
    localEndpoint,
    model,
    nickname,
    noSpecs,
    password,
    publishedEndpoint,
  };
}

export class JoinCommand extends Command {
  static override paths = [["join"]];

  static override usage = Command.Usage({
    description: "Join a room and expose your LLM endpoint",
    examples: [
      ["Join a room (interactive)", "gambi join"],
      [
        "Join with Ollama",
        "gambi join --code ABC123 --model llama3 --endpoint http://localhost:11434",
      ],
      [
        "Join with LM Studio",
        "gambi join --code ABC123 --model gpt-4 --endpoint http://localhost:1234",
      ],
      [
        "Join with custom nickname",
        "gambi join --code ABC123 --model llama3 --endpoint http://localhost:11434 --nickname 'My GPU'",
      ],
      [
        "Join a remote hub with an explicit published endpoint",
        "gambi join --code ABC123 --hub http://192.168.1.10:3000 --model llama3 --network-endpoint http://192.168.1.25:11434",
      ],
      [
        "Join password-protected room",
        "gambi join --code ABC123 --model llama3 --password secret123",
      ],
    ],
  });

  code = Option.String("--code,-c", {
    description: "Room code to join",
    required: false,
  });

  model = Option.String("--model,-m", {
    description: "Model to expose",
    required: false,
  });

  endpoint = Option.String("--endpoint,-e", "http://localhost:11434", {
    description: "Local LLM endpoint URL used for probing and inference",
  });

  networkEndpoint = Option.String("--network-endpoint", {
    description: "Network-reachable URL to publish to the hub",
    required: false,
  });

  nickname = Option.String("--nickname,-n", {
    description: "Display name for your endpoint",
  });

  headers = Option.Array("--header", [], {
    description: "Auth header in the format Header=Value",
  });

  headerEnv = Option.Array("--header-env", [], {
    description: "Auth header in the format Header=ENV_VAR",
  });

  password = Option.String("--password,-p", {
    description: "Room password (if the room is password-protected)",
    required: false,
  });

  hub = Option.String("--hub,-H", "http://localhost:3000", {
    description: "Hub URL",
  });

  configPath = Option.String("--config", {
    description: "Path to a JSON file with participant defaults",
    required: false,
  });

  noSpecs = Option.Boolean("--no-specs", false, {
    description: "Don't share machine specs (CPU, RAM, GPU)",
  });

  noNetworkRewrite = Option.Boolean("--no-network-rewrite", false, {
    description:
      "Disable automatic localhost-to-LAN endpoint rewrite for remote hubs",
  });

  private async loadConfig(): Promise<RuntimeConfig | null> {
    if (!this.configPath) {
      return {};
    }

    try {
      return await loadRuntimeConfigFile(this.configPath);
    } catch (error) {
      this.context.stderr.write(`${error}\n`);
      return null;
    }
  }

  private async resolveInputs(): Promise<JoinDraftInputs | null> {
    if (this.code && this.model) {
      let authHeaders: ParticipantAuthHeaders;
      try {
        authHeaders = resolveAuthHeaders(this.headers, this.headerEnv);
      } catch (error) {
        this.context.stderr.write(`${error}\n`);
        return null;
      }

      const config = await this.loadConfig();
      if (config === null) {
        return null;
      }

      return {
        authHeaders,
        code: this.code,
        config,
        hubUrl: this.hub,
        localEndpoint: this.endpoint,
        model: this.model,
        networkEndpoint: this.networkEndpoint,
        nickname: this.nickname,
        noNetworkRewrite: this.noNetworkRewrite,
        noSpecs: this.noSpecs,
        password: this.password,
      };
    }

    if (!this.code) {
      this.context.stderr.write(
        "Error: --code is required (or run in a terminal for interactive mode)\n"
      );
    }
    if (!this.model) {
      this.context.stderr.write(
        "Error: --model is required (or run in a terminal for interactive mode)\n"
      );
    }
    return null;
  }

  private async collectInputsForExecution(
    interactive: boolean
  ): Promise<JoinInputs | null> {
    if (!interactive) {
      const resolved = await this.resolveInputs();
      if (!resolved) {
        return null;
      }

      const publishedEndpoint = await resolvePublishedEndpoint({
        hubUrl: resolved.hubUrl,
        interactive: false,
        localEndpoint: resolved.localEndpoint,
        networkEndpoint: resolved.networkEndpoint,
        noNetworkRewrite: resolved.noNetworkRewrite,
        stderr: this.context.stderr,
        stdout: this.context.stdout,
      });
      if (!publishedEndpoint) {
        return null;
      }

      return {
        ...resolved,
        capabilities: {
          openResponses: "unknown",
          chatCompletions: "unknown",
        },
        publishedEndpoint,
      };
    }

    const config = await this.loadConfig();
    if (config === null) {
      return null;
    }

    return collectInteractiveInputs(
      {
        authHeaders: {},
        code: this.code,
        config,
        hubUrl: this.hub,
        localEndpoint: this.endpoint,
        model: this.model,
        networkEndpoint: this.networkEndpoint,
        nickname: this.nickname,
        noNetworkRewrite: this.noNetworkRewrite,
        noSpecs: this.noSpecs,
        password: this.password,
      },
      this.context.stdout,
      this.context.stderr
    );
  }

  private async executeInteractiveJoin(inputs: JoinInputs): Promise<number> {
    const specs = inputs.noSpecs
      ? { cpu: "Hidden", ram: 0 }
      : await detectSpecs();
    const participantId = nanoid();
    const finalNickname =
      inputs.nickname ?? `${inputs.model}@${participantId.slice(0, 6)}`;

    return this.registerAndListen({
      authHeaders: inputs.authHeaders,
      capabilities: inputs.capabilities,
      code: inputs.code,
      config: inputs.config,
      finalNickname,
      hubUrl: inputs.hubUrl,
      interactive: true,
      localEndpoint: inputs.localEndpoint,
      model: inputs.model,
      participantId,
      password: inputs.password,
      publishedEndpoint: inputs.publishedEndpoint,
      specs,
    });
  }

  private async executeNonInteractiveJoin(inputs: JoinInputs): Promise<number> {
    const [probe, specs] = await Promise.all([
      probeEndpoint(inputs.localEndpoint, { authHeaders: inputs.authHeaders }),
      inputs.noSpecs
        ? Promise.resolve({ cpu: "Hidden" as const, ram: 0 })
        : detectSpecs(),
    ]);

    if (!this.validateProbe(probe, inputs.localEndpoint, inputs.model)) {
      return 1;
    }

    if (!inputs.noSpecs) {
      this.context.stdout.write(`Detected specs: ${formatSpecs(specs)}\n\n`);
    }

    const participantId = nanoid();
    const finalNickname =
      inputs.nickname ?? `${inputs.model}@${participantId.slice(0, 6)}`;

    return this.registerAndListen({
      authHeaders: inputs.authHeaders,
      capabilities: probe.capabilities,
      code: inputs.code,
      config: inputs.config,
      finalNickname,
      hubUrl: inputs.hubUrl,
      interactive: false,
      localEndpoint: inputs.localEndpoint,
      model: inputs.model,
      participantId,
      password: inputs.password,
      publishedEndpoint: inputs.publishedEndpoint,
      specs,
    });
  }

  private validateProbe(
    probe: EndpointProbeResult,
    endpoint: string,
    model: string
  ): boolean {
    if (probe.models.length === 0) {
      this.context.stderr.write(`No models found at ${endpoint}\n`);
      this.context.stderr.write(
        "Make sure your LLM server is running and has models available.\n"
      );
      return false;
    }

    if (!probe.models.includes(model)) {
      this.context.stderr.write(`Model '${model}' not found.\n`);
      this.context.stderr.write(
        `Available models: ${probe.models.join(", ")}\n`
      );
      return false;
    }

    return true;
  }

  async execute(): Promise<number> {
    const interactive = isInteractive() && !(this.code && this.model);
    const inputs = await this.collectInputsForExecution(interactive);
    if (!inputs) {
      return 1;
    }

    return interactive
      ? this.executeInteractiveJoin(inputs)
      : this.executeNonInteractiveJoin(inputs);
  }

  private async registerAndListen(opts: {
    authHeaders: ParticipantAuthHeaders;
    capabilities: ParticipantCapabilities;
    code: string;
    config: RuntimeConfig;
    finalNickname: string;
    hubUrl: string;
    interactive: boolean;
    localEndpoint: string;
    model: string;
    participantId: string;
    password: string | undefined;
    publishedEndpoint: string;
    specs: { cpu: string; ram: number; gpu?: string };
  }): Promise<number> {
    const {
      authHeaders,
      capabilities,
      code,
      config,
      finalNickname,
      hubUrl,
      interactive,
      localEndpoint,
      model,
      participantId,
      password,
      publishedEndpoint,
      specs,
    } = opts;

    try {
      const body: Record<string, unknown> = {
        id: participantId,
        nickname: finalNickname,
        model,
        endpoint: publishedEndpoint,
        specs,
        config,
        capabilities,
      };

      if (!hasRuntimeConfig(config)) {
        body.config = undefined;
      }

      if (Object.keys(authHeaders).length > 0) {
        body.authHeaders = authHeaders;
      }

      if (password) {
        body.password = password;
      }

      const response = await fetch(`${hubUrl}/rooms/${code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = (await response.json()) as ErrorResponse;
        this.context.stderr.write(`Error: ${data.error}\n`);
        return 1;
      }

      const data = (await response.json()) as JoinResponse;

      const successMsg = [
        `Joined room ${code}!`,
        `  Hub: ${hubUrl}`,
        `  Participant ID: ${data.participant.id}`,
        `  Nickname: ${data.participant.nickname}`,
        `  Model: ${data.participant.model}`,
        `  Local endpoint: ${localEndpoint}`,
        `  Published endpoint: ${data.participant.endpoint}`,
        "",
        "Your endpoint is now available through the hub.",
        "Press Ctrl+C to leave the room.",
      ].join("\n");

      if (interactive) {
        outro(successMsg);
      } else {
        this.context.stdout.write(`${successMsg}\n\n`);
      }
    } catch (error) {
      this.context.stderr.write(`Failed to connect to hub at ${hubUrl}\n`);
      this.context.stderr.write(`${error}\n`);
      return 1;
    }

    const healthInterval = setInterval(async () => {
      try {
        const response = await fetch(`${hubUrl}/rooms/${code}/health`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: participantId }),
        });

        if (!response.ok) {
          this.context.stderr.write("Health check failed, leaving room...\n");
          clearInterval(healthInterval);
          process.exit(1);
        }
      } catch {
        this.context.stderr.write("Lost connection to hub, leaving room...\n");
        clearInterval(healthInterval);
        process.exit(1);
      }
    }, HEALTH_CHECK_INTERVAL);

    const cleanup = async () => {
      this.context.stdout.write("\nLeaving room...\n");
      clearInterval(healthInterval);

      try {
        await fetch(`${hubUrl}/rooms/${code}/leave/${participantId}`, {
          method: "DELETE",
        });
        this.context.stdout.write("Left room successfully.\n");
      } catch {
        this.context.stderr.write("Failed to notify hub of departure.\n");
      }

      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    await new Promise(() => undefined);
    return 0;
  }
}
