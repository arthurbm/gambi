import { describe, expect, test } from "bun:test";
import { Participant } from "./participant.ts";

describe("Participant", () => {
  describe("create", () => {
    test("creates participant with required fields", () => {
      const participant = Participant.create({
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      expect(participant.id).toBeDefined();
      expect(participant.nickname).toBe("test-user");
      expect(participant.model).toBe("llama3");
      expect(participant.endpoint).toBe("http://localhost:11434");
      expect(participant.status).toBe("offline");
      expect(participant.connection.connected).toBe(false);
      expect(participant.joinedAt).toBeLessThanOrEqual(Date.now());
      expect(participant.lastSeen).toBeLessThanOrEqual(Date.now());
    });

    test("creates participant with default empty specs", () => {
      const participant = Participant.create({
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      expect(participant.specs).toEqual({});
    });

    test("creates participant with default empty config", () => {
      const participant = Participant.create({
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      expect(participant.config).toEqual({});
    });

    test("creates participant with custom specs", () => {
      const specs = {
        gpu: "RTX 4090",
        vram: 24,
        ram: 64,
        cpu: "AMD Ryzen 9",
      };

      const participant = Participant.create({
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
        specs,
      });

      expect(participant.specs).toEqual(specs);
    });

    test("creates participant with custom config", () => {
      const config = {
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 2048,
      };

      const participant = Participant.create({
        nickname: "test-user",
        model: "llama3",
        endpoint: "http://localhost:11434",
        config,
      });

      expect(participant.config).toEqual(config);
    });

    test("creates unique ids for different participants", () => {
      const p1 = Participant.create({
        nickname: "user-1",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      const p2 = Participant.create({
        nickname: "user-2",
        model: "llama3",
        endpoint: "http://localhost:11434",
      });

      expect(p1.id).not.toBe(p2.id);
    });
  });

  describe("mergeConfig", () => {
    test("merges empty override with base config", () => {
      const base = {
        temperature: 0.7,
        max_tokens: 1000,
      };

      const result = Participant.mergeConfig(base, {});

      expect(result).toEqual(base);
    });

    test("overrides base config with new values", () => {
      const base = {
        temperature: 0.7,
        max_tokens: 1000,
      };

      const result = Participant.mergeConfig(base, {
        temperature: 0.5,
      });

      expect(result.temperature).toBe(0.5);
      expect(result.max_tokens).toBe(1000);
    });

    test("adds new config values", () => {
      const base = {
        temperature: 0.7,
      };

      const result = Participant.mergeConfig(base, {
        max_tokens: 2000,
        top_p: 0.9,
      });

      expect(result.temperature).toBe(0.7);
      expect(result.max_tokens).toBe(2000);
      expect(result.top_p).toBe(0.9);
    });

    test("handles undefined override", () => {
      const base = {
        temperature: 0.7,
      };

      const result = Participant.mergeConfig(base, undefined);

      expect(result).toEqual(base);
    });

    test("handles empty base config", () => {
      const result = Participant.mergeConfig(
        {},
        {
          temperature: 0.5,
        }
      );

      expect(result.temperature).toBe(0.5);
    });
  });
});
