#!/usr/bin/env bun
/**
 * Type-checks gambi-sdk as an outside consumer sees it: packs the package
 * (or takes a registry spec), installs it into a fresh temp project, and runs
 * `tsc` against a file that uses the public types.
 *
 * Catches declarations that point at packages the consumer cannot install,
 * such as the unpublished `@gambi/core` (issue #82). With `skipLibCheck: true`
 * those imports turn every SDK type into `any` silently, so the consumer file
 * marks deliberate type errors with `@ts-expect-error`: if the types degrade
 * to `any`, the directive is unused and `tsc` fails.
 *
 * Usage:
 *   bun run scripts/check-packed-types.ts          # pack the local dist/
 *   bun run scripts/check-packed-types.ts 0.7.1    # registry version
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $ } from "bun";

const sdkDir = resolve(import.meta.dir, "..");
// A registry version such as "0.7.1" (or "gambi-sdk@0.7.1"); empty packs dist/.
const spec = process.argv[2]?.replace(/^gambi-sdk@/, "");

const CONSUMER = `import {
  createClient,
  createFakeHarnessAdapter,
  createGambi,
  type HarnessParticipantSession,
  type HarnessParticipantSessionOptions,
  type PreparedWorkspace,
  type Workspace,
  type WorkspaceArtifactFile,
  type WorkspaceContext,
} from "gambi-sdk";
import { type DiscoveredHub, discoverHubs } from "gambi-sdk/discovery";

interface LabSession extends HarnessParticipantSession {
  label: string;
}

const workspace: Workspace = {
  prepare(context) {
    const files: WorkspaceArtifactFile[] = [
      { path: "README.md", content: context.roomCode, encoding: "utf8" },
    ];
    const prepared: PreparedWorkspace = {
      path: \`/tmp/\${context.participantId}\`,
      collect: () => Promise.resolve(files),
      watch: () => () => undefined,
    };
    return Promise.resolve(prepared);
  },
};

const context: WorkspaceContext = {
  harness: "fake",
  model: "fake-model",
  participantId: "p1",
  roomCode: "ABC123",
};

const options: HarnessParticipantSessionOptions = {
  adapter: createFakeHarnessAdapter({ command: "node", args: ["agent.js"] }),
  harnessId: "fake",
  nickname: "lab",
  participantId: context.participantId,
  roomCode: context.roomCode,
  workspace,
};

const client = createClient({ hubUrl: "http://localhost:3000" });
const provider = createGambi({ roomCode: context.roomCode });
const hubs: Promise<DiscoveredHub[]> = discoverHubs();

function describe(session: LabSession): string {
  const id: string = session.sessionId;
  const pid: number = session.processPid;
  return \`\${session.label} \${id} \${pid} \${session.workspacePath}\`;
}

// Deliberate type errors. If the SDK types degrade to \`any\`, these
// directives go unused and tsc reports TS2578.
// @ts-expect-error sessionId is a string
const badSessionId: HarnessParticipantSession["sessionId"] = 42;
// @ts-expect-error WorkspaceContext requires roomCode
const badContext: WorkspaceContext = { harness: "fake", model: "m", participantId: "p" };
// @ts-expect-error nickname must be a string
const badOptions: HarnessParticipantSessionOptions = { ...options, nickname: 1 };
// @ts-expect-error encoding is "base64" | "utf8"
const badFile: WorkspaceArtifactFile = { path: "a", content: "b", encoding: "latin1" };

export {
  badContext,
  badFile,
  badOptions,
  badSessionId,
  client,
  describe,
  hubs,
  options,
  provider,
};
`;

const MATRIX = [
  { module: "nodenext", moduleResolution: "nodenext", skipLibCheck: false },
  { module: "preserve", moduleResolution: "bundler", skipLibCheck: false },
  { module: "preserve", moduleResolution: "bundler", skipLibCheck: true },
];

const workDir = await mkdtemp(join(tmpdir(), "gambi-sdk-types-"));
let failed = false;

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
          "@types/json-schema": "^7",
          "@types/node": "^22",
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

  for (const config of MATRIX) {
    const label = `module=${config.module} moduleResolution=${config.moduleResolution} skipLibCheck=${config.skipLibCheck}`;
    await writeFile(
      join(workDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          ...config,
          noEmit: true,
          strict: true,
          target: "ES2022",
          types: ["node"],
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
      failed = true;
      console.error(`✗ ${label}\n${result.stdout}${result.stderr}`);
    }
  }
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failed) {
  console.error("gambi-sdk declarations do not type-check for a consumer");
  process.exit(1);
}
console.log("✓ gambi-sdk declarations type-check for a clean consumer");
