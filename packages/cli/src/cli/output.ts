/**
 * What a command writes. Every command goes through `Output`, never through
 * `Console` or `process.stdout`, so that one place decides between a line a
 * person reads and a JSON document a program parses (ADR-0002).
 *
 * stdout carries data only: the result of a command, or its events. Errors
 * and log lines go to stderr.
 */
import { Clock, Console, Context, Effect, Layer, Stdio } from "effect";

export const OUTPUT_FORMATS = ["text", "json", "ndjson"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** An error as it is shown: `Output.failure` renders it for the format in use. */
export interface FailureReport {
  /** The fields of the typed error, when it has any. */
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  readonly exitCode: number;
  /** What to do about it. */
  readonly hint?: string | undefined;
  readonly message: string;
  /** The name of the typed error, for example `RoomNotFound`. */
  readonly name: string;
}

export class Output extends Context.Service<
  Output,
  {
    /**
     * One step of a long-running command (`hub serve`, `participant join`).
     * Structured: one JSON line `{ type, timestamp, data }`, whatever the
     * format. Text: the `text` line, or nothing when it is left out.
     */
    readonly event: (
      type: string,
      data: Readonly<Record<string, unknown>>,
      text?: string
    ) => Effect.Effect<void>;
    /** One error, on stderr. Only the top of the CLI calls it (`run.ts`). */
    readonly failure: (report: FailureReport) => Effect.Effect<void>;
    /** `text` when a person reads stdout, `json` or `ndjson` otherwise. */
    readonly format: OutputFormat;
    /**
     * The result of a one-shot command. Structured: `{ "data": value }`,
     * indented for `json` and on one line for `ndjson`. Text: `text(value)`.
     *
     * `value` must already be plain JSON. Encode it with its schema first when
     * the decoded type differs from the wire.
     */
    readonly result: <A>(
      value: A,
      text: (value: A) => string
    ) => Effect.Effect<void>;
  }
>()("gambi/cli/Output") {
  /**
   * `requested` is the `--format` flag. Without it the format follows stdout:
   * `text` on a terminal, `json` otherwise.
   */
  static readonly layer = (
    requested: OutputFormat | undefined
  ): Layer.Layer<Output, never, Stdio.Stdio> =>
    Layer.effect(
      Output,
      Effect.gen(function* () {
        const stdio = yield* Stdio.Stdio;
        const format =
          requested ?? ((yield* stdio.stdoutIsTerminal) ? "text" : "json");

        return Output.of({
          format,
          result: (value, text) =>
            Console.log(
              format === "text"
                ? text(value)
                : JSON.stringify(
                    { data: value },
                    null,
                    format === "json" ? 2 : undefined
                  )
            ),
          event: (type, data, text) =>
            Effect.gen(function* () {
              if (format !== "text") {
                const timestamp = yield* Clock.currentTimeMillis;
                yield* Console.log(JSON.stringify({ type, timestamp, data }));
              } else if (text !== undefined) {
                yield* Console.log(text);
              }
            }),
          failure: (report) =>
            Console.error(
              format === "text"
                ? [
                    `Error (${report.name}): ${report.message}`,
                    ...(report.hint === undefined
                      ? []
                      : [`Hint: ${report.hint}`]),
                  ].join("\n")
                : JSON.stringify({
                    error: {
                      name: report.name,
                      message: report.message,
                      ...(report.hint === undefined
                        ? {}
                        : { hint: report.hint }),
                      ...(report.details === undefined
                        ? {}
                        : { details: report.details }),
                      exitCode: report.exitCode,
                    },
                  })
            ),
        });
      })
    );
}
