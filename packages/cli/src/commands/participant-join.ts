import { password as passwordPrompt, select, text } from "@clack/prompts";
import { probeEndpoint } from "@gambi/core/endpoint";
import {
  HEALTH_CHECK_INTERVAL,
  type ParticipantAuthHeaders,
  type RuntimeConfig,
} from "@gambi/core/types";
import { nanoid } from "nanoid";
import { AgentCommand } from "../utils/agent-command.ts";
import { loadRuntimeConfigFromInput } from "../utils/cli-config.ts";
import {
  exitCodeForFailure,
  renderFailure,
  requestManagement,
} from "../utils/management-api.ts";
import {
  isLoopbackLikeHost,
  isRemoteHubUrl,
  listNetworkCandidates,
  rankNetworkCandidatesForHub,
  replaceEndpointHost,
} from "../utils/network-endpoint.ts";
import { Command, Option } from "../utils/option.ts";
import { writeStructured } from "../utils/output.ts";
import { detectSpecs } from "../utils/specs.ts";

function parseHeaderAssignment(input: string): { name: string; value: string } {
  const index = input.indexOf("=");
  if (index <= 0 || index === input.length - 1) {
    throw new Error(`Invalid header assignment '${input}'. Use Header=Value.`);
  }

  return {
    name: input.slice(0, index).trim(),
    value: input.slice(index + 1).trim(),
  };
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

function resolvePublishedEndpoint(
  hubUrl: string,
  endpoint: string,
  explicitNetworkEndpoint?: string
): string {
  if (explicitNetworkEndpoint) {
    return new URL(explicitNetworkEndpoint).toString();
  }

  if (!isRemoteHubUrl(hubUrl)) {
    return endpoint;
  }

  const hostname = new URL(endpoint).hostname;
  if (!isLoopbackLikeHost(hostname)) {
    return endpoint;
  }

  const rankedCandidates = rankNetworkCandidatesForHub(
    hubUrl,
    listNetworkCandidates()
  );
  const publishedEndpoints = rankedCandidates.map((candidate) =>
    replaceEndpointHost(endpoint, candidate.address)
  );

  if (publishedEndpoints.length === 0) {
    throw new Error(
      "Remote hub detected, but no LAN endpoint could be inferred. Pass --network-endpoint."
    );
  }

  return publishedEndpoints[0] ?? endpoint;
}

export class ParticipantJoinCommand extends AgentCommand {
  static override paths = [["participant", "join"]];

  static override usage = Command.Usage({
    description: "Register a participant and keep heartbeats alive",
    details:
      "Probes the local endpoint, registers the participant through the management API, and keeps sending heartbeats until interrupted.",
    examples: [
      [
        "Join a room",
        "gambi participant join --room ABC123 --participant-id worker-1 --model llama3",
      ],
      [
        "Preview the registration",
        "gambi participant join --room ABC123 --participant-id worker-1 --model llama3 --dry-run --format ndjson",
      ],
      [
        "Register against a remote hub",
        "gambi participant join --room ABC123 --participant-id worker-1 --model llama3 --hub http://192.168.1.10:3000 --network-endpoint http://192.168.1.25:11434",
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

  networkEndpoint = Option.String("--network-endpoint", {
    description: "Network-reachable URL to publish to the hub",
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
    description: "Validate registration inputs and exit",
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

    if (this.allowInteractive(true)) {
      if (!room) {
        room = String(await text({ message: "Room code:" })).trim();
      }

      if (!participantId) {
        participantId = String(
          await text({ message: "Participant ID:", placeholder: nanoid(8) })
        ).trim();
      }

      if (!model) {
        const probe = await probeEndpoint(endpoint, {
          authHeaders: resolveAuthHeaders(
            this.headers,
            this.headerEnv,
            envConfig?.headers
          ),
        });
        if (probe.models.length === 0) {
          this.context.stderr.write(
            "Error: No models found on the endpoint.\nHint: verify the local endpoint and retry.\n"
          );
          return 3;
        }
        model = String(
          await select({
            message: "Model:",
            options: probe.models.map((candidate) => ({
              value: candidate,
              label: candidate,
            })),
          })
        );
      }

      if (nickname === undefined) {
        const nicknameResult = String(
          await text({ message: "Nickname (optional):", placeholder: model })
        ).trim();
        if (nicknameResult) {
          nickname = nicknameResult;
        }
      }

      if (password === undefined) {
        const passwordResult = String(
          await passwordPrompt({
            message: "Room password (leave empty if none):",
          })
        ).trim();
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

    let runtimeConfig: RuntimeConfig | undefined;
    try {
      runtimeConfig = await loadRuntimeConfigFromInput(this.configPath);
    } catch (error) {
      this.context.stderr.write(
        `Error: ${error instanceof Error ? error.message : String(error)}\n`
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

    const publishedEndpoint = resolvePublishedEndpoint(
      hubUrl,
      endpoint,
      this.networkEndpoint ?? envConfig?.networkEndpoint
    );
    const specs =
      this.noSpecs || envConfig?.noSpecs ? undefined : await detectSpecs();
    const payload = {
      nickname: nickname ?? `${model}@${participantId.slice(0, 6)}`,
      model,
      endpoint: publishedEndpoint,
      password,
      specs,
      config: runtimeConfig,
      capabilities: probe.capabilities,
      authHeaders:
        Object.keys(authHeaders).length > 0 ? authHeaders : undefined,
    };

    if (this.dryRun) {
      const preview = {
        hubUrl,
        room,
        participantId,
        endpoint,
        publishedEndpoint,
        payload: {
          ...payload,
          authHeaders: payload.authHeaders
            ? Object.fromEntries(
                Object.keys(payload.authHeaders).map((key) => [
                  key,
                  "[redacted]",
                ])
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
          publishedEndpoint,
        },
      });
    }

    const registration = await requestManagement<{
      participant: {
        id: string;
        nickname: string;
        model: string;
        endpoint: string;
      };
      roomId: string;
    }>(hubUrl, `/v1/rooms/${room}/participants/${participantId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    if (!registration.ok) {
      this.context.stderr.write(renderFailure(registration.value));
      return exitCodeForFailure(registration.value);
    }

    if (format === "text") {
      this.context.stdout.write(
        `Registered ${registration.value.data.participant.nickname} in room ${room}.\n`
      );
      this.context.stdout.write("Press Ctrl+C to leave.\n");
    } else {
      writeStructured(this.context.stdout, format, {
        type: "registered",
        timestamp: Date.now(),
        data: registration.value.data,
      });
    }

    return await new Promise<number>((resolve) => {
      let closed = false;
      const heartbeatInterval = setInterval(async () => {
        const heartbeat = await requestManagement(
          hubUrl,
          `/v1/rooms/${room}/participants/${participantId}/heartbeat`,
          { method: "POST" }
        );

        if (!heartbeat.ok) {
          clearInterval(heartbeatInterval);
          if (format === "text") {
            this.context.stderr.write(renderFailure(heartbeat.value));
          } else {
            writeStructured(this.context.stdout, format, {
              type: "heartbeat_failed",
              timestamp: Date.now(),
              data: heartbeat.value,
            });
          }
          resolve(exitCodeForFailure(heartbeat.value));
          return;
        }

        if (format !== "text") {
          writeStructured(this.context.stdout, format, {
            type: "heartbeat_ok",
            timestamp: Date.now(),
            data: heartbeat.value.data,
          });
        }
      }, HEALTH_CHECK_INTERVAL);

      const shutdown = async (signal: string) => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeatInterval);

        if (format === "text") {
          this.context.stdout.write(`Leaving room ${room}...\n`);
        } else {
          writeStructured(this.context.stdout, format, {
            type: "leaving",
            timestamp: Date.now(),
            data: { signal, participantId, room },
          });
        }

        const leaveResult = await requestManagement<{ success: true }>(
          hubUrl,
          `/v1/rooms/${room}/participants/${participantId}`,
          { method: "DELETE" }
        );
        if (!leaveResult.ok) {
          this.context.stderr.write(renderFailure(leaveResult.value));
          resolve(exitCodeForFailure(leaveResult.value));
          return;
        }

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
      };

      process.once("SIGINT", () => {
        shutdown("SIGINT").catch(() => undefined);
      });
      process.once("SIGTERM", () => {
        shutdown("SIGTERM").catch(() => undefined);
      });
    });
  }
}
