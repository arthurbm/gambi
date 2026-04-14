import { createHub } from "@gambi/core/hub";
import { AgentCommand } from "../utils/agent-command.ts";
import { Command, Option } from "../utils/option.ts";
import { writeStructured } from "../utils/output.ts";

export function parseServePort(input: string | number): number | null {
  const port = Number(input);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return null;
  }

  return port;
}

export class HubServeCommand extends AgentCommand {
  static override paths = [["hub", "serve"]];

  static override usage = Command.Usage({
    description: "Start the hub management and inference server",
    details:
      "Starts the Gambi hub. Prefer --format ndjson for machine supervision and --dry-run for startup validation.",
    examples: [
      ["Start the hub", "gambi hub serve"],
      ["Preview startup", "gambi hub serve --dry-run --format ndjson"],
      ["Enable mDNS", "gambi hub serve --mdns"],
    ],
  });

  host = Option.String("--host", {
    description: "Host to bind to",
    required: false,
  });

  port = Option.String("--port", {
    description: "Port to bind to",
    required: false,
  });

  mdns = Option.Boolean("--mdns", false, {
    description: "Enable mDNS discovery",
  });

  dryRun = Option.Boolean("--dry-run", false, {
    description: "Print the resolved startup plan and exit",
  });

  async execute(): Promise<number> {
    const envConfigResult = await this.loadEnvConfig();
    if (!envConfigResult.ok) {
      return envConfigResult.exitCode;
    }
    const envConfig = envConfigResult.value;
    const host = this.host ?? envConfig?.serve?.host ?? "0.0.0.0";
    const rawPort = this.port ?? envConfig?.serve?.port ?? 3000;
    const port = parseServePort(rawPort);
    if (port === null) {
      this.context.stderr.write(
        `Error: Invalid port '${String(rawPort)}'.\nHint: pass an integer between 1 and 65535.\n`
      );
      return 2;
    }
    const mdns = this.mdns || envConfig?.serve?.mdns;
    const format = this.resolveFormat(true);
    const startupPlan = { host, port, mdns, bindUrl: `http://${host}:${port}` };

    if (this.dryRun) {
      if (format === "text") {
        this.context.stdout.write(
          `Would start hub on ${startupPlan.bindUrl} (mdns: ${mdns ? "enabled" : "disabled"}).\n`
        );
      } else {
        writeStructured(this.context.stdout, format, startupPlan);
      }
      return 0;
    }

    const hub = createHub({ hostname: host, port, mdns });

    if (format === "text") {
      this.context.stdout.write(`Hub started at ${hub.url}\n`);
      this.context.stdout.write("Press Ctrl+C to stop\n");
    } else {
      writeStructured(this.context.stdout, format, {
        type: "started",
        timestamp: Date.now(),
        data: {
          ...startupPlan,
          hubUrl: hub.url,
        },
      });
      if (hub.mdnsName) {
        writeStructured(this.context.stdout, format, {
          type: "mdns_registered",
          timestamp: Date.now(),
          data: { name: hub.mdnsName },
        });
      }
    }

    await new Promise<number>((resolve) => {
      const shutdown = (signal: string) => {
        if (format === "text") {
          this.context.stdout.write(`Shutting down (${signal})...\n`);
        } else {
          writeStructured(this.context.stdout, format, {
            type: "signal_received",
            timestamp: Date.now(),
            data: { signal },
          });
        }
        hub.close();
        if (format !== "text") {
          writeStructured(this.context.stdout, format, {
            type: "stopped",
            timestamp: Date.now(),
            data: { signal },
          });
        }
        resolve(0);
      };

      process.once("SIGINT", () => shutdown("SIGINT"));
      process.once("SIGTERM", () => shutdown("SIGTERM"));
    });

    return 0;
  }
}
