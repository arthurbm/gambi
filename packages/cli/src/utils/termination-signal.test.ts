import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { onceTerminationSignal } from "./termination-signal.ts";

describe("onceTerminationSignal", () => {
  test("ignores copies of the signal that arrive inside the window", () => {
    const signalProcess = new EventEmitter();
    const received: string[] = [];
    onceTerminationSignal((signal) => received.push(signal), {
      signalProcess,
      windowMs: 50,
    });

    // Ctrl+C: once from the terminal, once relayed by the npm wrapper.
    signalProcess.emit("SIGINT");
    signalProcess.emit("SIGINT");
    signalProcess.emit("SIGTERM");

    expect(received).toEqual(["SIGINT"]);
  });

  test("removes its listeners after the window so a later signal force-quits", async () => {
    const signalProcess = new EventEmitter();
    onceTerminationSignal(() => undefined, { signalProcess, windowMs: 20 });

    signalProcess.emit("SIGTERM");
    expect(signalProcess.listenerCount("SIGINT")).toBe(1);

    await Bun.sleep(40);
    expect(signalProcess.listenerCount("SIGINT")).toBe(0);
    expect(signalProcess.listenerCount("SIGTERM")).toBe(0);
  });

  test("the returned function removes the listeners early", () => {
    const signalProcess = new EventEmitter();
    const dispose = onceTerminationSignal(() => undefined, { signalProcess });

    dispose();

    expect(signalProcess.listenerCount("SIGINT")).toBe(0);
    expect(signalProcess.listenerCount("SIGTERM")).toBe(0);
  });
});
