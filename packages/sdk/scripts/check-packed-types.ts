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
 * 3. loads every entry in the runtime it promises (Node, or Bun for an entry
 *    that only runs there) and compares what it exports with the list below;
 *    an entry that only runs in Bun must say so when Node loads it;
 * 4. loads the default entry in Node with the files of every other entry
 *    taken away, and uses it: importing it loads none of them;
 * 5. runs a Bun program that hosts a hub and both kinds of participant from
 *    the packed package, the `fake` harness included, and attaches a client;
 * 6. runs `tsc` against a file that uses the public types. With
 *    `skipLibCheck: true` a broken import turns every SDK type into `any`
 *    silently, so the consumer file marks deliberate type errors with
 *    `@ts-expect-error`: if the types degrade to `any`, the directive is
 *    unused and `tsc` fails.
 *
 * Usage:
 *   bun run scripts/check-packed-types.ts          # pack the local dist/
 *   bun run scripts/check-packed-types.ts 0.8.0    # registry version
 */
import { mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
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
  "./hub": ["HubError", "createHub"],
  "./participant": [
    "MAX_ARTIFACT_BYTES",
    "ParticipantError",
    "createHarnessParticipantSession",
    "createLocalDirectoryWorkspace",
    "createParticipantSession",
    "probeProvider",
    "runFakeAcpAgent",
  ],
};

/** How an entry that only runs in Bun refuses to load anywhere else. */
const ONLY_RUNS_IN_BUN = "only runs in Bun";

/**
 * What a Node program does with the default entry while the files of every
 * other entry are gone: if importing it reached for one of them, it fails.
 */
const DEFAULT_ENTRY_ALONE = `
import { ClientError, createClient, createGambi } from "gambi-sdk";

const client = createClient({ hubUrl: "http://127.0.0.1:1" });
const error = await client.hub.health().catch((caught) => caught);
createGambi({ roomCode: "ABC123" });
await client.close();
console.log(error instanceof ClientError ? error.code : String(error));
`;

/**
 * What a Bun program does with the two hosting entries: a hub, a participant
 * that shares a model endpoint, a harness participant on the \`fake\` harness,
 * and a management client attached to it. Everything is the packed package;
 * the \`fake\` harness runs from the package's own file.
 */
const HOSTING_PROGRAM = `
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "gambi-sdk";
import { createHub, HubError } from "gambi-sdk/hub";
import {
  createHarnessParticipantSession,
  createLocalDirectoryWorkspace,
  createParticipantSession,
} from "gambi-sdk/participant";

// A step that never comes (an artifact that is not sent) must fail the check.
setTimeout(() => {
  console.error("The hosting program did not finish in 60 seconds.");
  process.exit(1);
}, 60_000).unref();

const hub = await createHub({ hostname: "127.0.0.1", port: 0 });
const portInUse = await createHub({ hostname: "127.0.0.1", port: hub.port }).catch((error) => error);
const client = createClient({ hubUrl: hub.url });
const { room } = await client.rooms.create({ name: "Frevo" });

const endpoint = await createParticipantSession({
  hubUrl: hub.url,
  roomCode: room.code,
  participantId: "arthur-1",
  nickname: "Arthur",
  model: "llama3",
  endpoint: "http://127.0.0.1:1",
});

const folder = await mkdtemp(join(tmpdir(), "gambi-sdk-packed-"));
const harness = await createHarnessParticipantSession({
  hubUrl: hub.url,
  roomCode: room.code,
  participantId: "frevo-bot",
  nickname: "Frevo bot",
  harness: "fake",
  workspace: createLocalDirectoryWorkspace({ path: folder }),
  artifacts: { settleTimeMs: 20 },
});
const online = (await client.participants.list(room.code))
  .map((participant) => participant.id + " " + participant.status)
  .sort();

const events = client.harness.attach(room.code, "frevo-bot")[Symbol.asyncIterator]();
const until = async (seen) => {
  for (;;) {
    const { done, value } = await events.next();
    if (done) throw new Error("The attach ended.");
    if (seen(value)) return value;
  }
};
await until((event) => event.type === "harness.connected");
await client.harness.openSession(room.code, "frevo-bot", "roda-1");
await client.harness.send(room.code, "frevo-bot", "roda-1", {
  jsonrpc: "2.0",
  id: 1,
  method: "session/prompt",
  params: { sessionId: "roda-1", prompt: [{ type: "text", text: "Oi" }] },
});
const artifact = await until((event) => event.type === "harness.artifact");

await harness.leave();
await endpoint.leave();
const left = await client.participants.list(room.code);
await client.close();
await hub.close();
await rm(folder, { force: true, recursive: true });

console.log(JSON.stringify({
  runtime: typeof Bun === "undefined" ? "node" : "bun",
  portInUse: portInUse instanceof HubError ? portInUse.code : String(portInUse),
  online,
  artifact: artifact.files.map((file) => file.path + ": " + file.content.trim()),
  left: left.length,
}));
`;

