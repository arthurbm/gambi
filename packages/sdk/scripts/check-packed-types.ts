#!/usr/bin/env bun
/**
 * Checks gambi-sdk as an outside consumer gets it: packs the package (or
 * takes a registry spec), installs it into a fresh temp project that has no
 * `effect`, no `zod` and no `@gambi/*`, and then:
 *
 * 1. reads every published declaration and rejects an import of a package
 *    the consumer does not get, which is how a type of Effect would leak into
 *    the public signatures (and how `@gambi/core` once did, issue #82);
 * 2. reads the JavaScript of every entry and rejects an import of another
 *    file of the package, of an undeclared package, or of a runtime the entry
 *    does not promise (`runsOn` in `entries.ts`);
 * 3. loads every entry that runs in Node, in Node, and compares what it
 *    exports with the list below;
 * 4. runs `tsc` against a file that uses the public types. With
 *    `skipLibCheck: true` a broken import turns every SDK type into `any`
 *    silently, so the consumer file marks deliberate type errors with
 *    `@ts-expect-error`: if the types degrade to `any`, the directive is
 *    unused and `tsc` fails.
 *
 * Usage:
 *   bun run scripts/check-packed-types.ts          # pack the local dist/
 *   bun run scripts/check-packed-types.ts 0.8.0    # registry version
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";
import ts from "typescript";
import { type Entry, entries } from "../entries.ts";

const sdkDir = resolve(import.meta.dir, "..");
// A registry version such as "0.8.0" (or "gambi-sdk@0.8.0"); empty packs dist/.
const spec = process.argv[2]?.replace(/^gambi-sdk@/, "");

/**
 * What each entry exports at runtime, by subpath. Types are not listed: a
 * value that appears here without being meant to (a schema, a hub) fails the
 * check, and so does an entry of `entries.ts` that has no line.
 */
const RUNTIME_EXPORTS: Record<string, readonly string[]> = {
  ".": ["ClientError", "createClient", "createGambi"],
  "./discovery": [
    "DiscoveryError",
    "discoverHubs",
    "discoverRooms",
    "resolveGambiTarget",
  ],
};

/** Packages whose types must never reach a consumer, named for the message. */
const NEVER_IN_DECLARATIONS = /^(effect|@effect\/.+|zod|@gambi\/.+)$/;

const CONSUMER = `import {
  ClientError,
  type ClientErrorCode,
  createClient,
  createGambi,
  type GambiClient,
  type ParticipantSummary,
  type RoomEvent,
  type RoomSummary,
} from "gambi-sdk";
import { type DiscoveredHub, discoverHubs } from "gambi-sdk/discovery";

const client: GambiClient = createClient({ hubUrl: "http://localhost:3000" });
const provider = createGambi({ roomCode: "ABC123" });
const hubs: Promise<DiscoveredHub[]> = discoverHubs();

async function roomNames(): Promise<string[]> {
  const rooms: readonly RoomSummary[] = await client.rooms.list();
  return rooms.map((room) => room.name);
}

async function onlineNicknames(roomCode: string): Promise<string[]> {
  const participants: readonly ParticipantSummary[] =
    await client.participants.list(roomCode);
  return participants
    .filter((participant) => participant.status === "online")
    .map((participant) => participant.nickname);
}

// The events are a union told apart by \`type\`, and the watch is a plain
// AsyncIterable: no type of Effect is needed to consume it.
async function watch(roomCode: string, signal: AbortSignal): Promise<string[]> {
  const seen: string[] = [];
  const events: AsyncIterable<RoomEvent> = client.events.watch(roomCode, { signal });
  for await (const event of events) {
    switch (event.type) {
      case "room.snapshot":
        seen.push(...event.participants.map((participant) => participant.id));
        break;
      case "participant.removed":
        seen.push(\`\${event.participantId} \${event.reason}\`);
        break;
      case "llm.request":
        seen.push(\`\${event.requestId} \${event.modelSelector}\`);
        break;
      case "llm.complete":
        seen.push(\`\${event.requestId} \${event.status} \${event.metrics.durationMs}\`);
        break;
      case "llm.error":
        seen.push(\`\${event.requestId} \${event.stage} \${event.code}\`);
        break;
      default:
        seen.push(\`\${event.participant.id} \${event.participant.status}\`);
    }
  }
  return seen;
}

function describe(error: unknown): ClientErrorCode | "unknown" {
  return error instanceof ClientError ? error.code : "unknown";
}

// Deliberate type errors. If the SDK types degrade to \`any\`, these
// directives go unused and tsc reports TS2578.
// @ts-expect-error a room code is a string
const badCode: RoomSummary["code"] = 42;
// @ts-expect-error a status is "offline" | "online" | "busy"
const badStatus: ParticipantSummary["status"] = "away";
// @ts-expect-error there is no such event
const badEventType: RoomEvent["type"] = "room.created";
// @ts-expect-error there is no such code
const badErrorCode: ClientErrorCode = "PARTICIPANT_BUSY";
// @ts-expect-error a room is read by its code, a string
const badCall = client.rooms.get(42);
// @ts-expect-error the client returns the room, not an envelope around it
const badEnvelope = client.rooms.get("ABC123").then((room) => room.data);
// @ts-expect-error the client has no hub to host and no room state
const badHub = client.rooms.clear;
// @ts-expect-error a method returns a Promise, not an Effect to pipe
const badEffect = client.rooms.list().pipe;

export {
  badCall,
  badCode,
  badEffect,
  badEnvelope,
  badErrorCode,
  badEventType,
  badHub,
  badStatus,
  describe,
  hubs,
  onlineNicknames,
  provider,
  roomNames,
  watch,
};
`;

