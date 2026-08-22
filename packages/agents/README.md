# `@gambi/agents`

UI-agnostic social orchestration for harness participants. The package models
squads, challenges, drafts, human decisions, typed dispatches, reviews, and
escalations. It owns no persistence and has no knowledge of a particular event,
round format, board, or visual theme.

The orchestrator uses an injected AI SDK `LanguageModel`. Its fixed tools are
`listSquads`, `dispatch`, `readWorld`, `askHuman`, and `finish`. `askHuman` is
the only steering channel and pauses the tool loop until the host supplies an
answer.

## Example

```ts
import { Orchestrator, MemoryHarnessTransport } from "@gambi/agents";
import { openai } from "@ai-sdk/openai";

const harness = new MemoryHarnessTransport();
const orchestrator = new Orchestrator({
  model: openai("gpt-5"),
  squads: [
    {
      id: "docs",
      name: "Documentation",
      memberNames: ["Ada", "Lin"],
      harnessParticipantId: "participant-123",
    },
  ],
  rounds: [
    { id: "iteration-1", name: "First pass", objective: "Improve onboarding" },
  ],
  transports: { docs: harness },
});

const challenge = orchestrator.createChallenge({
  squadId: "docs",
  roundId: "iteration-1",
  objective: "Create a five-minute quickstart",
  seededDrafts: [
    { content: "A command-first walkthrough" },
    { content: "A troubleshooting-first walkthrough" },
  ],
});

// Seeded proposals and the challenge remain editable until dispatch.
const firstDraftId = challenge.seededDraftIds[0];
if (firstDraftId) {
  orchestrator.updateDraft(firstDraftId, "A two-command walkthrough");
}

const decision = orchestrator.recordDecision({
  challengeId: challenge.id,
  build: "The two-command walkthrough",
  cut: "Advanced configuration",
  reason: "A new user should see a successful request first",
  consideredDraftIds: challenge.seededDraftIds,
  steererName: "Ada",
});

await orchestrator.dispatch({
  challengeId: decision.challengeId,
  input: "The current README and CLI help",
  expectedOutput: "An edited quickstart",
  constraints: ["Do not assume a specific UI"],
});

for await (const event of orchestrator.events) {
  await saveToYourOwnStore(event);
}
```

For tests, `MemoryHarnessTransport` records opens, prompts, and closes and lets
the test emit deterministic harness events. Production transports implement the
same `HarnessTransport` interface and can be supplied per squad.

## Tunnel transport

`TunnelHarnessTransport` adapts the public `client.harness.attach()` channel
from `gambi-sdk` without taking a hard runtime dependency on the SDK. Pass the
client returned by `createClient()` and scope one transport to each squad's
harness participant:

```ts
import { TunnelHarnessTransport } from "@gambi/agents/tunnel";
import { createClient } from "gambi-sdk";

const client = createClient({ hubUrl: "http://localhost:3000" });
const transport = new TunnelHarnessTransport({
  client,
  roomCode: "ABC123",
  participantId: "ana-opencode",
});
```

ACP message updates, versioned artifacts, and harness status frames become
`HarnessEvent` values. An `Orchestrator` republishes them as ordered
`harness.event` domain events with the squad id so applications can persist or
render them without understanding tunnel frames.

`prompt()` resolves only after the harness acknowledges the ACP request. If a
channel drops or the acknowledgement times out, it throws
`HarnessTransportError` with `recoverable: true`; the orchestrator forgets that
harness session so retrying the dispatch after the participant reconnects opens
a new one. A dropped dispatch is therefore never reported as sent.

## Executable demo

The demo starts a real hub, two real fake ACP processes, two squads, and the
orchestrator. It sends two decided challenges, accepts one result, returns the
other in the same harness session, and waits for artifact version 2:

```bash
bun run --cwd packages/agents demo
```

It uses `MockLanguageModelV3` by default and spends no model tokens. To inject a
model already shared in an existing room through the Gambi inference plane:

```bash
bun run --cwd packages/agents demo -- \
  --hub-url http://localhost:3000 \
  --room ABC123 \
  --model qwen3
```
