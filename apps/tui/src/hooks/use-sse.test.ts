import { describe, expect, test } from "bun:test";
import {
  buildRemainingBuffer,
  parseSSEBuffer,
  toUint8Array,
  tryParseEvent,
} from "./use-sse";

describe("parseSSEBuffer", () => {
  test("parses single complete event", () => {
    const buffer = 'event: connected\ndata: {"clientId":"abc123"}\n\n';
    const result = parseSSEBuffer(buffer);

    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0]).toEqual({
      event: "connected",
      data: { clientId: "abc123" },
    });
    expect(result.remaining).toBe("");
  });

  test("parses multiple events in buffer", () => {
    const buffer = 'event: a\ndata: {"id":1}\n\nevent: b\ndata: {"id":2}\n\n';
    const result = parseSSEBuffer(buffer);

    expect(result.parsed).toHaveLength(2);
    expect(result.parsed[0]).toEqual({ event: "a", data: { id: 1 } });
    expect(result.parsed[1]).toEqual({ event: "b", data: { id: 2 } });
    expect(result.remaining).toBe("");
  });

  test("handles incomplete event (no trailing newlines)", () => {
    const buffer = 'event: participant:joined\ndata: {"id":"p1"}';
    const result = parseSSEBuffer(buffer);

    expect(result.parsed).toHaveLength(0);
    expect(result.remaining).toContain("event: participant:joined");
    expect(result.remaining).toContain('data: {"id":"p1"}');
  });

  test("preserves remaining data for next chunk", () => {
    const buffer =
      'event: a\ndata: {"complete":true}\n\nevent: b\ndata: {"partial"';
    const result = parseSSEBuffer(buffer);

    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0]).toEqual({ event: "a", data: { complete: true } });
    expect(result.remaining).toContain("event: b");
    expect(result.remaining).toContain('data: {"partial"');
  });

  test("handles malformed JSON gracefully", () => {
    const buffer = "event: test\ndata: {invalid json}\n\n";
    const result = parseSSEBuffer(buffer);

    expect(result.parsed).toHaveLength(0);
    expect(result.remaining).toBe("");
  });

  test("handles empty buffer", () => {
    const result = parseSSEBuffer("");

    expect(result.parsed).toHaveLength(0);
    expect(result.remaining).toBe("");
  });

  test("handles buffer with only newlines", () => {
    const result = parseSSEBuffer("\n\n\n");

    expect(result.parsed).toHaveLength(0);
    expect(result.remaining).toBe("");
  });

  test("handles event without data", () => {
    const buffer = "event: ping\n\n";
    const result = parseSSEBuffer(buffer);

    expect(result.parsed).toHaveLength(0);
    expect(result.remaining).toBe("");
  });
});

describe("toUint8Array", () => {
  test("returns Uint8Array as-is", () => {
    const input = new Uint8Array([1, 2, 3]);
    const result = toUint8Array(input);

    expect(result).toBe(input);
  });

  test("converts ArrayBuffer to Uint8Array", () => {
    const buffer = new ArrayBuffer(3);
    const view = new Uint8Array(buffer);
    view[0] = 1;
    view[1] = 2;
    view[2] = 3;

    const result = toUint8Array(buffer);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBe(3);
    expect(result[0]).toBe(1);
  });

  test("converts ArrayBufferView (DataView) to Uint8Array", () => {
    const buffer = new ArrayBuffer(4);
    const dataView = new DataView(buffer);
    dataView.setUint8(0, 10);
    dataView.setUint8(1, 20);

    const result = toUint8Array(dataView);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBe(4);
    expect(result[0]).toBe(10);
    expect(result[1]).toBe(20);
  });

  test("throws on unexpected type (string)", () => {
    expect(() => toUint8Array("string")).toThrow("Unexpected value type");
  });

  test("throws on unexpected type (number)", () => {
    expect(() => toUint8Array(123)).toThrow("Unexpected value type");
  });

  test("throws on unexpected type (object)", () => {
    expect(() => toUint8Array({ data: [1, 2, 3] })).toThrow(
      "Unexpected value type"
    );
  });
});

describe("tryParseEvent", () => {
  test("parses valid event with JSON data", () => {
    const result = tryParseEvent("connected", '{"clientId":"abc"}');

    expect(result).toEqual({
      event: "connected",
      data: { clientId: "abc" },
    });
  });

  test("returns undefined for empty event type", () => {
    const result = tryParseEvent("", '{"data":true}');

    expect(result).toBeUndefined();
  });

  test("returns undefined for empty data", () => {
    const result = tryParseEvent("event", "");

    expect(result).toBeUndefined();
  });

  test("returns undefined for invalid JSON", () => {
    const result = tryParseEvent("event", "not valid json");

    expect(result).toBeUndefined();
  });

  test("parses nested JSON correctly", () => {
    const result = tryParseEvent("complex", '{"nested":{"deep":{"value":42}}}');

    expect(result).toEqual({
      event: "complex",
      data: { nested: { deep: { value: 42 } } },
    });
  });
});

describe("buildRemainingBuffer", () => {
  test("builds buffer with event and data", () => {
    const result = buildRemainingBuffer("myEvent", '{"key":"value"}');

    expect(result).toBe('event: myEvent\ndata: {"key":"value"}\n');
  });

  test("builds buffer with only event", () => {
    const result = buildRemainingBuffer("myEvent", "");

    expect(result).toBe("event: myEvent\n");
  });

  test("builds buffer with only data", () => {
    const result = buildRemainingBuffer("", '{"key":"value"}');

    expect(result).toBe('data: {"key":"value"}\n');
  });

  test("returns empty string for empty inputs", () => {
    const result = buildRemainingBuffer("", "");

    expect(result).toBe("");
  });
});
