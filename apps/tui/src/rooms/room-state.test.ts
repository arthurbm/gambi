import { describe, expect, test } from "bun:test";
import { createParticipant, createRoom } from "../__tests__/factories";
import type { RoomEvent } from "../types";
import { applyRoomEvent } from "./room-state";

const AT = { roomCode: "ABC123", timestamp: 1_790_000_000_000 } as const;

const request = {
  ...AT,
  requestId: "req-1",
  participantId: "p1",
  model: "llama3",
  protocol: "chatCompletions",
} as const;

const roomWith = (...participants: ReturnType<typeof createParticipant>[]) =>
  createRoom({
    connected: true,
    participants: new Map(participants.map((it) => [it.id, it])),
  });

describe("applyRoomEvent", () => {
  test("a snapshot replaces what was known of the room", () => {
    const stale = createRoom({
      participants: new Map([["gone", createParticipant("gone", "Gone")]]),
      processingRequests: new Set(["gone"]),
    });
    const snapshot: RoomEvent = {
      ...AT,
      type: "room.snapshot",
      room: {
        id: "room-1",
        code: "ABC123",
        name: "Frevo",
        hostId: "host-1",
        createdAt: 1_790_000_000_000,
        passwordProtected: false,
        participantCount: 2,
      },
      participants: [
        createParticipant("p1", "Arthur", { status: "busy" }),
        createParticipant("p2", "Bia", { status: "offline" }),
      ],
    };

    const { room, log } = applyRoomEvent(stale, snapshot);

    expect(room.connected).toBe(true);
    expect(room.name).toBe("Frevo");
    expect([...room.participants.keys()]).toEqual(["p1", "p2"]);
    // Whoever is `busy` in the snapshot is answering a request right now.
    expect([...room.processingRequests]).toEqual(["p1"]);
    expect(log).toBeUndefined();
  });

  test("a participant that registers again keeps its place and logs nothing", () => {
    const room = roomWith(createParticipant("p1", "Arthur"));

    const result = applyRoomEvent(room, {
      ...AT,
      type: "participant.updated",
      participant: createParticipant("p1", "Arthur", { model: "qwen3" }),
    });

    expect(result.room.participants.get("p1")?.model).toBe("qwen3");
    expect(result.log).toBeUndefined();
  });

  test("a participant that leaves is gone from the room", () => {
    const room = roomWith(createParticipant("p1", "Arthur"));

    const result = applyRoomEvent(room, {
      ...AT,
      type: "participant.removed",
      participantId: "p1",
      reason: "left",
    });

    expect(result.room.participants.size).toBe(0);
    expect(result.log).toEqual({
      type: "leave",
      participantId: "p1",
      participantName: "Arthur",
      message: "Arthur left",
    });
  });

  test("a participant removed for not reconnecting says so in the log", () => {
    const room = roomWith(
      createParticipant("p1", "Arthur", { status: "offline" })
    );

    const result = applyRoomEvent(room, {
      ...AT,
      type: "participant.removed",
      participantId: "p1",
      reason: "reconnectDeadlinePassed",
    });

    expect(result.room.participants.size).toBe(0);
    expect(result.log?.message).toBe("Arthur removed (did not reconnect)");
  });

  test("the removal of a participant the room never showed logs nothing", () => {
    const result = applyRoomEvent(roomWith(), {
      ...AT,
      type: "participant.removed",
      participantId: "p1",
      reason: "left",
    });

    expect(result.log).toBeUndefined();
  });

  test("a request that fails stops being shown and logs its error", () => {
    const room = createRoom({
      participants: new Map([
        ["p1", createParticipant("p1", "Arthur", { status: "busy" })],
      ]),
      processingRequests: new Set(["p1"]),
    });

    const result = applyRoomEvent(room, {
      ...request,
      type: "llm.error",
      stage: "stream",
      code: "participant_disconnected",
      error: "The participant disconnected.",
    });

    expect(result.room.processingRequests.size).toBe(0);
    // The status is the hub's to say: `participant.offline` or
    // `participant.online` follows.
    expect(result.room.participants.get("p1")?.status).toBe("busy");
    expect(result.log).toEqual({
      type: "error",
      participantId: "p1",
      message: "error: The participant disconnected.",
    });
  });

  test("a request does not change the status the hub reported", () => {
    const room = roomWith(createParticipant("p1", "Arthur"));

    const result = applyRoomEvent(room, {
      ...request,
      type: "llm.request",
      modelSelector: "*",
    });

    expect(result.room.participants.get("p1")?.status).toBe("online");
    expect([...result.room.processingRequests]).toEqual(["p1"]);
  });
});
