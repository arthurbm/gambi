import { password as passwordPrompt, select, text } from "@clack/prompts";
import { probeEndpoint } from "@gambi/core/endpoint";
import type { ParticipantAuthHeaders, RuntimeConfig } from "@gambi/core/types";
import { nanoid } from "nanoid";
import { createParticipantSession } from "../../../sdk/src/participant-session.ts";
import { AgentCommand } from "../utils/agent-command.ts";
import { loadRuntimeConfigFromInput } from "../utils/cli-config.ts";
import { Command, Option } from "../utils/option.ts";
import { writeStructured } from "../utils/output.ts";
import { handleCancel } from "../utils/prompt.ts";
import { detectSpecs } from "../utils/specs.ts";

export function parseHeaderAssignment(input: string): {
  name: string;
  value: string;
} {
  const index = input.indexOf("=");
  if (index <= 0 || index === input.length - 1) {
    throw new Error(`Invalid header assignment '${input}'. Use Header=Value.`);
  }

  const name = input.slice(0, index).trim();
  const value = input.slice(index + 1).trim();
  if (!(name && value)) {
    throw new Error(`Invalid header assignment '${input}'. Use Header=Value.`);
  }

  return { name, value };
}

function resolveAuthHeaders(
  headers: string[],
  headerEnv: string[],
  envHeaders?: Record<string, string>
): ParticipantAuthHeaders {
  const authHeaders: ParticipantAuthHeaders = { ...(envHeaders ?? {}) };

  for (const assignment of headers) {
    const { name, value } = parseHeaderAssignment(assignment);
    authHeaders[name] = value;
  }

  for (const assignment of headerEnv) {
    const { name, value } = parseHeaderAssignment(assignment);
    const envValue = process.env[value];
    if (!envValue) {
      throw new Error(
        `Environment variable '${value}' is required for header '${name}'.`
      );
    }
    authHeaders[name] = envValue;
  }

  return authHeaders;
}

export class ParticipantJoinCommand extends AgentCommand {
  static override paths = [["participant", "join"]];

  static override usage = Command.Usage({
    description: "Register a participant and keep its tunnel alive",
    details:
      "Probes the local endpoint, registers the participant through the management API, opens a participant tunnel, and keeps the session alive until interrupted.",
    examples: [
      [
        "Join a room",
        "gambi participant join --room ABC123 --participant-id worker-1 --model llama3",
      ],
      [
        "Preview the session payload",
        "gambi participant join --room ABC123 --participant-id worker-1 --model llama3 --dry-run --format ndjson",
      ],
      [
        "Join a remote hub",
        "gambi participant join --room ABC123 --participant-id worker-1 --model llama3 --hub http://192.168.1.10:3000",
      ],
    ],
  });

  room = Option.String("--room,-r", {
    description: "Room code",
    required: false,
  });

  participantId = Option.String("--participant-id", {
    description: "Stable participant identifier",
    required: false,
  });

  nickname = Option.String("--nickname,-n", {
    description: "Display name",
    required: false,
  });

  model = Option.String("--model,-m", {
    description: "Model to expose",
    required: false,
  });

  endpoint = Option.String("--endpoint,-e", {
    description: "Local endpoint used for probing and inference",
    required: false,
  });

  headers = Option.Array("--header", [], {
    description: "Auth header in the format Header=Value",
  });

  headerEnv = Option.Array("--header-env", [], {
    description: "Auth header in the format Header=ENV_VAR",
  });

  password = Option.String("--password,-p", {
    description: "Room password",
    required: false,
  });

  configPath = Option.String("--config", {
    description: "Runtime config JSON file or '-' for stdin",
    required: false,
  });

  noSpecs = Option.Boolean("--no-specs", false, {
    description: "Do not collect machine specs",
  });

  hub = Option.String("--hub,-H", {
    description: "Hub URL",
    required: false,
  });

  dryRun = Option.Boolean("--dry-run", false, {
    description: "Validate session inputs and exit",
  });

