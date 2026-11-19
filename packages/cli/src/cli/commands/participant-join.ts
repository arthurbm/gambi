/**
 * `gambi participant join`: hosts a participant runtime in this process until
 * it is told to leave. The participant shares one of two things with a room:
 *
 * - a model endpoint of this machine (the default), or
 * - a harness that runs on this machine (`--harness`), in a Workspace.
 *
 * This file prepares what is hosted; `../participant-stay.ts` is the stay
 * itself, and writes its events.
 */
import type { HarnessCommand } from "@gambi/core/harness/adapters";
import {
  HarnessTools,
  resolveHarness,
  type SupportedHarnessId,
} from "@gambi/core/harness/detection";
import { harnessParticipant } from "@gambi/core/harness/harness-participant";
import { localDirectoryPath, Workspace } from "@gambi/core/harness/workspace";
import { TunnelDiagnostics } from "@gambi/core/participant/diagnostics";
import { probeEndpoint } from "@gambi/core/participant/endpoint-capabilities";
import { HarnessCallsNotSupported } from "@gambi/core/participant/harness-not-supported";
import {
  type ParticipantAuthHeaders,
  providerInference,
} from "@gambi/core/participant/inference";
import {
  type ParticipantProfile,
  ParticipantRuntime,
} from "@gambi/core/participant/runtime";
import { Config, Effect, Layer, Option, Redacted, Schema } from "effect";
import {
  CliError,
  Command,
  Flag,
  Prompt,
  TerminalCapabilities,
} from "effect/cli";
import { participantIdFlag, roomFlag, runtimeConfigFlag } from "../flags.ts";
import { hubFailure, hubFlag } from "../hub-client.ts";
import { detectMachineSpecs } from "../machine-specs.ts";
import { Output } from "../output.ts";
import {
  type Identity,
  reportArtifact,
  stayInRoom,
} from "../participant-stay.ts";
import { CLI_VERSION } from "../version.ts";

const DEFAULT_ENDPOINT = "http://localhost:11434";

/** The harnesses a participant can contribute from the CLI. */
const HARNESSES = [
  "opencode",
  "claude-code",
  "codex",
  "fake",
] as const satisfies readonly SupportedHarnessId[];

/** What a preview shows in the place of a secret. */
const REDACTED = "[redacted]";

/** Nothing at the endpoint answered like a provider: no model list, no inference API. */
export class EndpointUnreachable extends Schema.TaggedError<EndpointUnreachable>()(
  "EndpointUnreachable",
  { endpoint: Schema.String }
) {
  override get message(): string {
    return `No provider answered at ${this.endpoint}.`;
  }

  get hint(): string {
    return "Check that the provider is running on this machine and that --endpoint points at it.";
  }
}

/** The provider answered, and the model to share is not one it lists. */
export class ModelNotOnEndpoint extends Schema.TaggedError<ModelNotOnEndpoint>()(
  "ModelNotOnEndpoint",
  {
    endpoint: Schema.String,
    model: Schema.String,
    available: Schema.Array(Schema.String),
  }
) {
  override get message(): string {
    return `The endpoint ${this.endpoint} does not list the model '${this.model}'.`;
  }

  get hint(): string {
    return this.available.length === 0
      ? "The endpoint lists no model at all."
      : `Models it lists: ${this.available.join(", ")}.`;
  }
}

/** Flags that were given together and belong to different kinds of participant. */
export class FlagsDoNotCombine extends Schema.TaggedError<FlagsDoNotCombine>()(
  "FlagsDoNotCombine",
  {
    /** The flags that are out of place, as they are typed. */
    flags: Schema.Array(Schema.String),
    /** `with` when `flag` was given too, `without` when it is missing. */
    relation: Schema.Literals(["with", "without"]),
    flag: Schema.String,
    reason: Schema.String,
  }
) {
  override get message(): string {
    return `${this.flags.join(", ")} cannot be used ${this.relation} ${this.flag}: ${this.reason}.`;
  }
}

const HttpUrl = Schema.String.check(
  Schema.isPattern(/^https?:\/\/[^\s/]+/, {
    message: "Expected an http:// or https:// URL",
  })
);

/**
 * A `Name=Value` pair with a blank side is a mistake of whoever typed it (a
 * variable that expanded to nothing, a stray space), and the provider would
 * answer it with an error about something else.
 */
