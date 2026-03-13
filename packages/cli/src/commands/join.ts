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
import type { ParticipantCapabilities } from "@gambiarra/core/types";
import { HEALTH_CHECK_INTERVAL } from "@gambiarra/core/types";
import { Command, Option } from "clipanion";
import { nanoid } from "nanoid";
import { handleCancel, isInteractive, LLM_PROVIDERS } from "../utils/prompt.ts";
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
  code: string;
  model: string;
  endpoint: string;
  nickname: string | undefined;
  password: string | undefined;
  noSpecs: boolean;
  capabilities: ParticipantCapabilities;
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
  stderr: NodeJS.WritableStream
): Promise<{ model: string; probe: EndpointProbeResult } | null> {
  const s = spinner();
  s.start("Detecting available models...");

  const probe = await probeEndpoint(endpoint);

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
    code: string | undefined;
    model: string | undefined;
    endpoint: string;
    nickname: string | undefined;
    password: string | undefined;
    noSpecs: boolean;
  },
  stderr: NodeJS.WritableStream
): Promise<JoinInputs | null> {
  intro("gambiarra join");

  let { code, model, endpoint, nickname, password, noSpecs } = defaults;

  if (!code) {
    const codeResult = await text({
      message: "Room code:",
      validate: (v) => (v ? undefined : "Room code is required"),
    });
    handleCancel(codeResult);
    code = codeResult as string;
  }

  endpoint = await promptEndpoint(endpoint);

  let capabilities: ParticipantCapabilities | undefined;

  if (!model) {
    const result = await promptModels(endpoint, stderr);
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
    const probe = await probeEndpoint(endpoint);
    capabilities = probe.capabilities;
  }

  return { code, model, endpoint, nickname, password, noSpecs, capabilities };
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

  password = Option.String("--password,-p", {
    description: "Room password (if the room is password-protected)",
    required: false,
  });

  hub = Option.String("--hub,-H", "http://localhost:3000", {
    description: "Hub URL",
  });

  noSpecs = Option.Boolean("--no-specs", false, {
    description: "Don't share machine specs (CPU, RAM, GPU)",
  });

  private resolveInputs(): Omit<JoinInputs, "capabilities"> | null {
    if (this.code && this.model) {
      return {
        code: this.code,
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
    let inputs: JoinInputs;

    if (interactive) {
      const result = await collectInteractiveInputs(
        {
          code: this.code,
          model: this.model,
          endpoint: this.endpoint,
          nickname: this.nickname,
          password: this.password,
          noSpecs: this.noSpecs,
        },
        this.context.stderr
      );
      if (!result) {
        return 1;
      }
      inputs = result;
    } else {
      const resolved = this.resolveInputs();
      if (!resolved) {
        return 1;
      }

      // Probe endpoint and detect specs concurrently
      const [probe, specs] = await Promise.all([
        probeEndpoint(resolved.endpoint),
        resolved.noSpecs
          ? Promise.resolve({ cpu: "Hidden" as const, ram: 0 })
          : detectSpecs(),
      ]);

      if (!this.validateProbe(probe, resolved.endpoint, resolved.model)) {
        return 1;
      }

      if (!resolved.noSpecs) {
        this.context.stdout.write(`Detected specs: ${formatSpecs(specs)}\n\n`);
      }

      const participantId = nanoid();
      const finalNickname =
        resolved.nickname ?? `${resolved.model}@${participantId.slice(0, 6)}`;

      return this.registerAndListen({
        code: resolved.code,
        model: resolved.model,
        endpoint: resolved.endpoint,
        password: resolved.password,
        participantId,
        finalNickname,
        specs,
        capabilities: probe.capabilities,
        interactive: false,
      });
    }

    const { code, model, endpoint, nickname, password, noSpecs, capabilities } =
      inputs;

    const specs = noSpecs ? { cpu: "Hidden", ram: 0 } : await detectSpecs();

    const participantId = nanoid();
    const finalNickname = nickname ?? `${model}@${participantId.slice(0, 6)}`;

    return this.registerAndListen({
      code,
      model,
      endpoint,
      password,
      participantId,
      finalNickname,
      specs,
      capabilities,
      interactive: true,
    });
  }

  private async registerAndListen(opts: {
    code: string;
    model: string;
    endpoint: string;
    password: string | undefined;
    participantId: string;
    finalNickname: string;
    specs: { cpu: string; ram: number; gpu?: string };
    capabilities: ParticipantCapabilities;
    interactive: boolean;
  }): Promise<number> {
    const {
      code,
      model,
      endpoint,
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
        config: {},
        capabilities,
      };

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
