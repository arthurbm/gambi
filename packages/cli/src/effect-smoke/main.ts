/**
 * The smallest entrypoint that proves `effect` and `@effect/platform-bun`
 * survive `bun build --compile`. `effect-binary.test.ts` compiles and runs it.
 * The CLI rewrite over `effect/cli` replaces it with the real binary smoke.
 */
import "@gambi/protocol";
import { BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Schema } from "effect";

class SmokeFailed extends Schema.TaggedError<SmokeFailed>()("SmokeFailed", {
  flag: Schema.String,
}) {}

const Report = Schema.Struct({
  greeting: Schema.String,
  runtime: Schema.Literals(["bun", "node"]),
});

const program = Effect.gen(function* () {
  if (process.argv.includes("--fail")) {
    return yield* new SmokeFailed({ flag: "--fail" });
  }
  const report = yield* Schema.decodeUnknownEffect(Report)({
    greeting: "hello from effect",
    runtime: "bun",
  });
  yield* Console.log(JSON.stringify(report));
});

BunRuntime.runMain(program);
