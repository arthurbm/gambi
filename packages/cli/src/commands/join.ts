import {
  confirm,
  intro,
  outro,
  password as passwordPrompt,
  select,
  spinner,
  text,
} from "@clack/prompts";
import type { EndpointProbeResult } from "@gambiarra/core/endpoint";
import { probeEndpoint } from "@gambiarra/core/endpoint";
import type {
  ParticipantAuthHeaders,
  ParticipantCapabilities,
  RuntimeConfig,
} from "@gambiarra/core/types";
import { HEALTH_CHECK_INTERVAL } from "@gambiarra/core/types";
import { Command, Option } from "../utils/option.ts";
import { nanoid } from "nanoid";
import { handleCancel, isInteractive, LLM_PROVIDERS } from "../utils/prompt.ts";
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

interface JoinInputs {
  authHeaders: ParticipantAuthHeaders;
  code: string;
  model: string;
  endpoint: string;
  nickname: string | undefined;
  password: string | undefined;
  noSpecs: boolean;
  capabilities: ParticipantCapabilities;
  config: RuntimeConfig;
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
    ...LLM_PROVIDERS.map((p) => ({
      value: `http://localhost:${p.port}`,
      label: `${p.name} (localhost:${p.port})`,
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
      validate: (v) => (v ? undefined : "Endpoint URL is required"),
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
    options: probe.models.map((m) => ({ value: m, label: m })),
  });
  handleCancel(modelResult);

  return { model: modelResult as string, probe };
}

async function collectInteractiveInputs(
  defaults: {
    authHeaders: ParticipantAuthHeaders;
    code: string | undefined;
    config: RuntimeConfig;
    model: string | undefined;
    endpoint: string;
    nickname: string | undefined;
    password: string | undefined;
    noSpecs: boolean;
  },
  stderr: NodeJS.WritableStream
): Promise<JoinInputs | null> {
  intro("gambiarra join");

  let { authHeaders, code, model, endpoint, nickname, password, noSpecs } =
    defaults;

  if (!code) {
    const codeResult = await text({
      message: "Room code:",
      validate: (v) => (v ? undefined : "Room code is required"),
    });
    handleCancel(codeResult);
    code = codeResult as string;
  }

  endpoint = await promptEndpoint(endpoint);
  authHeaders = await promptAuthHeaders();

  let capabilities: ParticipantCapabilities | undefined;

  if (!model) {
    const result = await promptModels(endpoint, authHeaders, stderr);
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
    const nick = nicknameResult as string;
    if (nick) {
      nickname = nick;
    }
  }

  if (password === undefined) {
    const passwordResult = await passwordPrompt({
      message: "Room password (leave empty if none):",
    });
    handleCancel(passwordResult);
    const pwd = passwordResult as string;
    if (pwd) {
      password = pwd;
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
    const probe = await probeEndpoint(endpoint, { authHeaders });
    capabilities = probe.capabilities;
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
    config,
    code,
    model,
    endpoint,
    nickname,
    password,
    noSpecs,
    capabilities,
  };
}

export class JoinCommand extends Command {
  static override paths = [["join"]];

  static override usage = Command.Usage({
    description: "Join a room and expose your LLM endpoint",
    examples: [
      ["Join a room (interactive)", "gambiarra join"],
      [
        "Join with Ollama",
        "gambiarra join --code ABC123 --model llama3 --endpoint http://localhost:11434",
      ],
      [
        "Join with LM Studio",
        "gambiarra join --code ABC123 --model gpt-4 --endpoint http://localhost:1234",
      ],
      [
        "Join with custom nickname",
        "gambiarra join --code ABC123 --model llama3 --endpoint http://localhost:11434 --nickname 'My GPU'",
      ],
      [
        "Join password-protected room",
        "gambiarra join --code ABC123 --model llama3 --password secret123",
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
    description: "LLM endpoint URL (OpenResponses or chat/completions capable)",
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

  private async resolveInputs(): Promise<Omit<
    JoinInputs,
    "capabilities"
  > | null> {
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
        model: this.model,
        endpoint: this.endpoint,
        nickname: this.nickname,
        password: this.password,
        noSpecs: this.noSpecs,
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
      return {
        ...resolved,
        capabilities: {
          openResponses: "unknown",
          chatCompletions: "unknown",
        },
      };
    }

    const config = await this.loadConfig();
    if (config === null) {
      return null;
    }

    return collectInteractiveInputs(
      {
        code: this.code,
        model: this.model,
        authHeaders: {},
        config,
        endpoint: this.endpoint,
        nickname: this.nickname,
        password: this.password,
        noSpecs: this.noSpecs,
      },
      this.context.stderr
    );
  }

  private async executeInteractiveJoin(inputs: JoinInputs): Promise<number> {
    const {
      authHeaders,
      config,
      code,
      model,
      endpoint,
      nickname,
      password,
      noSpecs,
      capabilities,
    } = inputs;

    const specs = noSpecs ? { cpu: "Hidden", ram: 0 } : await detectSpecs();
    const participantId = nanoid();
    const finalNickname = nickname ?? `${model}@${participantId.slice(0, 6)}`;

    return this.registerAndListen({
      code,
      config,
      model,
      endpoint,
      authHeaders,
      password,
      participantId,
      finalNickname,
      specs,
      capabilities,
      interactive: true,
    });
  }

  private async executeNonInteractiveJoin(inputs: JoinInputs): Promise<number> {
    const [probe, specs] = await Promise.all([
      probeEndpoint(inputs.endpoint, { authHeaders: inputs.authHeaders }),
      inputs.noSpecs
        ? Promise.resolve({ cpu: "Hidden" as const, ram: 0 })
        : detectSpecs(),
    ]);

    if (!this.validateProbe(probe, inputs.endpoint, inputs.model)) {
      return 1;
    }

    if (!inputs.noSpecs) {
      this.context.stdout.write(`Detected specs: ${formatSpecs(specs)}\n\n`);
    }

    const participantId = nanoid();
    const finalNickname =
      inputs.nickname ?? `${inputs.model}@${participantId.slice(0, 6)}`;

    return this.registerAndListen({
      code: inputs.code,
      config: inputs.config,
      model: inputs.model,
      endpoint: inputs.endpoint,
      authHeaders: inputs.authHeaders,
      password: inputs.password,
      participantId,
      finalNickname,
      specs,
      capabilities: probe.capabilities,
      interactive: false,
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
    code: string;
    config: RuntimeConfig;
    model: string;
    endpoint: string;
    authHeaders: ParticipantAuthHeaders;
    password: string | undefined;
    participantId: string;
    finalNickname: string;
    specs: { cpu: string; ram: number; gpu?: string };
    capabilities: ParticipantCapabilities;
    interactive: boolean;
  }): Promise<number> {
    const {
      code,
      config,
      model,
      endpoint,
      authHeaders,
      password,
      participantId,
      finalNickname,
      specs,
      capabilities,
      interactive,
    } = opts;

    try {
      const body: Record<string, unknown> = {
        id: participantId,
        nickname: finalNickname,
        model,
        endpoint,
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

      const response = await fetch(`${this.hub}/rooms/${code}/join`, {
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
        `  Participant ID: ${data.participant.id}`,
        `  Nickname: ${data.participant.nickname}`,
        `  Model: ${data.participant.model}`,
        `  Endpoint: ${data.participant.endpoint}`,
        "",
        "Your endpoint is now available through the hub.",
        "Press Ctrl+C to leave the room.",
      ].join("\n");

      if (interactive) {
        outro(successMsg);
      } else {
        this.context.stdout.write(`${successMsg}\n\n`);
      }
    } catch (err) {
      this.context.stderr.write(`Failed to connect to hub at ${this.hub}\n`);
      this.context.stderr.write(`${err}\n`);
      return 1;
    }

    // Start health check loop
    const healthInterval = setInterval(async () => {
      try {
        const response = await fetch(`${this.hub}/rooms/${code}/health`, {
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

    // Handle graceful shutdown
    const cleanup = async () => {
      this.context.stdout.write("\nLeaving room...\n");
      clearInterval(healthInterval);

      try {
        await fetch(`${this.hub}/rooms/${code}/leave/${participantId}`, {
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

    // Keep the process running
    await new Promise(() => undefined);
    return 0;
  }
}
