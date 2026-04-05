import { createHub } from "@gambi/core/hub";
import { AgentCommand } from "../utils/agent-command.ts";
import { loadCliConfig, resolveEnvConfig } from "../utils/cli-config.ts";
import { Command, Option } from "../utils/option.ts";
import { writeStructured } from "../utils/output.ts";

export class HubServeCommand extends AgentCommand {
  static override paths = [["hub", "serve"]];

  static override usage = Command.Usage({
    description: "Start the hub management and inference server",
    details:
      "Starts the Gambi hub. Prefer --format ndjson for machine supervision and --dry-run for startup validation.",
    examples: [
      ["Start the hub", "gambi hub serve"],
      ["Preview startup", "gambi hub serve --dry-run --format json"],
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
    const config = await loadCliConfig(this.resolveConfigPath());
    const envConfig = resolveEnvConfig(config, this.env);
    const host = this.host ?? envConfig?.serve?.host ?? "0.0.0.0";
    const port = Number(this.port ?? envConfig?.serve?.port ?? 3000);
    const mdns = this.mdns || envConfig?.serve?.mdns || false;
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
      writeStructured(this.context.stdout, "ndjson", {
        type: "started",
        timestamp: Date.now(),
        data: {
          ...startupPlan,
          hubUrl: hub.url,
        },
      });
      if (hub.mdnsName) {
        writeStructured(this.context.stdout, "ndjson", {
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
          writeStructured(this.context.stdout, "ndjson", {
            type: "signal_received",
            timestamp: Date.now(),
            data: { signal },
          });
        }
        hub.close();
        if (format !== "text") {
          writeStructured(this.context.stdout, "ndjson", {
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
