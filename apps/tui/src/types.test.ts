import { describe, expect, test } from "bun:test";
import {
  ActivityLogEntry,
  ActivityLogType,
  LogMetrics,
  SSEParticipantUpdatedEvent,
} from "./types";

describe("ActivityLogType", () => {
  test("accepts all valid log types", () => {
    const validTypes = [
      "join",
      "leave",
      "offline",
      "request",
      "complete",
      "error",
    ];

    for (const type of validTypes) {
      const result = ActivityLogType.safeParse(type);
      expect(result.success).toBe(true);
    }
  });

  test("rejects invalid log type", () => {
    const result = ActivityLogType.safeParse("invalid");
    expect(result.success).toBe(false);
  });
});

describe("LogMetrics", () => {
  test("accepts all optional fields", () => {
    const result = LogMetrics.safeParse({
      tokensPerSecond: 42.5,
      latencyMs: 150,
      totalTokens: 1024,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      tokensPerSecond: 42.5,
      latencyMs: 150,
      totalTokens: 1024,
    });
  });

  test("accepts partial metrics (only tokensPerSecond)", () => {
    const result = LogMetrics.safeParse({ tokensPerSecond: 50 });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ tokensPerSecond: 50 });
  });

  test("accepts empty object", () => {
    const result = LogMetrics.safeParse({});

    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
  });

  test("rejects non-number values", () => {
    const result = LogMetrics.safeParse({ tokensPerSecond: "fast" });
    expect(result.success).toBe(false);
  });
});

describe("ActivityLogEntry", () => {
  test("validates complete log entry", () => {
    const entry = {
      id: "log-123",
      timestamp: Date.now(),
      roomCode: "ABC123",
      type: "join",
      participantId: "p1",
      participantName: "Bot1",
      message: "Bot1 joined",
    };

    const result = ActivityLogEntry.safeParse(entry);
    expect(result.success).toBe(true);
  });

  test("validates log entry with metrics", () => {
    const entry = {
      id: "log-456",
      timestamp: Date.now(),
      roomCode: "ABC123",
      type: "complete",
      participantId: "p1",
      message: "complete",
      metrics: { tokensPerSecond: 42, latencyMs: 100 },
    };

    const result = ActivityLogEntry.safeParse(entry);
    expect(result.success).toBe(true);
    expect(result.data?.metrics?.tokensPerSecond).toBe(42);
  });

  test("accepts optional participantId and participantName", () => {
    const entry = {
      id: "log-789",
      timestamp: Date.now(),
      roomCode: "ABC123",
      type: "error",
      message: "Connection failed",
    };

    const result = ActivityLogEntry.safeParse(entry);
    expect(result.success).toBe(true);
  });

  test("rejects invalid log type", () => {
    const entry = {
      id: "log-bad",
      timestamp: Date.now(),
      roomCode: "ABC123",
      type: "unknown",
      message: "test",
    };

    const result = ActivityLogEntry.safeParse(entry);
    expect(result.success).toBe(false);
  });

  test("rejects missing required fields", () => {
    const entry = {
      id: "log-incomplete",
      type: "join",
      message: "test",
      // missing timestamp, roomCode
    };

    const result = ActivityLogEntry.safeParse(entry);
    expect(result.success).toBe(false);
  });
});

describe("SSEParticipantUpdatedEvent", () => {
  test("validates participant update payload with tunnel connection", () => {
    const now = Date.now();
    const result = SSEParticipantUpdatedEvent.safeParse({
      id: "p1",
      nickname: "Bot1",
      model: "llama3",
      endpoint: "http://localhost:11434",
      status: "online",
      joinedAt: now,
      lastSeen: now,
      updatedAt: now,
      specs: {},
      config: { hasInstructions: false },
      capabilities: {
        openResponses: "supported",
        chatCompletions: "unknown",
      },
      connection: {
        kind: "tunnel",
        connected: true,
        lastTunnelSeenAt: now,
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.connection.connected).toBe(true);
  });
});
