import { hostname as getHostname } from "node:os";
import { confirm, intro, text } from "@clack/prompts";
import { createHub } from "@gambi/core/hub";
import { printLogo } from "@gambi/core/logo";
import { Command, Option } from "../utils/option.ts";
import {
  handleCancel,
  hasExplicitFlags,
  isInteractive,
} from "../utils/prompt.ts";

export class ServeCommand extends Command {
  static override paths = [["serve"]];

  static override usage = Command.Usage({
    description: "Start the Gambi hub server",
    examples: [
      ["Start with interactive setup", "gambi serve"],
      ["Start on default port 3000", "gambi serve --port 3000"],
      ["Start on custom port", "gambi serve --port 8080"],
      ["Start with mDNS discovery", "gambi serve --mdns"],
    ],
  });

  port = Option.String("--port,-p", "3000", {
    description: "Port to listen on",
  });

  host = Option.String("--host,-h", "0.0.0.0", {
    description: "Host to bind to",
  });

  mdns = Option.Boolean("--mdns,-m", false, {
    description: "Enable mDNS (Bonjour/Zeroconf) for local network discovery",
  });

  quiet = Option.Boolean("--quiet,-q", false, {
    description: "Suppress logo output",
  });

  async execute(): Promise<number> {
    let port = this.port;
    let host = this.host;
    let mdns = this.mdns;

    if (!hasExplicitFlags() && isInteractive()) {
      intro("gambi serve");

      const portResult = await text({
        message: "Port:",
        defaultValue: "3000",
        placeholder: "3000",
      });
      handleCancel(portResult);
      port = portResult as string;

      const hostResult = await text({
        message: "Host:",
        defaultValue: "0.0.0.0",
        placeholder: "0.0.0.0",
      });
      handleCancel(hostResult);
      host = hostResult as string;

      const mdnsResult = await confirm({
        message: "Enable mDNS discovery?",
        initialValue: false,
      });
      handleCancel(mdnsResult);
      mdns = mdnsResult as boolean;
    }

    if (!this.quiet) {
      printLogo();
    }

    const portNum = Number.parseInt(port, 10);
    if (Number.isNaN(portNum)) {
      this.context.stderr.write(`Invalid port: ${port}\n`);
      return 1;
    }

    const hub = createHub({
      port: portNum,
      hostname: host,
      mdns,
    });

    this.context.stdout.write(`Hub started at ${hub.url}\n`);
    this.context.stdout.write(
      `Health check: http://${host}:${portNum}/health\n`
    );

    if (hub.mdnsName) {
      const localHostname = getHostname();
      this.context.stdout.write(
        `mDNS: http://${localHostname}.local:${portNum}\n`
      );
      this.context.stdout.write(
        `      Service: ${hub.mdnsName}._gambi._tcp.local\n`
      );
    }

    this.context.stdout.write("\nPress Ctrl+C to stop\n");

    process.on("SIGINT", () => {
      this.context.stdout.write("\nShutting down...\n");
      hub.close();
      process.exit(0);
    });

    // Keep process running until SIGINT
    await new Promise(() => undefined);
    return 0;
  }
}
