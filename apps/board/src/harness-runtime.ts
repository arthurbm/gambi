import type { HarnessEvent } from "@gambi/agents";
import {
  HarnessTransportError,
  TunnelHarnessTransport,
} from "@gambi/agents/tunnel";
import {
  createHarnessParticipantSession,
  type HarnessParticipantSession,
  type HarnessParticipantSessionOptions,
} from "@gambi/core/harness-participant-session";
import { createClient, type GambiClient } from "gambi-sdk";

import type { BoardRepository, HubHarnessParticipant } from "./db/repository";
import type { BoardEventBus } from "./sse";

const RECONCILE_INTERVAL_MS = 3000;
const RETRY_MAX_MS = 15_000;

function isExpectedWatchDisconnect(error: unknown) {
  return (
    error instanceof Error && error.message === "Event stream interrupted."
  );
}

export type CreateHostedSession = (
  options: HarnessParticipantSessionOptions
) => Promise<HarnessParticipantSession>;

export interface BoardHarnessRuntimeOptions {
  client?: GambiClient;
  createHostedSession?: CreateHostedSession;
  events: BoardEventBus;
  hostedHarnessId?: "fake" | "opencode";
  hubUrl: string;
  onError?: (error: unknown) => void;
  repository: BoardRepository;
  roomCode: string;
}

export interface BoardHarnessRuntime {
  close: () => Promise<void>;
  prompt: (input: {
    actorPersonId: string;
    prompt: string;
    squadId: string;
  }) => Promise<{ sessionId: string; revision: number }>;
  promptSession: (input: {
    participantId: string;
    prompt: string;
    roundId: string;
    sessionId: string;
    squadId: string;
  }) => Promise<void>;
  reconcileHosted: (desiredCount?: number) => Promise<void>;
  subscribeArtifacts: (
    listener: (
      event: HarnessStreamEvent & {
        event: Extract<HarnessEvent, { type: "artifact" }>;
      }
    ) => Promise<void> | void
  ) => () => void;
}

export interface HarnessStreamEvent {
  type: "harness.stream";
  squadId: string;
  roundId: string;
  participantId: string;
  sessionId: string;
  event: HarnessEvent;
}

interface GatewayEntry {
  generation: number;
  open: Promise<void>;
  participantId: string;
  roundId: string;
  sessionId: string;
  squadId: string;
  transport: TunnelHarnessTransport;
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

class HarnessGateway {
  readonly #abort = new AbortController();
  readonly #artifactListeners = new Set<
    (
      event: HarnessStreamEvent & {
        event: Extract<HarnessEvent, { type: "artifact" }>;
      }
    ) => Promise<void> | void
  >();
  readonly #client: GambiClient;
  readonly #entries = new Map<string, GatewayEntry>();
  readonly #events: BoardEventBus;
  readonly #onError: (error: unknown) => void;
  readonly #repository: BoardRepository;
  readonly #roomCode: string;
  #closed = false;

  constructor(options: {
    client: GambiClient;
    events: BoardEventBus;
    onError: (error: unknown) => void;
    repository: BoardRepository;
    roomCode: string;
  }) {
    this.#client = options.client;
    this.#events = options.events;
    this.#onError = options.onError;
    this.#repository = options.repository;
    this.#roomCode = options.roomCode;
  }

  subscribeArtifacts(
    listener: (
      event: HarnessStreamEvent & {
        event: Extract<HarnessEvent, { type: "artifact" }>;
      }
    ) => Promise<void> | void
  ) {
    this.#artifactListeners.add(listener);
    return () => this.#artifactListeners.delete(listener);
  }

