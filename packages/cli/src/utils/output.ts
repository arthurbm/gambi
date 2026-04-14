import type { OutputFormat } from "./agent-command.ts";

export function writeStructured(
  stdout: NodeJS.WritableStream,
  format: OutputFormat,
  value: unknown
): void {
  if (format === "ndjson") {
    stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }

  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
