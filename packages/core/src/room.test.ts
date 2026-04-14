import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Participant } from "./participant.ts";
import { Room } from "./room.ts";
import type { ParticipantInfoInternal } from "./types.ts";

function createMockParticipant(
  overrides: Partial<ParticipantInfoInternal> = {}
): ParticipantInfoInternal {
  const now = Date.now();
  return {
    id: overrides.id ?? crypto.randomUUID(),
    nickname: overrides.nickname ?? "test-participant",
    model: overrides.model ?? "llama3",
    endpoint: overrides.endpoint ?? "http://localhost:11434",
    specs: overrides.specs ?? {},
    config: overrides.config ?? {},
    capabilities: overrides.capabilities ?? {
      openResponses: "unknown",
      chatCompletions: "unknown",
    },
    status: overrides.status ?? "online",
    joinedAt: overrides.joinedAt ?? now,
    lastSeen: overrides.lastSeen ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

describe("Room", () => {
  beforeEach(() => {
    Room.clear();
  });

  afterEach(() => {
    Room.clear();
  });

  describe("create", () => {
    test("creates a room with unique id and code", async () => {
      const room = await Room.create("Test Room", "host-123");

      expect(room.id).toBeDefined();
      expect(room.code).toBeDefined();
      expect(room.code).toHaveLength(6);
      expect(room.name).toBe("Test Room");
      expect(room.hostId).toBe("host-123");
      expect(room.createdAt).toBeLessThanOrEqual(Date.now());
    });

    test("creates rooms with different codes", async () => {
      const room1 = await Room.create("Room 1", "host-1");
      const room2 = await Room.create("Room 2", "host-2");

      expect(room1.code).not.toBe(room2.code);
      expect(room1.id).not.toBe(room2.id);
    });
  });

  describe("get", () => {
    test("returns room by id", async () => {
      const created = await Room.create("Test", "host");
      const found = Room.get(created.id);

      expect(found).toEqual(created);
    });

    test("returns undefined for non-existent id", () => {
      const found = Room.get("non-existent");
      expect(found).toBeUndefined();
    });
  });

  describe("getByCode", () => {
    test("returns room by code", async () => {
      const created = await Room.create("Test", "host");
      const found = Room.getByCode(created.code);

      expect(found).toEqual(created);
    });

    test("is case-insensitive", async () => {
      const created = await Room.create("Test", "host");
      const found = Room.getByCode(created.code.toLowerCase());

      expect(found).toEqual(created);
    });

    test("returns undefined for non-existent code", () => {
      const found = Room.getByCode("XXXXXX");
      expect(found).toBeUndefined();
    });
  });

  describe("list", () => {
    test("returns empty array when no rooms", () => {
      expect(Room.list()).toEqual([]);
    });

    test("returns all rooms", async () => {
      await Room.create("Room 1", "host-1");
      await Room.create("Room 2", "host-2");

      const rooms = Room.list();
      expect(rooms).toHaveLength(2);
    });
  });

  describe("listWithParticipantCount", () => {
    test("includes participant count", async () => {
      const room = await Room.create("Test", "host");
      const participant = createMockParticipant();
      Room.addParticipant(room.id, participant);

      const rooms = Room.listWithParticipantCount();
      expect(rooms).toHaveLength(1);
      const firstRoom = rooms[0];
      expect(firstRoom).toBeDefined();
      expect(firstRoom?.participantCount).toBe(1);
    });
  });

  describe("getSummaryByCode", () => {
    test("returns a single room summary without scanning all rooms", async () => {
      const room = await Room.create("Test", "host");
      Room.addParticipant(room.id, createMockParticipant());

      const summary = Room.getSummaryByCode(room.code);

      expect(summary).toBeDefined();
      expect(summary?.code).toBe(room.code);
      expect(summary?.participantCount).toBe(1);
    });

    test("returns undefined for non-existent codes", () => {
      expect(Room.getSummaryByCode("XXXXXX")).toBeUndefined();
    });
  });

  describe("remove", () => {
    test("removes existing room", async () => {
      const room = await Room.create("Test", "host");
      const removed = Room.remove(room.id);

      expect(removed).toBe(true);
      expect(Room.get(room.id)).toBeUndefined();
      expect(Room.getByCode(room.code)).toBeUndefined();
    });

    test("returns false for non-existent room", () => {
      const removed = Room.remove("non-existent");
      expect(removed).toBe(false);
    });
  });

  describe("participants", () => {
    test("addParticipant adds participant to room", async () => {
      const room = await Room.create("Test", "host");
      const participant = createMockParticipant();

      const added = Room.addParticipant(room.id, participant);

      expect(added).toBe(true);
      expect(Room.getParticipants(room.id)).toContainEqual(
        Participant.toPublicInfo(participant)
      );
    });

    test("addParticipant returns false for non-existent room", () => {
      const participant = createMockParticipant();
      const added = Room.addParticipant("non-existent", participant);

      expect(added).toBe(false);
    });

    test("removeParticipant removes participant from room", async () => {
      const room = await Room.create("Test", "host");
      const participant = createMockParticipant();
      Room.addParticipant(room.id, participant);

      const removed = Room.removeParticipant(room.id, participant.id);

      expect(removed).toBe(true);
      expect(Room.getParticipants(room.id)).not.toContainEqual(
        Participant.toPublicInfo(participant)
      );
    });

    test("removeParticipant returns false for non-existent participant", async () => {
      const room = await Room.create("Test", "host");
      const removed = Room.removeParticipant(room.id, "non-existent");

      expect(removed).toBe(false);
    });

    test("getParticipant returns specific participant", async () => {
      const room = await Room.create("Test", "host");
      const participant = createMockParticipant();
      Room.addParticipant(room.id, participant);

      const found = Room.getParticipant(room.id, participant.id);

      expect(found).toEqual(Participant.toPublicInfo(participant));
    });

    test("getParticipant returns undefined for non-existent participant", async () => {
      const room = await Room.create("Test", "host");
      const found = Room.getParticipant(room.id, "non-existent");

      expect(found).toBeUndefined();
    });

    test("getParticipants returns empty array for room with no participants", async () => {
      const room = await Room.create("Test", "host");
      expect(Room.getParticipants(room.id)).toEqual([]);
    });

    test("getParticipants returns empty array for non-existent room", () => {
      expect(Room.getParticipants("non-existent")).toEqual([]);
    });

    test("upsertParticipant preserves an explicit joinedAt value of zero", async () => {
      const room = await Room.create("Test", "host");
      const participant = createMockParticipant({
        id: "participant-zero",
        joinedAt: 0,
      });

      const result = Room.upsertParticipant(room.id, participant);

      expect(result?.created).toBe(true);
      expect(result?.participant.joinedAt).toBe(0);
    });
  });

  describe("updateParticipantStatus", () => {
    test("updates participant status", async () => {
      const room = await Room.create("Test", "host");
      const participant = createMockParticipant({ status: "online" });
      Room.addParticipant(room.id, participant);

      const updated = Room.updateParticipantStatus(
        room.id,
        participant.id,
        "busy"
      );

      expect(updated).toBe(true);
      expect(Room.getParticipant(room.id, participant.id)?.status).toBe("busy");
    });

    test("returns false for non-existent participant", async () => {
      const room = await Room.create("Test", "host");
      const updated = Room.updateParticipantStatus(
        room.id,
        "non-existent",
        "busy"
      );

      expect(updated).toBe(false);
    });
  });

  describe("updateLastSeen", () => {
    test("updates lastSeen timestamp and sets status to online", async () => {
      const room = await Room.create("Test", "host");
      const oldTime = Date.now() - 60_000;
      const participant = createMockParticipant({
        lastSeen: oldTime,
        status: "offline",
      });
      Room.addParticipant(room.id, participant);

      const updated = Room.updateLastSeen(room.id, participant.id);

      expect(updated).toBe(true);
      const found = Room.getParticipant(room.id, participant.id);
      expect(found?.lastSeen).toBeGreaterThan(oldTime);
      expect(found?.status).toBe("online");
    });

    test("returns false for non-existent participant", async () => {
      const room = await Room.create("Test", "host");
      const updated = Room.updateLastSeen(room.id, "non-existent");

      expect(updated).toBe(false);
    });
  });

  describe("findParticipantByModel", () => {
    test("finds online participant with matching model", async () => {
      const room = await Room.create("Test", "host");
      const participant = createMockParticipant({
        model: "gpt-4",
        status: "online",
      });
      Room.addParticipant(room.id, participant);

      const found = Room.findParticipantByModel(room.id, "gpt-4");

      expect(found).toEqual(participant);
    });

    test("does not find offline participant", async () => {
      const room = await Room.create("Test", "host");
      const participant = createMockParticipant({
        model: "gpt-4",
        status: "offline",
      });
      Room.addParticipant(room.id, participant);

      const found = Room.findParticipantByModel(room.id, "gpt-4");

      expect(found).toBeUndefined();
    });

    test("returns undefined for non-matching model", async () => {
      const room = await Room.create("Test", "host");
      const participant = createMockParticipant({ model: "gpt-4" });
      Room.addParticipant(room.id, participant);

      const found = Room.findParticipantByModel(room.id, "gpt-3");

      expect(found).toBeUndefined();
    });

    test("returns undefined for non-existent room", () => {
      const found = Room.findParticipantByModel("non-existent", "gpt-4");
      expect(found).toBeUndefined();
    });
  });

  describe("getRandomOnlineParticipant", () => {
    test("returns online participant", async () => {
      const room = await Room.create("Test", "host");
      const participant = createMockParticipant({ status: "online" });
      Room.addParticipant(room.id, participant);

      const found = Room.getRandomOnlineParticipant(room.id);

      expect(found).toEqual(participant);
    });

    test("does not return offline participant", async () => {
      const room = await Room.create("Test", "host");
      const participant = createMockParticipant({ status: "offline" });
      Room.addParticipant(room.id, participant);

      const found = Room.getRandomOnlineParticipant(room.id);

      expect(found).toBeUndefined();
    });

    test("returns undefined for room with no participants", async () => {
      const room = await Room.create("Test", "host");
      const found = Room.getRandomOnlineParticipant(room.id);

      expect(found).toBeUndefined();
    });

    test("returns undefined for non-existent room", () => {
      const found = Room.getRandomOnlineParticipant("non-existent");
      expect(found).toBeUndefined();
    });
  });

  describe("checkStaleParticipants", () => {
    test("marks stale participants as offline and returns them", async () => {
      const room = await Room.create("Test", "host");
      // Create participant with lastSeen 60 seconds ago (well past 30s timeout)
      const staleTime = Date.now() - 60_000;
      const participant = createMockParticipant({
        lastSeen: staleTime,
        status: "online",
      });
      Room.addParticipant(room.id, participant);

      const stale = Room.checkStaleParticipants();

      expect(stale).toHaveLength(1);
      expect(stale[0]).toEqual({
        roomId: room.id,
        participantId: participant.id,
      });
      expect(Room.getParticipant(room.id, participant.id)?.status).toBe(
        "offline"
      );
    });

    test("does not mark recent participants as stale", async () => {
      const room = await Room.create("Test", "host");
      const participant = createMockParticipant({
        lastSeen: Date.now(),
        status: "online",
      });
      Room.addParticipant(room.id, participant);

      const stale = Room.checkStaleParticipants();

      expect(stale).toHaveLength(0);
      expect(Room.getParticipant(room.id, participant.id)?.status).toBe(
        "online"
      );
    });
  });

  describe("clear", () => {
    test("removes all rooms", async () => {
      await Room.create("Room 1", "host-1");
      await Room.create("Room 2", "host-2");

      Room.clear();

      expect(Room.list()).toHaveLength(0);
    });
  });
});