  async execute(): Promise<number> {
    const envConfigResult = await this.loadEnvConfig();
    if (!envConfigResult.ok) {
      return envConfigResult.exitCode;
    }

    const envConfig = envConfigResult.value;
    const hubUrl = this.hub ?? envConfig?.hubUrl ?? "http://localhost:3000";
    const endpoint =
      this.endpoint ?? envConfig?.endpoint ?? "http://localhost:11434";
    const format = this.resolveFormat(true);

    let room = this.room;
    let model = this.model;
    let password = this.password;
    let nickname = this.nickname;
    let participantId = this.participantId;

    let authHeaders: ParticipantAuthHeaders;
    try {
      authHeaders = resolveAuthHeaders(
        this.headers,
        this.headerEnv,
        envConfig?.headers
      );
    } catch (error) {
      this.context.stderr.write(
        `Error: ${error instanceof Error ? error.message : String(error)}\n`
      );
      return 2;
    }

    if (this.allowInteractive(true)) {
      if (!room) {
        const roomResult = await text({ message: "Room code:" });
        handleCancel(roomResult);
        room = String(roomResult).trim();
      }

      if (!participantId) {
        const participantIdResult = await text({
          message: "Participant ID:",
          placeholder: nanoid(8),
        });
        handleCancel(participantIdResult);
        participantId = String(participantIdResult).trim();
      }

      if (!model) {
        const probe = await probeEndpoint(endpoint, { authHeaders });
        if (probe.models.length === 0) {
          this.context.stderr.write(
            "Error: No models found on the endpoint.\nHint: verify the local endpoint and retry.\n"
          );
          return 3;
        }
        const modelResult = await select({
          message: "Model:",
          options: probe.models.map((candidate) => ({
            value: candidate,
            label: candidate,
          })),
        });
        handleCancel(modelResult);
        model = String(modelResult);
      }

      if (nickname === undefined) {
        const nicknamePromptResult = await text({
          message: "Nickname (optional):",
          placeholder: model,
        });
        handleCancel(nicknamePromptResult);
        const nicknameResult = String(nicknamePromptResult).trim();
        if (nicknameResult) {
          nickname = nicknameResult;
        }
      }

      if (password === undefined) {
        const passwordPromptResult = await passwordPrompt({
          message: "Room password (leave empty if none):",
        });
        handleCancel(passwordPromptResult);
        const passwordResult = String(passwordPromptResult).trim();
        if (passwordResult) {
          password = passwordResult;
        }
      }
    }

    if (!(room && model)) {
      this.context.stderr.write(
        "Error: --room and --model are required.\nHint: pass the flags or use --interactive.\n"
      );
      return 2;
    }

    if (!participantId) {
      this.context.stderr.write(
        "Error: --participant-id is required.\nHint: provide a stable id for retry-safe registration.\n"
      );
      return 2;
    }

    let runtimeConfig: RuntimeConfig | undefined;
    try {
      runtimeConfig = await loadRuntimeConfigFromInput(this.configPath);
    } catch (error) {
      this.context.stderr.write(
        `Error: ${error instanceof Error ? error.message : String(error)}\n`
      );
      return 2;
    }

    try {
      new URL(endpoint);
    } catch {
      this.context.stderr.write(
        `Error: Invalid endpoint URL: ${endpoint}.\nHint: pass --endpoint with a full URL such as http://localhost:11434.\n`
      );
      return 2;
    }

    const probe = await probeEndpoint(endpoint, { authHeaders });
    if (!probe.models.includes(model)) {
      this.context.stderr.write(
        `Error: Model '${model}' not found on ${endpoint}.\nHint: available models: ${probe.models.join(", ")}\n`
      );
      return 3;
    }

    const specs =
      this.noSpecs || envConfig?.noSpecs ? undefined : await detectSpecs();
    const payload = {
      nickname: nickname ?? `${model}@${participantId.slice(0, 6)}`,
      model,
      endpoint,
      password,
      specs,
      config: runtimeConfig,
      capabilities: probe.capabilities,
    };

    if (this.dryRun) {
      const preview = {
        hubUrl,
        room,
        participantId,
        endpoint,
        connection: { kind: "tunnel" },
        payload: {
          ...payload,
          authHeaders: Object.keys(authHeaders).length
            ? Object.fromEntries(
                Object.keys(authHeaders).map((key) => [key, "[redacted]"])
              )
            : undefined,
          password: password ? "[redacted]" : undefined,
        },
      };
      if (format === "text") {
        this.context.stdout.write(
          `Prepared participant ${participantId} for room ${room}.\n${JSON.stringify(preview, null, 2)}\n`
        );
      } else {
        writeStructured(this.context.stdout, format, preview);
      }
      return 0;
    }

    if (format !== "text") {
      writeStructured(this.context.stdout, format, {
        type: "prepared",
        timestamp: Date.now(),
        data: {
          room,
          participantId,
          endpoint,
          connection: { kind: "tunnel" },
        },
      });
    }

    let session;
    try {
      session = await createParticipantSession({
        hubUrl,
        roomCode: room,
        participantId,
        endpoint,
        model,
        nickname: payload.nickname,
        password,
        specs,
        config: runtimeConfig,
        capabilities: probe.capabilities,
        authHeaders,
      });
    } catch (error) {
      this.context.stderr.write(
        `Error: ${error instanceof Error ? error.message : String(error)}\n`
      );
      return 3;
    }

    if (format === "text") {
      this.context.stdout.write(
        `Registered ${session.participant.nickname} in room ${room}.\n`
      );
      this.context.stdout.write("Participant tunnel connected.\n");
      this.context.stdout.write("Press Ctrl+C to leave.\n");
    } else {
      writeStructured(this.context.stdout, format, {
        type: "registered",
        timestamp: Date.now(),
        data: {
          participant: session.participant,
          roomId: session.roomId,
          tunnel: { url: session.tunnel.url },
        },
      });
      writeStructured(this.context.stdout, format, {
        type: "tunnel_connected",
        timestamp: Date.now(),
        data: {
          participantId,
          room,
        },
      });
    }

    return await new Promise<number>((resolve) => {
      let closing = false;

      const cleanup = () => {
        process.off("SIGINT", onSigint);
        process.off("SIGTERM", onSigterm);
      };

      const onSigint = () => {
        shutdown("SIGINT");
      };
      const onSigterm = () => {
        shutdown("SIGTERM");
      };

      const shutdown = (signal: string) => {
        if (closing) {
          return;
        }
        closing = true;

        if (format === "text") {
          this.context.stdout.write(`Leaving room ${room}...\n`);
        } else {
          writeStructured(this.context.stdout, format, {
            type: "leaving",
            timestamp: Date.now(),
            data: { signal, participantId, room },
          });
        }

        void session.close();
      };

      process.once("SIGINT", onSigint);
      process.once("SIGTERM", onSigterm);

      session
        .waitUntilClosed()
        .then((result) => {
          cleanup();

          if (result.reason === "closed") {
            if (format === "text") {
              this.context.stdout.write("Left room successfully.\n");
            } else {
              writeStructured(this.context.stdout, format, {
                type: "left",
                timestamp: Date.now(),
                data: { participantId, room },
              });
            }
            resolve(0);
            return;
          }

          const message = result.error?.message ?? "Participant session closed.";
          if (format === "text") {
            this.context.stderr.write(`Error: ${message}\n`);
          } else {
            writeStructured(this.context.stdout, format, {
              type:
                result.reason === "heartbeat_failed"
                  ? "heartbeat_failed"
                  : "tunnel_failed",
              timestamp: Date.now(),
              data: {
                participantId,
                room,
                reason: result.reason,
                message,
              },
            });
          }
          resolve(3);
        })
        .catch((error) => {
          cleanup();
          this.context.stderr.write(
            `Error: ${error instanceof Error ? error.message : String(error)}\n`
          );
          resolve(1);
        });
    });
  }
}