const withoutBlankParts = Effect.fnUntraced(function* (
  option: string,
  pairs: Record<string, string>
) {
  for (const [name, value] of Object.entries(pairs)) {
    if (name.trim() === "" || value.trim() === "") {
      return yield* new CliError.InvalidValue({
        option,
        value: `${name}=${value}`,
        expected: "a name and a value that are not blank",
        kind: "flag",
      });
    }
  }
  return pairs;
});

/**
 * `--header Name=Value`, repeatable: a `ParticipantAuthHeader`. It is added
 * to every request this machine makes to its provider, and never leaves it.
 */
const headerFlag = Flag.KeyValuePair("header").pipe(
  Flag.withMetavar("Name=Value"),
  Flag.withDescription(
    "Header for the requests to the provider, such as Authorization. Repeatable. It stays on this machine"
  ),
  Flag.mapEffect((pairs) => withoutBlankParts("header", pairs)),
  Flag.withDefault({})
);

/** `--header-env Name=VARIABLE`, repeatable: the same, with the value read from the environment. */
const headerEnvFlag = Flag.KeyValuePair("header-env").pipe(
  Flag.withMetavar("Name=VARIABLE"),
  Flag.withDescription(
    "Header for the requests to the provider, with its value read from an environment variable. Repeatable"
  ),
  Flag.mapEffect(
    Effect.fnUntraced(function* (given) {
      const pairs = yield* withoutBlankParts("header-env", given);
      const headers: Record<string, string> = {};
      for (const [name, variable] of Object.entries(pairs)) {
        const unset = new CliError.InvalidValue({
          option: "header-env",
          value: `${name}=${variable}`,
          expected: `the environment variable ${variable} to be set`,
          kind: "flag",
        });
        const value = yield* Config.NonEmptyString(variable).pipe(
          Effect.mapError(() => unset)
        );
        if (value.trim() === "") {
          return yield* unset;
        }
        headers[name] = value;
      }
      return headers;
    })
  ),
  Flag.withDefault({})
);

const flags = {
  room: roomFlag,
  participantId: participantIdFlag,
  model: Flag.String("model").pipe(
    Flag.withAlias("m"),
    Flag.withDescription(
      "Model of the endpoint to share; on a terminal, chosen from the ones the endpoint lists. With --harness: the model the harness runs on, when you want to say"
    ),
    Flag.withSchema(Schema.NonEmptyString),
    Flag.optional
  ),
  endpoint: Flag.String("endpoint").pipe(
    Flag.withAlias("e"),
    Flag.withMetavar("url"),
    Flag.withDescription(
      `Where the provider listens on this machine. The hub never calls it. Default: ${DEFAULT_ENDPOINT}`
    ),
    Flag.withSchema(HttpUrl),
    Flag.optional
  ),
  headers: headerFlag,
  headersFromEnvironment: headerEnvFlag,
  harness: Flag.Literals("harness", HARNESSES).pipe(
    Flag.withDescription(
      "Share a harness of this machine instead of a model endpoint. fake is a test harness that calls no model"
    ),
    Flag.optional
  ),
  workspace: Flag.String("workspace").pipe(
    Flag.withMetavar("folder"),
    Flag.withDescription(
      "With --harness: the folder the harness runs in and its artifacts are collected from. Default: an empty folder under ~/.gambi/workspaces/"
    ),
    Flag.optional
  ),
  nickname: Flag.String("nickname").pipe(
    Flag.withAlias("n"),
    Flag.withDescription(
      "Name the room shows for the participant. Default: <model>@<participant id>"
    ),
    Flag.withSchema(Schema.NonEmptyString),
    Flag.optional
  ),
  password: Flag.Redacted("password").pipe(
    Flag.withAlias("p"),
    Flag.withDescription("Password of the room, when it has one"),
    Flag.optional
  ),
  config: runtimeConfigFlag(
    "Runtime config of the participant (temperature, instructions, ...) as JSON: a file, or - for stdin"
  ),
  noSpecs: Flag.Boolean("no-specs").pipe(
    Flag.withoutNegation,
    Flag.withDescription("Do not tell the room what this machine has"),
    Flag.withDefault(false)
  ),
  hub: hubFlag,
  dryRun: Flag.Boolean("dry-run").pipe(
    Flag.withDescription(
      "Check the endpoint or the harness and print what would be registered, without joining"
    ),
    Flag.withDefault(false)
  ),
};

type JoinInput = Command.Command.Config.Infer<typeof flags>;

