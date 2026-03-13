import { probeEndpoint } from "@gambiarra/core/endpoint";
import { HEALTH_CHECK_INTERVAL } from "@gambiarra/core/types";
import { Command, Option } from "clipanion";
import { nanoid } from "nanoid";
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

export class JoinCommand extends Command {
  static override paths = [["join"]];

  static override usage = Command.Usage({
    description: "Join a room and expose your LLM endpoint",
    examples: [
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
    required: true,
  });

  model = Option.String("--model,-m", {
    description: "Model to expose",
    required: true,
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

  async execute(): Promise<number> {
    // Detect machine specs unless --no-specs is passed
    const specs = this.noSpecs
      ? { cpu: "Hidden", ram: 0 }
      : await detectSpecs();

    if (!this.noSpecs) {
      this.context.stdout.write(`Detected specs: ${formatSpecs(specs)}\n\n`);
    }
    const probe = await probeEndpoint(this.endpoint);
    const models = probe.models;

    if (models.length === 0) {
      this.context.stderr.write(`No models found at ${this.endpoint}\n`);
      this.context.stderr.write(
        "Make sure your LLM server is running and has models available.\n"
      );
      return 1;
    }

    if (!models.includes(this.model)) {
      this.context.stderr.write(`Model '${this.model}' not found.\n`);
      this.context.stderr.write(`Available models: ${models.join(", ")}\n`);
      return 1;
    }

    const participantId = nanoid();
    const nickname =
      this.nickname ?? `${this.model}@${participantId.slice(0, 6)}`;

    // Register with the hub
    try {
      const body: Record<string, unknown> = {
        id: participantId,
        nickname,
        model: this.model,
        endpoint: this.endpoint,
        specs,
        config: {},
        capabilities: probe.capabilities,
      };

      if (this.password) {
        body.password = this.password;
      }

      const response = await fetch(`${this.hub}/rooms/${this.code}/join`, {
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

      this.context.stdout.write(`Joined room ${this.code}!\n`);
      this.context.stdout.write(`  Participant ID: ${data.participant.id}\n`);
      this.context.stdout.write(`  Nickname: ${data.participant.nickname}\n`);
      this.context.stdout.write(`  Model: ${data.participant.model}\n`);
      this.context.stdout.write(`  Endpoint: ${data.participant.endpoint}\n`);
      this.context.stdout.write(
        "\nYour endpoint is now available through the hub.\n"
      );
      this.context.stdout.write("Press Ctrl+C to leave the room.\n\n");
    } catch (err) {
      this.context.stderr.write(`Failed to connect to hub at ${this.hub}\n`);
      this.context.stderr.write(`${err}\n`);
      return 1;
    }

    // Start health check loop
    const healthInterval = setInterval(async () => {
      try {
        const response = await fetch(`${this.hub}/rooms/${this.code}/health`, {
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
        await fetch(`${this.hub}/rooms/${this.code}/leave/${participantId}`, {
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