const MATRIX = [
  {
    module: "nodenext",
    moduleResolution: "nodenext",
    skipLibCheck: false,
    types: ["node"],
  },
  {
    module: "preserve",
    moduleResolution: "bundler",
    skipLibCheck: false,
    types: ["node"],
  },
  {
    module: "preserve",
    moduleResolution: "bundler",
    skipLibCheck: true,
    types: ["node"],
  },
  {
    module: "preserve",
    moduleResolution: "bundler",
    skipLibCheck: false,
    types: ["bun"],
  },
];

interface PackedManifest {
  dependencies?: Record<string, string>;
  exports: Record<string, { default: string; types: string }>;
  peerDependencies?: Record<string, string>;
}

const failures: string[] = [];
const fail = (message: string): void => {
  failures.push(message);
  console.error(`✗ ${message}`);
};

/** `@scope/name/sub/path` and `name/sub/path` to the package they belong to. */
const packageOf = (specifier: string): string =>
  specifier.split("/", specifier.startsWith("@") ? 2 : 1).join("/");

const isRelative = (specifier: string): boolean =>
  specifier.startsWith(".") || specifier.startsWith("/");

const isBuiltin = (specifier: string): boolean =>
  specifier.startsWith("node:") || builtinModules.includes(specifier);

const isBun = (specifier: string): boolean =>
  specifier === "bun" || specifier.startsWith("bun:");

/** Every module a source file imports, type-only and dynamic imports included. */
const importsOf = (source: string): string[] =>
  ts
    .preProcessFile(source, true, true)
    .importedFiles.map((imported) => imported.fileName);

async function checkDeclarations(
  distDir: string,
  installable: ReadonlySet<string>
): Promise<void> {
  const files = (await readdir(distDir)).filter((file) =>
    file.endsWith(".d.ts")
  );
  let clean = true;
  for (const file of files) {
    const source = await Bun.file(join(distDir, file)).text();
    for (const specifier of importsOf(source)) {
      if (isRelative(specifier)) {
        continue;
      }
      const name = packageOf(specifier);
      if (NEVER_IN_DECLARATIONS.test(name)) {
        clean = false;
        fail(
          `dist/${file} imports '${specifier}': a type of ${name} leaked into the public declarations`
        );
      } else if (!installable.has(name)) {
        clean = false;
        fail(
          `dist/${file} imports '${specifier}', which is not a dependency of gambi-sdk`
        );
      }
    }
  }
  if (clean) {
    console.log(
      `✓ ${files.length} declaration files import only what a consumer gets (no type of Effect)`
    );
  }
}

/** Why `specifier` may not be imported by the JavaScript of `entry`, if it may not. */
function refusal(
  entry: Entry,
  specifier: string,
  installable: ReadonlySet<string>
): string | undefined {
  if (isRelative(specifier)) {
    return "an entry is one file, so that importing it loads no other entry";
  }
  if (isBun(specifier)) {
    return entry.runsOn === "bun" ? undefined : "it only exists in Bun";
  }
  if (isBuiltin(specifier)) {
    return entry.runsOn === "anywhere"
      ? "this entry must run without Node's built-in modules"
      : undefined;
  }
  return installable.has(packageOf(specifier))
    ? undefined
    : "it is not a dependency of gambi-sdk";
}