/** What both kinds of participant tell the room about themselves. */
const commonProfile = Effect.fnUntraced(function* (
  input: JoinInput,
  model: string
) {
  const specs = input.noSpecs ? undefined : yield* detectMachineSpecs();
  // A field that is present has a value: the registration refuses
  // `undefined`.
  return {
    nickname: Option.getOrElse(
      input.nickname,
      () => `${model}@${input.participantId.slice(0, 6)}`
    ),
    model,
    ...(specs === undefined ? {} : { specs }),
    ...Option.match(input.config, {
      onNone: () => ({}),
      onSome: (config) => ({ config }),
    }),
  } satisfies ParticipantProfile;
});

/** What the participant runtime of both kinds is started with. */
const runtimeOptions = (
  input: JoinInput,
  identity: Identity,
  profile: ParticipantProfile
) => ({
  hubUrl: input.hub,
  ...identity,
  ...Option.match(input.password, {
    onNone: () => ({}),
    onSome: (password) => ({ password: Redacted.value(password) }),
  }),
  // The registration carries the version of the CLI; the hub refuses
  // another minor.
  version: CLI_VERSION,
  profile,
});

/** What `--dry-run` prints for both kinds, without any secret. */
const previewOf = (input: JoinInput, identity: Identity) => ({
  hubUrl: input.hub,
  ...identity,
  ...(Option.isSome(input.password) ? { password: REDACTED } : {}),
});

const showPreview = Effect.fnUntraced(function* (
  input: JoinInput,
  identity: Identity,
  preview: object
) {
  const output = yield* Output;
  yield* output.result(
    preview,
    () =>
      `Would join room ${identity.roomCode} on ${input.hub} as ${identity.participantId}.\n${JSON.stringify(preview, null, 2)}`
  );
});

/** Joins with a model endpoint of this machine. */
const joinWithEndpoint = Effect.fnUntraced(function* (
  input: JoinInput,
  identity: Identity
) {
  if (Option.isSome(input.workspace)) {
    return yield* new FlagsDoNotCombine({
      flags: ["--workspace"],
      relation: "without",
      flag: "--harness",
      reason: "a participant that shares a model endpoint has no Workspace",
    });
  }
  const { canPrompt } = yield* TerminalCapabilities.TerminalCapabilities;
  const modelIsMissing = new CliError.MissingOption({ option: "model" });
  if (Option.isNone(input.model) && !canPrompt) {
    return yield* modelIsMissing;
  }

  // `ParticipantAuthHeaders`: they go to the probe and to the handler that
  // calls the provider. The runtime, and so the hub, never sees them.
  const authHeaders: ParticipantAuthHeaders = {
    ...input.headers,
    ...input.headersFromEnvironment,
  };
  const endpoint = Option.getOrElse(input.endpoint, () => DEFAULT_ENDPOINT);
  const provider = { endpoint, authHeaders };

  // What the provider lists and which inference APIs it answers, found on
  // this machine. The hub never probes a provider.
  const probe = yield* probeEndpoint(provider);
  if (!probe.reachable) {
    return yield* new EndpointUnreachable({ endpoint });
  }
  if (Option.isNone(input.model) && probe.models.length === 0) {
    // Nothing to choose from: the provider answers and lists no model.
    return yield* modelIsMissing;
  }
  const model = yield* Option.match(input.model, {
    onSome: (named) => Effect.succeed(named),
    onNone: () =>
      Prompt.run(
        Prompt.Select({
          message: "Model to share",
          choices: probe.models.map((listed) => ({
            title: listed,
            value: listed,
          })),
        })
      ).pipe(
        // Leaving the question unanswered leaves the flag missing.
        Effect.mapError(() => modelIsMissing)
      ),
  });
  if (!probe.models.includes(model)) {
    return yield* new ModelNotOnEndpoint({
      endpoint,
      model,
      available: probe.models,
    });
  }

  const profile: ParticipantProfile = {
    ...(yield* commonProfile(input, model)),
    endpoint,
    capabilities: probe.capabilities,
  };
  if (input.dryRun) {
    return yield* showPreview(input, identity, {
      ...previewOf(input, identity),
      ...(Object.keys(authHeaders).length === 0
        ? {}
        : {
            authHeaders: Object.fromEntries(
              Object.keys(authHeaders).map((name) => [name, REDACTED])
            ),
          }),
      profile,
    });
  }

  yield* stayInRoom({
    hubUrl: input.hub,
    identity,
    label: model,
    host: (runtime) =>
      ParticipantRuntime.layer({
        ...runtimeOptions(input, identity, profile),
        ...runtime,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            TunnelDiagnostics,
            HarnessCallsNotSupported,
            providerInference(provider)
          )
        )
      ),
  });
});

