import { afterEach, describe, expect, test } from "bun:test";
import { ClientError, createClient } from "gambi-sdk";
import { isHubRunning, shutdownHub, useHubStore } from "./hub-store";

const LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:\d+$/;

const hub = () => useHubStore.getState();

/** The code a call to the hub is refused with. */
const refusal = (call: Promise<unknown>) =>
  call.then(
    () => "answered",
    (error: unknown) => (error instanceof ClientError ? error.code : error)
  );

describe("hub hosted by the TUI", () => {
  afterEach(async () => {
    await shutdownHub();
    useHubStore.setState({ status: "stopped", url: null, error: null });
  });

  test("starts a hub in this process that the management client reaches", async () => {
    await hub().start({ port: 0, hostname: "127.0.0.1" });

    const { status, url, error } = hub();
    expect({ status, error }).toEqual({ status: "running", error: null });
    expect(url).toMatch(LOOPBACK_URL);
    expect(isHubRunning()).toBe(true);

    await using client = createClient({ hubUrl: url ?? "" });
    const { room } = await client.rooms.create({ name: "Frevo" });
    // What the monitor does with a room of this hub.
    for await (const event of client.events.watch(room.code)) {
      expect(event).toMatchObject({
        type: "room.snapshot",
        room: { name: "Frevo" },
        participants: [],
      });
      break;
    }
  });

  test("stopping the hub ends what it served and frees its port", async () => {
    await hub().start({ port: 0, hostname: "127.0.0.1" });
    const url = hub().url ?? "";
    await using client = createClient({ hubUrl: url });

    await hub().stop();

    expect(hub()).toMatchObject({ status: "stopped", url: null, error: null });
    expect(isHubRunning()).toBe(false);
    expect(await refusal(client.rooms.list())).toBe("HUB_UNREACHABLE");
    // The port is free again: another hub takes it.
    await hub().start({
      port: Number(new URL(url).port),
      hostname: "127.0.0.1",
    });
    expect(hub()).toMatchObject({ status: "running", url });
  });

  test("a port that is taken is an error that names the port", async () => {
    using taken = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("not a hub"),
    });

    await hub().start({ port: taken.port, hostname: "127.0.0.1" });

    expect(hub().status).toBe("error");
    expect(hub().error).toContain(`Port ${taken.port} is already in use`);
    expect(hub().url).toBeNull();
    expect(isHubRunning()).toBe(false);
    // The failure left nothing behind: starting on a free port works.
    await hub().start({ port: 0, hostname: "127.0.0.1" });
    expect(hub()).toMatchObject({ status: "running", error: null });
  });

  test("a second start does not start a second hub", async () => {
    await hub().start({ port: 0, hostname: "127.0.0.1" });
    const { url } = hub();

    await hub().start({ port: 0, hostname: "127.0.0.1" });

    expect(hub()).toMatchObject({
      status: "running",
      url,
      error: "Hub already running",
    });
  });

  test("stopping closes the event streams of its rooms at once", async () => {
    await hub().start({ port: 0, hostname: "127.0.0.1" });
    await using client = createClient({ hubUrl: hub().url ?? "" });
    const { room } = await client.rooms.create({ name: "Frevo" });
    const watch = client.events.watch(room.code)[Symbol.asyncIterator]();
    await watch.next();

    const started = performance.now();
    await hub().stop();
    const ended = await watch.next();

    expect(ended.done).toBe(true);
    // An open stream would hold a graceful stop for 20 seconds.
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
