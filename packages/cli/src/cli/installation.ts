/**
 * What the running `gambi` knows about itself: where its executable is, how
 * it was started and on which platform. `self update` reads it to find out
 * how this copy was installed.
 *
 * It is a service so that a command never reads `process` for this: the
 * entrypoint (`main.ts`) answers with the real process, and a test answers
 * with the installation it wants to exercise.
 */
import { Context } from "effect";

export class Installation extends Context.Service<
  Installation,
  {
    /** The CPU architecture, as `process.arch` names it: `x64`, `arm64`. */
    readonly arch: string;
    /** The arguments the process was started with, the executable included. */
    readonly argv: readonly string[];
    /** The absolute path of the running executable. */
    readonly execPath: string;
    readonly pid: number;
    /** The platform, as `process.platform` names it: `linux`, `darwin`, `win32`. */
    readonly platform: string;
  }
>()("gambi/cli/Installation") {}
