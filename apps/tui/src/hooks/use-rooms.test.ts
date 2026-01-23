import { describe, expect, test } from "bun:test";
import {
  createParticipant,
  createRoom,
  createRoomWithParticipants,
} from "../__tests__/factories";
import {
  handleConnectedEvent,
  handleLlmCompleteEvent,
  handleLlmErrorEvent,
  handleLlmRequestEvent,
  handleParticipantJoinedEvent,
  handleParticipantLeftEvent,
  handleParticipantOfflineEvent,
  handleRoomCreatedEvent,
} from "./use-rooms";

describe("handleConnectedEvent", () => {
  test("sets connected to true", () => {
    const room = createRoom({ connected: false });
    const result = handleConnectedEvent(room);

    expect(result.room.connected).toBe(true);
  });

  test("returns no log action", () => {
    const room = createRoom();
    const result = handleConnectedEvent(room);

    expect(result.log).toBeUndefined();
  });
});

describe("handleRoomCreatedEvent", () => {
  test("updates room name when code matches", () => {
    const room = createRoom({ code: "ABC123", name: "ABC123" });
    const data = { code: "ABC123", name: "My Room" };
    const result = handleRoomCreatedEvent(room, "ABC123", data);

    expect(result.room.name).toBe("My Room");
  });

  test("returns unchanged room when code does not match", () => {
    const room = createRoom({ code: "ABC123", name: "Original" });
    const data = { code: "XYZ789", name: "Other Room" };
    const result = handleRoomCreatedEvent(room, "ABC123", data);

    expect(result.room.name).toBe("Original");
  });

  test("returns unchanged room on invalid data", () => {
    const room = createRoom({ name: "Original" });
    const result = handleRoomCreatedEvent(room, "ABC123", { invalid: true });

    expect(result.room.name).toBe("Original");
  });

  test("returns no log action", () => {
    const room = createRoom({ code: "ABC123" });
    const data = { code: "ABC123", name: "My Room" };
    const result = handleRoomCreatedEvent(room, "ABC123", data);

    expect(result.log).toBeUndefined();
  });
});

describe("handleParticipantJoinedEvent", () => {
  test("adds participant to room", () => {
    const room = createRoom();
    const data = {
      id: "p1",
      nickname: "Bot1",
      model: "llama3",
      endpoint: "http://localhost:11434",
      status: "online",
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      specs: {},
      config: {},
    };
    const result = handleParticipantJoinedEvent(room, data);

    expect(result.room.participants.has("p1")).toBe(true);
    expect(result.room.participants.get("p1")?.nickname).toBe("Bot1");
  });

  test("creates log entry with type join", () => {
    const room = createRoom();
    const data = {
      id: "p1",
      nickname: "Bot1",
      model: "llama3",
      endpoint: "http://localhost:11434",
      status: "online",
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      specs: {},
      config: {},
    };
    const result = handleParticipantJoinedEvent(room, data);

    expect(result.log).toBeDefined();
    expect(result.log?.type).toBe("join");
    expect(result.log?.participantId).toBe("p1");
    expect(result.log?.participantName).toBe("Bot1");
    expect(result.log?.message).toBe("Bot1 joined");
  });

  test("returns unchanged room on invalid data", () => {
    const room = createRoom();
    const result = handleParticipantJoinedEvent(room, { invalid: true });

    expect(result.room.participants.size).toBe(0);
    expect(result.log).toBeUndefined();
  });
});

describe("handleParticipantLeftEvent", () => {
  test("removes participant from room", () => {
    const room = createRoomWithParticipants(2);
    const result = handleParticipantLeftEvent(room, { participantId: "p1" });

    expect(result.room.participants.has("p1")).toBe(false);
    expect(result.room.participants.has("p2")).toBe(true);
  });

  test("creates log entry with type leave", () => {
    const room = createRoomWithParticipants(1);
    const result = handleParticipantLeftEvent(room, { participantId: "p1" });

    expect(result.log).toBeDefined();
    expect(result.log?.type).toBe("leave");
    expect(result.log?.participantId).toBe("p1");
    expect(result.log?.participantName).toBe("Bot1");
    expect(result.log?.message).toBe("Bot1 left");
  });

  test("returns unchanged room on invalid data", () => {
    const room = createRoomWithParticipants(1);
    const result = handleParticipantLeftEvent(room, { invalid: true });

    expect(result.room.participants.size).toBe(1);
    expect(result.log).toBeUndefined();
  });

  test("returns no log for unknown participant", () => {
    const room = createRoom();
    const result = handleParticipantLeftEvent(room, {
      participantId: "unknown",
    });

    expect(result.log).toBeUndefined();
  });
});

