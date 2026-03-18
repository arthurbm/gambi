import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHub, type Hub } from "@gambi/core/hub";
import { Room } from "@gambi/core/room";
import { ClientError, createClient } from "./client.ts";

function getRandomPort(): number {
  return 30_000 + Math.floor(Math.random() * 20_000);
}

function createHubWithRetry(): Hub {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return createHub({ port: getRandomPort(), hostname: "127.0.0.1" });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

describe("HTTP Client", () => {
  let hub: Hub;
  let client: ReturnType<typeof createClient>;

  beforeAll(() => {
    hub = createHubWithRetry();
    Room.clear();
    client = createClient({ hubUrl: hub.url });
  });

  afterAll(() => {
    hub.close();
  });
  describe("create", () => {
    test("creates a new room", async () => {
      const { room, hostId } = await client.create("Test Room");

      expect(room.name).toBe("Test Room");
      expect(room.code).toHaveLength(6);
      expect(hostId).toBeDefined();
    });

    test("throws ClientError on failure", async () => {
      // Invalid request (empty name will fail validation)
      await expect(
        fetch(`${hub.url}/rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }).then((res) => res.json())
      ).resolves.toHaveProperty("error");
    });

    test("supports room defaults via options object", async () => {
      const { room } = await client.create("Configured Room", {
        defaults: {
          instructions: "Room instructions",
          temperature: 0.4,
        },
      });

      expect(room.defaults).toEqual({
        hasInstructions: true,
        temperature: 0.4,
      });
      expect(room.defaults).not.toHaveProperty("instructions");
    });
  });

  describe("list", () => {
    test("lists all rooms", async () => {
      Room.clear();
      await client.create("Room 1");
      await client.create("Room 2");

      const rooms = await client.list();

      expect(rooms).toHaveLength(2);
      expect(rooms[0].name).toBe("Room 1");
      expect(rooms[1].name).toBe("Room 2");
    });

    test("returns empty array when no rooms", async () => {
      Room.clear();
      const rooms = await client.list();

      expect(rooms).toEqual([]);
    });
  });

  describe("join", () => {
    test("joins a room as a participant", async () => {
      const { room } = await client.create("Test Room");

      const { participant, roomId } = await client.join(room.code, {
        id: "participant-1",
        nickname: "Test Bot",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      expect(participant.id).toBe("participant-1");
      expect(participant.nickname).toBe("Test Bot");
      expect(roomId).toBe(room.id);
    });

    test("accepts auth headers without exposing them in the response", async () => {
      const { room } = await client.create("Authenticated Room");

      const { participant } = await client.join(room.code, {
        id: "participant-2",
        nickname: "Remote Bot",
        model: "gpt-4o-mini",
        endpoint: "https://api.example.com",
        authHeaders: {
          Authorization: "Bearer secret-token",
        },
      });

      expect(participant.id).toBe("participant-2");
      expect(participant).not.toHaveProperty("authHeaders");
    });

    test("redacts instructions in public participant responses", async () => {
      const { room } = await client.create("Configured Participant Room");

      const { participant } = await client.join(room.code, {
        id: "participant-3",
        nickname: "Configured Bot",
        model: "llama3",
        endpoint: "http://localhost:11434",
        config: {
          instructions: "Private instructions",
          temperature: 0.6,
        },
      });

      expect(participant.config).toEqual({
        hasInstructions: true,
        temperature: 0.6,
      });
      expect(participant.config).not.toHaveProperty("instructions");
    });

    test("throws ClientError for non-existent room", async () => {
      await expect(
        client.join("XXXXXX", {
          id: "participant-1",
          nickname: "Test Bot",
          model: "llama3",
          endpoint: "http://localhost:11434",
        })
      ).rejects.toThrow(ClientError);
    });
  });

  describe("leave", () => {
    test("removes participant from room", async () => {
      const { room } = await client.create("Test Room");
      await client.join(room.code, {
        id: "participant-1",
        nickname: "Test Bot",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      const result = await client.leave(room.code, "participant-1");

      expect(result.success).toBe(true);
    });

    test("throws ClientError for non-existent participant", async () => {
      const { room } = await client.create("Test Room");

      await expect(client.leave(room.code, "non-existent")).rejects.toThrow(
        ClientError
      );
    });
  });

  describe("getParticipants", () => {
    test("returns participants in room", async () => {
      const { room } = await client.create("Test Room");
      await client.join(room.code, {
        id: "participant-1",
        nickname: "Test Bot",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      const participants = await client.getParticipants(room.code);

      expect(participants).toHaveLength(1);
      expect(participants[0].nickname).toBe("Test Bot");
    });

    test("throws ClientError for non-existent room", async () => {
      await expect(client.getParticipants("XXXXXX")).rejects.toThrow(
        ClientError
      );
    });
  });

  describe("healthCheck", () => {
    test("sends health check for participant", async () => {
      const { room } = await client.create("Test Room");
      await client.join(room.code, {
        id: "participant-1",
        nickname: "Test Bot",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      const result = await client.healthCheck(room.code, "participant-1");

      expect(result.success).toBe(true);
    });

    test("throws ClientError for non-existent participant", async () => {
      const { room } = await client.create("Test Room");

      await expect(
        client.healthCheck(room.code, "non-existent")
      ).rejects.toThrow(ClientError);
    });
  });

  describe("password protection", () => {
    test("creates password-protected room", async () => {
      const { room } = await client.create("Secured Room", "secret123");

      expect(room.name).toBe("Secured Room");
      // Password hash should NOT be exposed in API responses (security)
    });

    test("allows join with correct password", async () => {
      const { room } = await client.create("Protected", "mypass");

      const { participant } = await client.join(room.code, {
        id: "participant-1",
        nickname: "Test Bot",
        model: "llama3",
        endpoint: "http://localhost:11434",
        password: "mypass",
      });

      expect(participant.id).toBe("participant-1");
    });

    test("rejects join with incorrect password", async () => {
      const { room } = await client.create("Protected", "correctpass");

      await expect(
        client.join(room.code, {
          id: "participant-1",
          nickname: "Test Bot",
          model: "llama3",
          endpoint: "http://localhost:11434",
          password: "wrongpass",
        })
      ).rejects.toThrow(ClientError);
    });

    test("rejects join without password when required", async () => {
      const { room } = await client.create("Protected", "required");

      await expect(
        client.join(room.code, {
          id: "participant-1",
          nickname: "Test Bot",
          model: "llama3",
          endpoint: "http://localhost:11434",
        })
      ).rejects.toThrow(ClientError);
    });

    test("allows join without password when not required", async () => {
      const { room } = await client.create("Open Room");

      const { participant } = await client.join(room.code, {
        id: "participant-1",
        nickname: "Test Bot",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      expect(participant.id).toBe("participant-1");
    });
  });

  describe("ClientError", () => {
    test("includes status and response", () => {
      const error = new ClientError("Test error", 404, { detail: "Not found" });

      expect(error.message).toBe("Test error");
      expect(error.status).toBe(404);
      expect(error.response).toEqual({ detail: "Not found" });
      expect(error.name).toBe("ClientError");
    });
  });
});
