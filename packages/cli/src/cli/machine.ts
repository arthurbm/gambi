/**
 * What the operating system says about the hardware of this machine. It is a
 * service, like `Installation`, so that a command never asks the platform
 * itself: the entrypoint (`main.ts`) answers with the real machine, and a
 * test with the machine it wants.
 */
import { Context } from "effect";

export class Machine extends Context.Service<
  Machine,
  {
    /** The model of the processor, when the operating system names it. */
    readonly cpu: string | undefined;
    /** The installed memory, in bytes. */
    readonly memoryBytes: number;
  }
>()("gambi/cli/Machine") {}