describe("handleParticipantOfflineEvent", () => {
  test("marks participant as offline", () => {
    const room = createRoomWithParticipants(1);
    const result = handleParticipantOfflineEvent(room, { participantId: "p1" });

    expect(result.room.participants.get("p1")?.status).toBe("offline");
  });

  test("creates log entry with type offline", () => {
    const room = createRoomWithParticipants(1);
    const result = handleParticipantOfflineEvent(room, { participantId: "p1" });

    expect(result.log).toBeDefined();
    expect(result.log?.type).toBe("offline");
    expect(result.log?.participantId).toBe("p1");
    expect(result.log?.message).toBe("Bot1 offline");
  });

  test("returns unchanged room on invalid data", () => {
    const room = createRoomWithParticipants(1);
    const result = handleParticipantOfflineEvent(room, { invalid: true });

    expect(result.room.participants.get("p1")?.status).toBe("online");
    expect(result.log).toBeUndefined();
  });

  test("returns unchanged room for unknown participant", () => {
    const room = createRoom();
    const result = handleParticipantOfflineEvent(room, {
      participantId: "unknown",
    });

    expect(result.log).toBeUndefined();
  });
});

describe("handleLlmRequestEvent", () => {
  test("marks participant as busy", () => {
    const room = createRoomWithParticipants(1);
    const result = handleLlmRequestEvent(room, {
      participantId: "p1",
      model: "llama3",
    });

    expect(result.room.participants.get("p1")?.status).toBe("busy");
  });

  test("adds participantId to processingRequests", () => {
    const room = createRoomWithParticipants(1);
    const result = handleLlmRequestEvent(room, {
      participantId: "p1",
      model: "llama3",
    });

    expect(result.room.processingRequests.has("p1")).toBe(true);
  });

  test("creates request log entry with model info", () => {
    const room = createRoomWithParticipants(1);
    const result = handleLlmRequestEvent(room, {
      participantId: "p1",
      model: "llama3",
    });

    expect(result.log).toBeDefined();
    expect(result.log?.type).toBe("request");
    expect(result.log?.participantId).toBe("p1");
    expect(result.log?.message).toContain("llama3");
  });

  test("returns unchanged room on invalid data", () => {
    const room = createRoomWithParticipants(1);
    const result = handleLlmRequestEvent(room, { invalid: true });

    expect(result.room.processingRequests.size).toBe(0);
    expect(result.log).toBeUndefined();
  });
});

describe("handleLlmCompleteEvent", () => {
  test("sets participant back to online", () => {
    const participants = new Map();
    participants.set("p1", createParticipant("p1", "Bot1", { status: "busy" }));
    const room = createRoom({
      participants,
      processingRequests: new Set(["p1"]),
    });

    const result = handleLlmCompleteEvent(room, {
      participantId: "p1",
      metrics: { tokensPerSecond: 50 },
    });

    expect(result.room.participants.get("p1")?.status).toBe("online");
  });

  test("removes from processingRequests", () => {
    const room = createRoom({ processingRequests: new Set(["p1"]) });
    const result = handleLlmCompleteEvent(room, {
      participantId: "p1",
      metrics: {},
    });

    expect(result.room.processingRequests.has("p1")).toBe(false);
  });

  test("includes metrics in log entry", () => {
    const room = createRoomWithParticipants(1);
    const result = handleLlmCompleteEvent(room, {
      participantId: "p1",
      metrics: { tokensPerSecond: 42, latencyMs: 100 },
    });

    expect(result.log).toBeDefined();
    expect(result.log?.type).toBe("complete");
    expect(result.log?.metrics?.tokensPerSecond).toBe(42);
    expect(result.log?.metrics?.latencyMs).toBe(100);
  });

  test("returns unchanged room on invalid data", () => {
    const room = createRoom({ processingRequests: new Set(["p1"]) });
    const result = handleLlmCompleteEvent(room, { invalid: true });

    expect(result.room.processingRequests.has("p1")).toBe(true);
    expect(result.log).toBeUndefined();
  });
});

describe("handleLlmErrorEvent", () => {
  test("sets participant back to online", () => {
    const participants = new Map();
    participants.set("p1", createParticipant("p1", "Bot1", { status: "busy" }));
    const room = createRoom({
      participants,
      processingRequests: new Set(["p1"]),
    });

    const result = handleLlmErrorEvent(room, {
      participantId: "p1",
      error: "Connection failed",
    });

    expect(result.room.participants.get("p1")?.status).toBe("online");
  });

  test("removes from processingRequests", () => {
    const room = createRoom({ processingRequests: new Set(["p1"]) });
    const result = handleLlmErrorEvent(room, {
      participantId: "p1",
      error: "Timeout",
    });

    expect(result.room.processingRequests.has("p1")).toBe(false);
  });

  test("includes error message in log", () => {
    const room = createRoomWithParticipants(1);
    const result = handleLlmErrorEvent(room, {
      participantId: "p1",
      error: "Connection refused",
    });

    expect(result.log).toBeDefined();
    expect(result.log?.type).toBe("error");
    expect(result.log?.message).toContain("Connection refused");
  });

  test("returns unchanged room on invalid data", () => {
    const room = createRoom({ processingRequests: new Set(["p1"]) });
    const result = handleLlmErrorEvent(room, { invalid: true });

    expect(result.room.processingRequests.has("p1")).toBe(true);
    expect(result.log).toBeUndefined();
  });
});