async function checkJavaScript(
  packageDir: string,
  manifest: PackedManifest,
  installable: ReadonlySet<string>
): Promise<void> {
  for (const entry of entries) {
    const published = manifest.exports[entry.exportPath]?.default;
    if (published === undefined) {
      fail(`package.json has no export for the '${entry.exportPath}' entry`);
      continue;
    }
    const source = await Bun.file(join(packageDir, published)).text();
    const refused = importsOf(source).flatMap((specifier) => {
      const reason = refusal(entry, specifier, installable);
      return reason === undefined ? [] : [`'${specifier}' (${reason})`];
    });
    if (refused.length === 0) {
      console.log(
        `✓ ${published} imports nothing it should not (runs on: ${entry.runsOn})`
      );
    } else {
      fail(`${published} imports ${refused.join(", ")}`);
    }
  }
}

async function checkRuntimeExports(workDir: string): Promise<void> {
  for (const entry of entries) {
    const expected = RUNTIME_EXPORTS[entry.exportPath];
    if (expected === undefined) {
      fail(`RUNTIME_EXPORTS has no line for the '${entry.exportPath}' entry`);
      continue;
    }
    if (entry.runsOn === "bun") {
      continue;
    }
    const specifier = join("gambi-sdk", entry.exportPath);
    const program = `import(${JSON.stringify(specifier)}).then((entry) => console.log(JSON.stringify(Object.keys(entry).sort())))`;
    const result = await $`node --input-type=module -e ${program}`
      .cwd(workDir)
      .nothrow()
      .quiet();
    const exported =
      result.exitCode === 0 ? result.stdout.toString().trim() : "";
    if (exported === JSON.stringify([...expected].sort())) {
      console.log(`✓ '${specifier}' loads in Node and exports ${exported}`);
    } else {
      fail(
        `'${specifier}' in Node: expected ${JSON.stringify(expected)}, got ${exported || result.stderr.toString()}`
      );
    }
  }
}

async function checkTypes(workDir: string): Promise<void> {
  for (const config of MATRIX) {
    const label = `module=${config.module} moduleResolution=${config.moduleResolution} skipLibCheck=${config.skipLibCheck} types=${config.types}`;
    await writeFile(
      join(workDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          ...config,
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        files: ["consumer.ts"],
      })
    );
    const result = await $`npx tsc -p tsconfig.json`
      .cwd(workDir)
      .nothrow()
      .quiet();
    if (result.exitCode === 0) {
      console.log(`✓ ${label}`);
    } else {
      fail(`${label}\n${result.stdout}${result.stderr}`);
    }
  }
}

const workDir = await mkdtemp(join(tmpdir(), "gambi-sdk-types-"));

try {
  let dependency = spec;
  if (!dependency) {
    await $`npm pack --pack-destination ${workDir}`.cwd(sdkDir).quiet();
    const tarball = (await readdir(workDir)).find((file) =>
      file.endsWith(".tgz")
    );
    if (!tarball) {
      throw new Error("npm pack produced no tarball");
    }
    dependency = `file:./${tarball}`;
  }
  console.log(`Consumer installs gambi-sdk from ${dependency}`);

  await writeFile(
    join(workDir, "package.json"),
    JSON.stringify(
      {
        name: "gambi-sdk-types-consumer",
        private: true,
        type: "module",
        dependencies: {
          // @ai-sdk/provider's declarations import `json-schema` without
          // depending on its types; any consumer with skipLibCheck off needs it.
          "@types/bun": "^1",
          "@types/json-schema": "^7",
          // Same range bun-types asks for; an older pin breaks its types.
          "@types/node": "*",
          "gambi-sdk": dependency,
          typescript: "5.9.3",
        },
      },
      null,
      2
    )
  );
  await writeFile(join(workDir, "consumer.ts"), CONSUMER);
  await $`npm install --no-audit --no-fund --ignore-scripts --loglevel=error`
    .cwd(workDir)
    .quiet();

  const packageDir = join(workDir, "node_modules", "gambi-sdk");
  const manifest: PackedManifest = await Bun.file(
    join(packageDir, "package.json")
  ).json();
  const installable = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);

  await checkDeclarations(join(packageDir, "dist"), installable);
  await checkJavaScript(packageDir, manifest, installable);
  await checkRuntimeExports(workDir);
  await checkTypes(workDir);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(
    `gambi-sdk does not hold for a consumer: ${failures.length} check(s) failed`
  );
  process.exit(1);
}
console.log("✓ gambi-sdk holds for a clean consumer");