/** Packages whose types must never reach a consumer, named for the message. */
const NEVER_IN_DECLARATIONS = /^(effect|@effect\/.+|zod|@gambi\/.+)$/;

const CONSUMER = `import {
  ClientError,
  type ClientErrorCode,
  createClient,
  createGambi,
  type GambiClient,
  type HarnessAttachEvent,
  type ParticipantSummary,
  type RoomEvent,
  type RoomSummary,
} from "gambi-sdk";
import { type DiscoveredHub, discoverHubs } from "gambi-sdk/discovery";
import {
  createHub,
  type HostedHub,
  HubError,
  type HubErrorCode,
} from "gambi-sdk/hub";
import {
  createHarnessParticipantSession,
  createLocalDirectoryWorkspace,
  createParticipantSession,
  type HarnessParticipantSession,
  ParticipantError,
  type ParticipantLifecycleEvent,
  type ParticipantSession,
  probeProvider,
  runFakeAcpAgent,
  type Workspace,
} from "gambi-sdk/participant";

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

// A removal names the runtime the participant belongs to, as the listing
// shows it.
async function takeOut(roomCode: string, participantId: string): Promise<string | undefined> {
  const participants = await client.participants.list(roomCode);
  const participant = participants.find((listed) => listed.id === participantId);
  if (participant === undefined) {
    return undefined;
  }
  const left = await client.participants.remove(roomCode, participantId, participant.runtimeId);
  return left.participantId;
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

// Attaching to a harness participant: a plain AsyncIterable down, Promises up.
async function prompt(roomCode: string, participantId: string): Promise<string[]> {
  const said: string[] = [];
  const { sessionId } = await client.harness.openSession(roomCode, participantId, "roda-1", {});
  await client.harness.send(roomCode, participantId, sessionId, { jsonrpc: "2.0", method: "session/cancel" });
  const events: AsyncIterable<HarnessAttachEvent> = client.harness.attach(roomCode, participantId);
  for await (const event of events) {
    switch (event.type) {
      case "harness.message":
        said.push(\`\${event.sessionId} \${JSON.stringify(event.message)}\`);
        break;
      case "harness.artifact":
        said.push(...event.files.map((file) => \`\${event.version} \${file.path} \${file.encoding}\`));
        break;
      case "harness.dropped":
        said.push(\`lost \${event.count}\`);
        break;
      case "harness.detached":
        said.push(event.reason);
        break;
      default:
        said.push(event.type);
    }
  }
  await client.harness.closeSession(roomCode, participantId, sessionId);
  return said;
}

// Hosting a hub and a participant in this process (Bun only), in Promise.
async function host(): Promise<string[]> {
  const hub: HostedHub = await createHub({ port: 0, onLog: (entry) => entry.level });
  const steps: ParticipantLifecycleEvent["type"][] = [];
  const probe = await probeProvider("http://127.0.0.1:11434", { Authorization: "Bearer x" });
  const session: ParticipantSession = await createParticipantSession({
    hubUrl: hub.url,
    roomCode: "ABC123",
    participantId: "arthur-1",
    nickname: "Arthur",
    model: probe.models[0] ?? "llama3",
    endpoint: "http://127.0.0.1:11434",
    capabilities: probe.capabilities,
    onLifecycle: (event) => steps.push(event.type),
  });
  const local = createLocalDirectoryWorkspace({ path: "./workspace" });
  const seeded: Workspace = {
    prepare: async (context) => {
      const prepared = await local.prepare(context);
      return { ...prepared, path: prepared.path };
    },
  };
  const harness: HarnessParticipantSession = await createHarnessParticipantSession({
    hubUrl: hub.url,
    roomCode: "ABC123",
    participantId: "frevo-bot",
    nickname: "Frevo bot",
    harness: "fake",
    workspace: seeded,
    onArtifact: (event) => event.type === "artifactSent" && event.version,
  });
  const exit: Promise<{ message: string }> = harness.harness.exited;
  const ended = await session.ended;
  await harness.leave();
  await session.stop();
  await hub.close();
  return [session.participant.status, ended.reason, String(harness.harness.pid), String(exit)];
}

function describeHosting(error: unknown): HubErrorCode | string {
  if (error instanceof HubError) {
    return error.code;
  }
  return error instanceof ParticipantError ? error.code : "unknown";
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
// @ts-expect-error there is no such harness event
const badHarnessEvent: HarnessAttachEvent["type"] = "harness.attached";
// @ts-expect-error a hosted hub is plain values and a close, not a Layer to provide
const badHubLayer = createHub().then((hub) => hub.pipe);
// @ts-expect-error a port is a number
const badPort = createHub({ port: "3000" });
// @ts-expect-error there is no such code
const badHubErrorCode: HubErrorCode = "ROOM_NOT_FOUND";
// @ts-expect-error a participant that shares an endpoint says which model
const badSession = createParticipantSession({ roomCode: "ABC123", participantId: "a", nickname: "A", endpoint: "http://127.0.0.1:11434" });
// @ts-expect-error there is no such harness
const badHarness = createHarnessParticipantSession({ roomCode: "ABC123", participantId: "a", nickname: "A", harness: "pi" });
// @ts-expect-error a session has no Effect to wait on: \`ended\` is a Promise
const badEnded = createParticipantSession({ roomCode: "ABC123", participantId: "a", nickname: "A", model: "m", endpoint: "e" }).then((session) => session.ended.pipe);
// @ts-expect-error a Workspace prepares a folder: it is not a path
const badWorkspace: Workspace = "./workspace";

export {
  badCall,
  badCode,
  badEffect,
  badEnded,
  badEnvelope,
  badErrorCode,
  badEventType,
  badHarness,
  badHarnessEvent,
  badHub,
  badHubErrorCode,
  badHubLayer,
  badPort,
  badSession,
  badStatus,
  badWorkspace,
  describe,
  describeHosting,
  host,
  hubs,
  onlineNicknames,
  prompt,
  provider,
  roomNames,
  runFakeAcpAgent,
  takeOut,
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
    const specifier = join("gambi-sdk", entry.exportPath);
    const program = `import(${JSON.stringify(specifier)}).then((entry) => console.log(JSON.stringify(Object.keys(entry).sort())))`;
    const inNode = await $`node --input-type=module -e ${program}`
      .cwd(workDir)
      .nothrow()
      .quiet();
    const inBun = await $`bun -e ${program}`.cwd(workDir).nothrow().quiet();
    const onlyBun = entry.runsOn === "bun";
    const result = onlyBun ? inBun : inNode;
    const runtime = onlyBun ? "Bun" : "Node";
    const exported =
      result.exitCode === 0 ? result.stdout.toString().trim() : "";
    if (exported === JSON.stringify([...expected].sort())) {
      console.log(
        `✓ '${specifier}' loads in ${runtime} and exports ${exported}`
      );
    } else {
      fail(
        `'${specifier}' in ${runtime}: expected ${JSON.stringify(expected)}, got ${exported || result.stderr.toString()}`
      );
    }
    if (!onlyBun) {
      continue;
    }
    if (
      inNode.exitCode !== 0 &&
      inNode.stderr.toString().includes(ONLY_RUNS_IN_BUN)
    ) {
      console.log(`✓ '${specifier}' tells Node that it only runs in Bun`);
    } else {
      fail(
        `'${specifier}' in Node: expected a refusal that says "${ONLY_RUNS_IN_BUN}", got ${inNode.stdout}${inNode.stderr}`
      );
    }
  }
}

/**
 * Importing the default entry loads no other entry: with the JavaScript of
 * every other entry moved away, a Node program still imports it and uses it.
 */
async function checkDefaultEntryAlone(
  workDir: string,
  packageDir: string,
  manifest: PackedManifest
): Promise<void> {
  const others = entries
    .filter((entry) => entry.exportPath !== ".")
    .flatMap((entry) => {
      const published = manifest.exports[entry.exportPath]?.default;
      return published === undefined ? [] : [join(packageDir, published)];
    });
  await writeFile(
    join(workDir, "default-entry-alone.mjs"),
    DEFAULT_ENTRY_ALONE
  );
  for (const file of others) {
    await rename(file, `${file}.away`);
  }
  try {
    const result = await $`node default-entry-alone.mjs`
      .cwd(workDir)
      .nothrow()
      .quiet();
    const said = result.stdout.toString().trim();
    if (result.exitCode === 0 && said === "HUB_UNREACHABLE") {
      console.log(
        `✓ 'gambi-sdk' loads and works in Node without the files of its ${others.length} other entries`
      );
    } else {
      fail(
        `'gambi-sdk' without the files of its other entries: ${said}${result.stderr}`
      );
    }
  } finally {
    for (const file of others) {
      await rename(`${file}.away`, file);
    }
  }
}

/** Hosts a hub and both kinds of participant from the packed package, in Bun. */
async function checkHosting(workDir: string): Promise<void> {
  await writeFile(join(workDir, "hosting.mjs"), HOSTING_PROGRAM);
  const result = await $`bun hosting.mjs`.cwd(workDir).nothrow().quiet();
  const expected = JSON.stringify({
    runtime: "bun",
    portInUse: "PORT_IN_USE",
    online: ["arthur-1 online", "frevo-bot online"],
    artifact: ["fake-output.txt: Fake ACP response: Oi"],
    left: 0,
  });
  const said = result.stdout.toString().trim();
  if (result.exitCode === 0 && said === expected) {
    console.log(
      "✓ the packed package hosts a hub, a participant session and a harness participant on the fake harness, in Bun"
    );
  } else {
    fail(`hosting from the packed package: ${said}${result.stderr}`);
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
  await checkDefaultEntryAlone(workDir, packageDir, manifest);
  await checkHosting(workDir);
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