  async prompt(input: {
    actorPersonId: string;
    prompt: string;
    squadId: string;
  }) {
    const binding = await this.#repository.requirePromptBinding(input);
    const session = await this.#repository.ensureHarnessSession({
      squadId: input.squadId,
      roundId: binding.roundId,
      participantId: binding.assignment.participantId,
    });
    const entry = this.ensureEntry({
      squadId: input.squadId,
      roundId: binding.roundId,
      participantId: binding.assignment.participantId,
      sessionId: session.sessionId,
    });
    await entry.open;
    try {
      await entry.transport.prompt(session.sessionId, input.prompt);
    } catch (error) {
      if (error instanceof HarnessTransportError && error.recoverable) {
        throw new Error(
          "A entrega do prompt ficou incerta porque o canal caiu. Confira o stream e reenvie explicitamente se necessário."
        );
      }
      throw error;
    }
    const revision = await this.#repository.recordHarnessPrompt({
      actorPersonId: input.actorPersonId,
      squadId: input.squadId,
      roundId: binding.roundId,
      participantId: binding.assignment.participantId,
      sessionId: session.sessionId,
      prompt: input.prompt,
    });
    return { sessionId: session.sessionId, revision };
  }

  async promptSession(input: {
    participantId: string;
    prompt: string;
    roundId: string;
    sessionId: string;
    squadId: string;
  }) {
    const entry = this.ensureEntry(input);
    await entry.open;
    await entry.transport.prompt(input.sessionId, input.prompt);
  }

  async restore() {
    const sessions = await this.#repository.listHarnessSessions();
    await Promise.allSettled(
      sessions.map(
        (session) =>
          this.ensureEntry({
            squadId: session.squadId,
            roundId: session.roundId,
            participantId: session.participantId,
            sessionId: session.sessionId,
          }).open
      )
    );
  }

  async close() {
    this.#closed = true;
    this.#abort.abort();
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    await Promise.allSettled(
      entries.map((entry) => entry.transport.close(entry.sessionId))
    );
  }

  private ensureEntry(binding: {
    squadId: string;
    roundId: string;
    participantId: string;
    sessionId: string;
  }) {
    const existing = this.#entries.get(binding.sessionId);
    if (existing) {
      return existing;
    }
    return this.openEntry(binding, 0);
  }

  private openEntry(
    binding: {
      squadId: string;
      roundId: string;
      participantId: string;
      sessionId: string;
    },
    generation: number
  ) {
    const transport = new TunnelHarnessTransport({
      client: this.#client,
      roomCode: this.#roomCode,
      participantId: binding.participantId,
      generateSessionId: () => binding.sessionId,
    });
    const entry: GatewayEntry = {
      ...binding,
      generation,
      transport,
      open: Promise.resolve(),
    };
    entry.open = transport
      .open({ squadId: binding.squadId, participantId: binding.participantId })
      .then(async () => {
        await this.#repository.setHarnessSessionStatus(
          binding.sessionId,
          "open"
        );
      })
      .catch(async (error) => {
        await this.#repository.setHarnessSessionStatus(
          binding.sessionId,
          "disconnected"
        );
        this.scheduleReconnect(entry);
        throw error;
      });
    this.#entries.set(binding.sessionId, entry);
    this.consume(entry).catch(this.#onError);
    return entry;
  }

  private async consume(entry: GatewayEntry) {
    for await (const event of entry.transport.events) {
      if (this.#closed || this.#entries.get(entry.sessionId) !== entry) {
        return;
      }
      const envelope: HarnessStreamEvent = {
        type: "harness.stream",
        squadId: entry.squadId,
        roundId: entry.roundId,
        participantId: entry.participantId,
        sessionId: entry.sessionId,
        event,
      };
      if (event.type === "artifact") {
        const fullEnvelope = { ...envelope, event };
        await Promise.allSettled(
          [...this.#artifactListeners].map((listener) => listener(fullEnvelope))
        );
      }
      await this.#events.publishHarness(envelope);
      if (event.type === "error" && event.recoverable) {
        await this.#repository.setHarnessSessionStatus(
          entry.sessionId,
          "disconnected"
        );
        this.scheduleReconnect(entry);
        return;
      }
    }
  }

  private scheduleReconnect(entry: GatewayEntry) {
    if (this.#entries.get(entry.sessionId) !== entry) {
      return;
    }
    this.#entries.delete(entry.sessionId);
    delay(
      Math.min(1000 * 2 ** entry.generation, RETRY_MAX_MS),
      this.#abort.signal
    ).then(() => {
      if (!(this.#closed || this.#entries.has(entry.sessionId))) {
        const replacement = this.openEntry(entry, entry.generation + 1);
        replacement.open.catch(this.#onError);
      }
    });
  }
}

class HostedHarnessSupervisor {
  readonly #abort = new AbortController();
  readonly #createSession: CreateHostedSession;
  readonly #hubUrl: string;
  readonly #id: "fake" | "opencode";
  readonly #onError: (error: unknown) => void;
  readonly #repository: BoardRepository;
  readonly #roomCode: string;
  readonly #sessions = new Map<number, HarnessParticipantSession>();
  #closed = false;
  #desired = 0;

  constructor(options: {
    createSession: CreateHostedSession;
    harnessId: "fake" | "opencode";
    hubUrl: string;
    onError: (error: unknown) => void;
    repository: BoardRepository;
    roomCode: string;
  }) {
    this.#createSession = options.createSession;
    this.#id = options.harnessId;
    this.#hubUrl = options.hubUrl;
    this.#onError = options.onError;
    this.#repository = options.repository;
    this.#roomCode = options.roomCode;
  }

  async reconcile(desiredCount: number) {
    this.#desired = desiredCount;
    await this.#repository.assertHostedScaleDownAllowed(desiredCount);
    const closing = [...this.#sessions]
      .filter(([ordinal]) => ordinal > desiredCount)
      .map(async ([ordinal, session]) => {
        this.#sessions.delete(ordinal);
        await session.close();
      });
    await Promise.all(closing);
    const starting: Promise<void>[] = [];
    for (let ordinal = 1; ordinal <= desiredCount; ordinal += 1) {
      if (!this.#sessions.has(ordinal)) {
        starting.push(this.spawn(ordinal, 0));
      }
    }
    await Promise.all(starting);
  }

  async close() {
    this.#closed = true;
    this.#abort.abort();
    this.#desired = 0;
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.all(sessions.map((session) => session.close()));
  }

  private async spawn(ordinal: number, attempt: number): Promise<void> {
    if (
      this.#closed ||
      ordinal > this.#desired ||
      this.#sessions.has(ordinal)
    ) {
      return;
    }
    try {
      const suffix = String(ordinal).padStart(2, "0");
      const session = await this.#createSession({
        harnessId: this.#id,
        hosted: true,
        hubUrl: this.#hubUrl,
        model: this.#id === "fake" ? "fake-event" : "OpenCode",
        nickname: `Hospedado ${suffix}`,
        participantId: `board-hosted-${suffix}`,
        roomCode: this.#roomCode,
      });
      if (this.#closed || ordinal > this.#desired) {
        await session.close();
        return;
      }
      this.#sessions.set(ordinal, session);
      session.waitUntilClosed().then(() => {
        if (this.#sessions.get(ordinal) === session) {
          this.#sessions.delete(ordinal);
        }
        if (!this.#closed && ordinal <= this.#desired) {
          delay(
            Math.min(1000 * 2 ** attempt, RETRY_MAX_MS),
            this.#abort.signal
          ).then(() => this.spawn(ordinal, attempt + 1).catch(this.#onError));
        }
      });
    } catch (error) {
      this.#onError(error);
      delay(
        Math.min(1000 * 2 ** attempt, RETRY_MAX_MS),
        this.#abort.signal
      ).then(() => this.spawn(ordinal, attempt + 1).catch(this.#onError));
    }
  }
}

export async function createBoardHarnessRuntime(
  options: BoardHarnessRuntimeOptions
): Promise<BoardHarnessRuntime> {
  const client = options.client ?? createClient({ hubUrl: options.hubUrl });
  const onError = options.onError ?? console.error;
  await options.repository.setRoomCode(options.roomCode);
  const abort = new AbortController();
  const gateway = new HarnessGateway({
    client,
    events: options.events,
    onError,
    repository: options.repository,
    roomCode: options.roomCode,
  });
  const supervisor = new HostedHarnessSupervisor({
    createSession:
      options.createHostedSession ?? createHarnessParticipantSession,
    harnessId: options.hostedHarnessId ?? "opencode",
    hubUrl: options.hubUrl,
    onError,
    repository: options.repository,
    roomCode: options.roomCode,
  });

  const reconcileParticipants = async () => {
    const response = await client.participants.list(options.roomCode);
    const participants: HubHarnessParticipant[] = response.data.flatMap(
      (participant) =>
        participant.harness
          ? [
              {
                id: participant.id,
                nickname: participant.nickname,
                model: participant.model,
                harness: participant.harness,
                connection: participant.connection,
              },
            ]
          : []
    );
    await options.repository.reconcileHarnessParticipants(participants);
    await options.events.publishPresence();
  };
  const interval = setInterval(() => {
    reconcileParticipants().catch(onError);
  }, RECONCILE_INTERVAL_MS);
  const watch = async () => {
    let attempt = 0;
    while (!abort.signal.aborted) {
      try {
        await reconcileParticipants();
        for await (const _event of client.events.watchRoom({
          roomCode: options.roomCode,
          signal: abort.signal,
        })) {
          await reconcileParticipants();
        }
        attempt = 0;
      } catch (error) {
        if (!abort.signal.aborted) {
          if (!isExpectedWatchDisconnect(error)) {
            onError(error);
          }
          await delay(
            Math.min(1000 * 2 ** attempt, RETRY_MAX_MS),
            abort.signal
          );
          attempt += 1;
        }
      }
    }
  };
  watch().catch(onError);
  gateway.restore().catch(onError);
  const config = await options.repository.getConfig();
  await supervisor.reconcile(config.hostedHarnessCount);

  return {
    reconcileHosted: async (desiredCount) => {
      const count =
        desiredCount ??
        (await options.repository.getConfig()).hostedHarnessCount;
      await supervisor.reconcile(count);
      await reconcileParticipants().catch(onError);
    },
    prompt: (input) => gateway.prompt(input),
    promptSession: (input) => gateway.promptSession(input),
    subscribeArtifacts: (listener) => gateway.subscribeArtifacts(listener),
    close: async () => {
      abort.abort();
      clearInterval(interval);
      await gateway.close();
      await supervisor.close();
    },
  };
}
