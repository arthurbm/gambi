import { describe, expect, test } from "bun:test";
import { participants } from "./participants.ts";

describe("SDK participants namespace", () => {
  test("re-exports Participant functions", () => {
    expect(participants.create).toBeDefined();
    expect(participants.mergeConfig).toBeDefined();
  });

  test("creates participant with defaults", () => {
    const participant = participants.create({
      nickname: "Test Bot",
      model: "llama3",
      endpoint: "http://localhost:11434",
    });

    expect(participant.nickname).toBe("Test Bot");
    expect(participant.model).toBe("llama3");
    expect(participant.endpoint).toBe("http://localhost:11434");
    expect(participant.status).toBe("offline");
    expect(participant.connection.connected).toBe(false);
    expect(participant.specs).toEqual({});
    expect(participant.config).toEqual({});
  });

  test("merges config correctly", () => {
    const base = { temperature: 0.7, max_tokens: 1000 };
    const override = { temperature: 0.5 };

    const merged = participants.mergeConfig(base, override);

    expect(merged.temperature).toBe(0.5);
    expect(merged.max_tokens).toBe(1000);
  });
});
