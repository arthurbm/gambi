#!/usr/bin/env bun
/**
 * A harness participant hosted in a process of its own, for the tests that
 * send that process a signal. It is what a host does and nothing else: a
 * `Harness.layer` under a participant runtime, run with `BunRuntime.runMain`.
 *
 *   bun harness-host.ts <hubUrl> <roomCode> <participantId> <workspacePath> <fixture mode> <held path>
 *
 * It prints one JSON line when the participant is online, with its own pid
 * and the pid of the harness.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Logger } from "effect";
import { FetchHttpClient } from "effect/http";
import { Socket } from "effect/socket";
import { Harness } from "../harness/harness.ts";
import { HarnessParticipantHandlers } from "../harness/tunnel-handlers.ts";
import { ParticipantRuntime } from "../participant/runtime.ts";
import { type FixtureMode, fixtureHarness } from "./harness-fixtures.ts";

const [hubUrl, roomCode, participantId, workspacePath, mode, held] =
  process.argv.slice(2);
if (
  hubUrl === undefined ||
  roomCode === undefined ||
  participantId === undefined ||
  workspacePath === undefined ||
  mode === undefined
) {
  throw new Error(
    "usage: harness-host.ts <hubUrl> <roomCode> <participantId> <workspacePath> <mode> [held]"
  );
}

const Host = ParticipantRuntime.layer({
  hubUrl,
  roomCode,
  participantId,
  profile: { nickname: "Hosted", model: "fake", harness: { id: "fake" } },
}).pipe(
  Layer.provide(HarnessParticipantHandlers),
  Layer.provideMerge(
    Harness.layer({
      command: fixtureHarness(mode as FixtureMode, held),
      workspacePath,
      stopTimeout: "300 millis",
    })
  ),
  Layer.provide([
    BunServices.layer,
    FetchHttpClient.layer,
    Socket.layerWebSocketConstructorGlobal,
    Logger.layer([]),
  ])
);

BunRuntime.runMain(
  Effect.gen(function* () {
    const harness = yield* Harness;
    yield* Console.log(
      JSON.stringify({ pid: process.pid, harnessPid: harness.pid })
    );
    return yield* Effect.never;
  }).pipe(Effect.provide(Host))
);
