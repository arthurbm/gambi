import { expect } from "bun:test";
import {
  chatCompletionsOnly,
  FAKE_MODEL,
  fakeProvider,
} from "@gambi/core/testing/provider";
import { it } from "@gambi/testing/effect";
import { Effect } from "effect";
import { probeProvider } from "./participant";

it.live("probes the provider of this machine, with its auth headers", () =>
  Effect.gen(function* () {
    const provider = yield* fakeProvider({ answer: chatCompletionsOnly });

    const probe = yield* Effect.promise(() =>
      probeProvider(provider.url, { Authorization: "Bearer segredo" })
    );

    expect(probe).toEqual({
      reachable: true,
      models: [FAKE_MODEL],
      capabilities: {
        openResponses: "unsupported",
        chatCompletions: "supported",
      },
    });
    const calls = yield* provider.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(
      calls.every((call) => call.headers.authorization === "Bearer segredo")
    ).toBe(true);
  })
);

it.live("a provider that is not there is a probe that found nothing", () =>
  Effect.gen(function* () {
    const probe = yield* Effect.promise(() =>
      probeProvider("http://127.0.0.1:1")
    );

    expect(probe).toEqual({
      reachable: false,
      models: [],
      capabilities: { openResponses: "unknown", chatCompletions: "unknown" },
    });
  })
);