/** The provider flags that were given, which a harness participant does not take. */
const providerFlagsOf = (input: JoinInput): readonly string[] => [
  ...(Option.isSome(input.endpoint) ? ["--endpoint"] : []),
  ...(Object.keys(input.headers).length === 0 ? [] : ["--header"]),
  ...(Object.keys(input.headersFromEnvironment).length === 0
    ? []
    : ["--header-env"]),
];

/** Joins with a harness of this machine, running in a Workspace. */
const joinWithHarness = Effect.fnUntraced(function* (
  input: JoinInput,
  identity: Identity,
  harnessId: SupportedHarnessId
) {
  const providerFlags = providerFlagsOf(input);
  if (providerFlags.length > 0) {
    return yield* new FlagsDoNotCombine({
      flags: providerFlags,
      relation: "with",
      flag: "--harness",
      reason: "the credentials of a harness stay in the harness",
    });
  }

  // Is the harness installed and logged in? This only looks: it runs the
  // harness's own status commands and reads no credential.
  const resolved = yield* resolveHarness(harnessId).pipe(
    Effect.provide(HarnessTools.layer)
  );
  for (const note of [...resolved.notes, resolved.warning]) {
    if (note !== undefined) {
      yield* Effect.logWarning(note);
    }
  }
  const command: HarnessCommand = resolved.command;

  const model = Option.getOrElse(input.model, () => harnessId);
  const profile: ParticipantProfile = {
    ...(yield* commonProfile(input, model)),
    harness: {
      id: harnessId,
      ...Option.match(input.model, {
        onNone: () => ({}),
        onSome: (named) => ({ model: named }),
      }),
    },
  };
  const workspace = {
    ...identity,
    harness: harnessId,
    model,
    ...Option.match(input.workspace, {
      onNone: () => ({}),
      onSome: (path) => ({ path }),
    }),
  };
  if (input.dryRun) {
    return yield* showPreview(input, identity, {
      ...previewOf(input, identity),
      workspace: yield* localDirectoryPath(workspace),
      harness: { id: harnessId, command: command.command, args: command.args },
      profile,
    });
  }

  const output = yield* Output;
  const onArtifact = reportArtifact(identity);
  yield* stayInRoom({
    hubUrl: input.hub,
    identity,
    label: harnessId,
    host: (runtime) =>
      harnessParticipant({
        runtime: {
          ...runtimeOptions(input, identity, profile),
          ...runtime,
        },
        harness: { command },
        artifacts: {
          onArtifact: (event) =>
            Effect.provideService(onArtifact(event), Output, output),
        },
      }).pipe(Layer.provide(Workspace.layerLocalDirectory(workspace))),
  });
});

export const join = Command.make(
  "join",
  flags,
  Effect.fn("participant.join")(
    function* (input) {
      const identity: Identity = {
        roomCode: input.room,
        participantId: input.participantId,
      };
      if (Option.isSome(input.harness)) {
        return yield* joinWithHarness(input, identity, input.harness.value);
      }
      return yield* joinWithEndpoint(input, identity);
    },
    // The runtime has one name for a hub that did not answer and for a
    // server that is not a hub. The failure behind it tells them apart.
    Effect.catchTag("HubUnreachable", ({ cause, hubUrl }) =>
      Effect.fail(hubFailure(hubUrl, cause))
    )
  )
).pipe(
  Command.withDescription(
    "Join a room with a model endpoint or a harness of this machine, and stay until Ctrl+C"
  ),
  Command.withExamples([
    {
      command:
        "gambi participant join --room ABC123 --participant-id worker-1 --model llama3",
      description: "Share a model of the local Ollama with a room",
    },
    {
      command:
        "gambi participant join --room ABC123 --participant-id worker-1 --model gpt-4.1 --endpoint https://api.openai.com --header-env Authorization=OPENAI_AUTH",
      description:
        "Share a model of a hosted provider; the header stays on this machine",
    },
    {
      command:
        "gambi participant join --room ABC123 --participant-id worker-1 --harness opencode",
      description: "Share your OpenCode, running in an empty Workspace",
    },
    {
      command:
        "gambi participant join --room ABC123 --participant-id worker-1 --harness codex --workspace ./my-project",
      description: "Share your Codex, running in a folder you choose",
    },
    {
      command:
        "gambi participant join --room ABC123 --participant-id worker-1 --model llama3 --dry-run",
      description: "Check the endpoint and print what would be registered",
    },
  ])
);
