/**
 * The log line a hosting entry hands to `onLog`.
 *
 * A public type lives in a file whose every export is public: the
 * declarations of an entry are bundled from the files its types reach, and a
 * file that also exports something of Effect would drag it into them.
 */

/** One log line of something hosted in this process. Plain JSON. */
export interface LogEntry {
  /** What the line was annotated with: a room code, a participant id, an operation. */
  readonly annotations: Readonly<Record<string, unknown>>;
  /** The failure behind the line, rendered, when it has one. */
  readonly cause?: string;
  /** `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` or `FATAL`. */
  readonly level: string;
  readonly message: unknown;
  /** ISO 8601. */
  readonly timestamp: string;
}
