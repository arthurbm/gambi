import { afterEach, describe, expect, mock, test } from "bun:test";
import { z } from "zod";
import {
  createErrorResult,
  createSuccessResult,
  fetchJson,
} from "./use-hub-api";

const TestSchema = z.object({
  id: z.string(),
  name: z.string(),
});

// Mock fetch for testing
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createErrorResult", () => {
  test("returns null data and error message", () => {
    const result = createErrorResult<string>("Something went wrong");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Something went wrong");
  });
});

describe("createSuccessResult", () => {
  test("returns data and null error", () => {
    const result = createSuccessResult({ id: "123", name: "Test" });

    expect(result.data).toEqual({ id: "123", name: "Test" });
    expect(result.error).toBeNull();
  });
});

describe("fetchJson", () => {
  test("returns success with valid response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "1", name: "Test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    ) as unknown as typeof fetch;

    const result = await fetchJson("http://test.com/api", TestSchema);

    expect(result.data).toEqual({ id: "1", name: "Test" });
    expect(result.error).toBeNull();
  });

  test("returns error on Zod validation failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 123, name: "Test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    ) as unknown as typeof fetch;

    const result = await fetchJson("http://test.com/api", TestSchema);

    expect(result.data).toBeNull();
    expect(result.error).toContain("Invalid response");
  });

  test("returns error on HTTP error status", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 500,
          statusText: "Internal Server Error",
        })
      )
    ) as unknown as typeof fetch;

    const result = await fetchJson("http://test.com/api", TestSchema);

    expect(result.data).toBeNull();
    expect(result.error).toContain("500");
  });

  test("extracts error message from response body", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { message: "Room not found" },
          }),
          {
            status: 404,
            statusText: "Not Found",
          }
        )
      )
    ) as unknown as typeof fetch;

    const result = await fetchJson("http://test.com/api", TestSchema);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Room not found");
  });

  test("falls back to HTTP status on invalid error body", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("not json", {
          status: 400,
          statusText: "Bad Request",
        })
      )
    ) as unknown as typeof fetch;

    const result = await fetchJson("http://test.com/api", TestSchema);

    expect(result.data).toBeNull();
    expect(result.error).toContain("400");
  });

  test("returns error on network failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Failed to fetch"))
    ) as unknown as typeof fetch;

    const result = await fetchJson("http://test.com/api", TestSchema);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Failed to fetch");
  });

  test("returns generic error for non-Error exceptions", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject("string error")
    ) as unknown as typeof fetch;

    const result = await fetchJson("http://test.com/api", TestSchema);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Network error");
  });

  test("sends correct headers", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: "1", name: "Test" }), {
          status: 200,
        })
      )
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await fetchJson("http://test.com/api", TestSchema, {
      method: "POST",
      body: JSON.stringify({ test: true }),
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calls = mockFetch.mock.calls as unknown as [string, RequestInit?][];
    const options = calls[0]?.[1];
    expect(options?.headers).toHaveProperty("Content-Type", "application/json");
  });
});
