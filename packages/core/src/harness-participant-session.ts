import { Buffer } from "node:buffer";
import { type FSWatcher, watch } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { nanoid } from "nanoid";
import {
  getHarnessAdapter,
  type HarnessAdapter,
  type SupportedHarnessId,
} from "./harness-adapters.ts";
import { createHarnessWorkspace } from "./harness-workspace.ts";
import {
  type TunnelHarnessControlMessage,
  type TunnelHarnessMessage,
  TunnelServerMessage,
} from "./tunnel-protocol.ts";
import type {
  HarnessParticipant,
  MachineSpecs,
  ParticipantConnection,
  ParticipantSummary,
  RuntimeConfig,
  TunnelBootstrap,
} from "./types.ts";
import { HEALTH_CHECK_INTERVAL } from "./types.ts";

const DEFAULT_HUB_URL = "http://localhost:3000";
const TRAILING_SLASH_REGEX = /\/$/;
const ARTIFACT_DEBOUNCE_MS = 1000;
const PROCESS_EXIT_TIMEOUT_MS = 2000;
const INTERNAL_REQUEST_TIMEOUT_MS = 10_000;
const EXCLUDED_ARTIFACT_DIRECTORIES = new Set([".git", "node_modules"]);
const PATH_SEPARATOR_REGEX = /[\\/]/;

type JsonRecord = Record<string, unknown>;
type HarnessProcess = Bun.Subprocess<"pipe", "pipe", "pipe">;
type ErrorAwareFsWatcher = FSWatcher & {
  on: (event: "error", listener: (error: Error) => void) => FSWatcher;
};

interface HubApiResult<T> {
  data: T;
}

interface HubApiError {
  error?: { message?: string };
}

interface HarnessRegistration {
  participant: ParticipantSummary & { connection: ParticipantConnection };
  roomId: string;
  tunnel: TunnelBootstrap;
}

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (message: JsonRecord) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export type HarnessParticipantLifecycleEvent =
  | { type: "harness_spawned"; pid: number }
  | { type: "session_opened"; sessionId: string }
  | {
      type: "artifact_sent";
      fileCount: number;
      reason: "watch" | "final";
      sessionId: string;
      version: number;
    }
  | { type: "harness_exited"; exitCode: number | null };

export interface HarnessParticipantSessionOptions {
  adapter?: HarnessAdapter;
  artifactDebounceMs?: number;
  config?: RuntimeConfig;
  gambiHome?: string;
  harnessId: SupportedHarnessId;
  hosted?: boolean;
  hubUrl?: string;
  model?: string;
  nickname: string;
  onEvent?: (event: HarnessParticipantLifecycleEvent) => void;
  participantId: string;
  password?: string;
  roomCode: string;
  specs?: MachineSpecs;
}

export interface HarnessParticipantSessionCloseEvent {
  error?: Error;
  reason: "closed" | "harness_exited" | "heartbeat_failed" | "tunnel_closed";
}

export interface HarnessParticipantSession {
  close: () => Promise<HarnessParticipantSessionCloseEvent>;
  harnessExited: Promise<number>;
  participant: HarnessRegistration["participant"];
  processPid: number;
  roomId: string;
  sessionId: string;
  tunnel: TunnelBootstrap;
  waitUntilClosed: () => Promise<HarnessParticipantSessionCloseEvent>;
  workspacePath: string;
}

export class HarnessDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessDependencyError";
  }
}

function ignorePromise(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

function normalizeHubUrl(value: string): string {
  return value.replace(TRAILING_SLASH_REGEX, "");
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestKey(id: unknown): string | undefined {
  if (typeof id !== "string" && typeof id !== "number") {
    return undefined;
  }
  return `${typeof id}:${String(id)}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function getHubErrorMessage(value: unknown, fallback: string): string {
  if (
    isJsonRecord(value) &&
    isJsonRecord((value as HubApiError).error) &&
    typeof (value as HubApiError).error?.message === "string"
  ) {
    return (value as HubApiError).error?.message ?? fallback;
  }
  return fallback;
}

async function requestHub<T>(
  hubUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${hubUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error("Failed to reach hub.");
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      getHubErrorMessage(body, `Request failed: ${response.statusText}`)
    );
  }
  if (!(isJsonRecord(body) && "data" in body)) {
    throw new Error("Invalid JSON response from hub.");
  }
  return (body as unknown as HubApiResult<T>).data;
}

function registerHarness(
  hubUrl: string,
  options: HarnessParticipantSessionOptions,
  harness: HarnessParticipant
): Promise<HarnessRegistration> {
  return requestHub(
    hubUrl,
    `/v1/rooms/${encodeURIComponent(options.roomCode)}/participants/${encodeURIComponent(options.participantId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        nickname: options.nickname,
        model: options.model ?? options.harnessId,
        harness,
        password: options.password,
        specs: options.specs,
        config: options.config,
      }),
    }
  );
}

function heartbeatHarness(
  hubUrl: string,
  roomCode: string,
  participantId: string
): Promise<unknown> {
  return requestHub(
    hubUrl,
    `/v1/rooms/${encodeURIComponent(roomCode)}/participants/${encodeURIComponent(participantId)}/heartbeat`,
    { method: "POST" }
  );
}

function removeHarness(
  hubUrl: string,
  roomCode: string,
  participantId: string
): Promise<unknown> {
  return requestHub(
    hubUrl,
    `/v1/rooms/${encodeURIComponent(roomCode)}/participants/${encodeURIComponent(participantId)}`,
    { method: "DELETE" }
  );
}

function openHarnessTunnel(bootstrap: TunnelBootstrap): Promise<WebSocket> {
  const url = new URL(bootstrap.url);
  url.searchParams.set("token", bootstrap.token);
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      callback();
    };
    const onOpen = () => settle(() => resolveSocket(socket));
    const onError = () =>
      settle(() => reject(new Error("Failed to open participant tunnel.")));
    const onClose = () =>
      settle(() =>
        reject(new Error("Participant tunnel closed before opening."))
      );
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
    socket.addEventListener("close", onClose, { once: true });
  });
}

async function collectArtifactFiles(workspacePath: string) {
  const files: Array<{
    content: string;
    encoding: "base64" | "utf8";
    path: string;
  }> = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".gambi.json") {
        continue;
      }
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_ARTIFACT_DIRECTORIES.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const bytes = await readFile(absolutePath);
      let content: string;
      let encoding: "base64" | "utf8";
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        encoding = "utf8";
      } catch {
        content = bytes.toString("base64");
        encoding = "base64";
      }
      files.push({
        path: relative(workspacePath, absolutePath).split(sep).join("/"),
        content,
        encoding,
      });
    }
  }

  await visit(workspacePath);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function replaceSessionId(message: JsonRecord, sessionId: string): JsonRecord {
  if (!(isJsonRecord(message.params) && "sessionId" in message.params)) {
    return message;
  }
  return {
    ...message,
    params: { ...message.params, sessionId },
  };
}

class ManagedHarnessParticipantSession implements HarnessParticipantSession {
  readonly harnessExited: Promise<number>;
  readonly participant: HarnessRegistration["participant"];
  readonly processPid: number;
  readonly roomId: string;
  readonly sessionId: string;
  readonly tunnel: TunnelBootstrap;
  readonly workspacePath: string;

  readonly #artifactDebounceMs: number;
  #artifactTimer?: ReturnType<typeof setTimeout>;
  #artifactVersion = 0;
  readonly #closePromise: Promise<HarnessParticipantSessionCloseEvent>;
  readonly #externalRequestSessions = new Map<string, string>();
  readonly #heartbeatInterval: ReturnType<typeof setInterval>;
  readonly #hubUrl: string;
  readonly #innerToOuterSession = new Map<string, string>();
  readonly #onEvent?: (event: HarnessParticipantLifecycleEvent) => void;
  readonly #outerToInnerSession = new Map<string, string>();
  readonly #pendingRequests = new Map<string, PendingRequest>();
  readonly #pingInterval: ReturnType<typeof setInterval>;
  readonly #process: HarnessProcess;
  #processStderr = "";
  #resolveClose!: (event: HarnessParticipantSessionCloseEvent) => void;
  readonly #roomCode: string;
  readonly #participantId: string;
  #stopping = false;
  #watcher?: FSWatcher;
  readonly #ws: WebSocket;

  private constructor(params: {
    artifactDebounceMs: number;
    hubUrl: string;
    onEvent?: (event: HarnessParticipantLifecycleEvent) => void;
    participant: HarnessRegistration["participant"];
    participantId: string;
    process: HarnessProcess;
    roomCode: string;
    roomId: string;
    sessionId: string;
    tunnel: TunnelBootstrap;
    workspacePath: string;
    ws: WebSocket;
  }) {
    this.#artifactDebounceMs = params.artifactDebounceMs;
    this.#hubUrl = params.hubUrl;
    this.#onEvent = params.onEvent;
    this.participant = params.participant;
    this.#participantId = params.participantId;
    this.#process = params.process;
    this.processPid = params.process.pid;
    this.#roomCode = params.roomCode;
    this.roomId = params.roomId;
    this.sessionId = params.sessionId;
    this.tunnel = params.tunnel;
    this.workspacePath = params.workspacePath;
    this.#ws = params.ws;
    this.harnessExited = params.process.exited;
    this.#closePromise = new Promise((resolveClose) => {
      this.#resolveClose = resolveClose;
    });

    this.#ws.addEventListener("message", (event) => {
      ignorePromise(this.#handleTunnelMessage(event.data));
    });
    this.#ws.addEventListener("close", () => {
      ignorePromise(this.#stop("tunnel_closed"));
    });
    this.#ws.addEventListener("error", () => {
      ignorePromise(
        this.#stop("tunnel_closed", new Error("Participant tunnel errored."))
      );
    });
    this.#pingInterval = setInterval(() => {
      this.#sendTunnel({ type: "tunnel.ping", timestamp: Date.now() });
    }, HEALTH_CHECK_INTERVAL);
    this.#heartbeatInterval = setInterval(() => {
      ignorePromise(this.#sendHeartbeat());
    }, HEALTH_CHECK_INTERVAL);

    ignorePromise(this.#readProcessOutput());
    ignorePromise(this.#readProcessStderr());
    this.harnessExited.then((exitCode) => {
      this.#emit({ type: "harness_exited", exitCode });
      if (!this.#stopping) {
        const detail = this.#processStderr.trim();
        ignorePromise(
          this.#stop(
            "harness_exited",
            new Error(
              `Harness process exited with code ${exitCode}.${detail ? ` ${detail}` : ""}`
            )
          )
        );
      }
    });
  }

  static async create(params: {
    adapter: HarnessAdapter;
    artifactDebounceMs: number;
    hubUrl: string;
    onEvent?: (event: HarnessParticipantLifecycleEvent) => void;
    participantId: string;
    registration: HarnessRegistration;
    roomCode: string;
    sessionId: string;
    workspacePath: string;
    ws: WebSocket;
  }): Promise<ManagedHarnessParticipantSession> {
    let process: HarnessProcess;
    try {
      process = Bun.spawn([params.adapter.command, ...params.adapter.args], {
        cwd: params.workspacePath,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      throw new HarnessDependencyError(
        `Failed to start ${params.adapter.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const session = new ManagedHarnessParticipantSession({
      ...params,
      process,
      participant: params.registration.participant,
      roomId: params.registration.roomId,
      tunnel: params.registration.tunnel,
    });
    session.#emit({ type: "harness_spawned", pid: process.pid });

    try {
      await session.#initializeAgent();
      await session.#openAgentSession(params.sessionId, params.workspacePath);
      session.#startWatcher();
      return session;
    } catch (error) {
      await session.#stop(
        "harness_exited",
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  waitUntilClosed(): Promise<HarnessParticipantSessionCloseEvent> {
    return this.#closePromise;
  }

  async close(): Promise<HarnessParticipantSessionCloseEvent> {
    return await this.#stop("closed");
  }

  #emit(event: HarnessParticipantLifecycleEvent): void {
    this.#onEvent?.(event);
  }

  #sendTunnel(message: JsonRecord): void {
    if (this.#ws.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(message));
    }
  }

  #writeAgent(message: JsonRecord): void {
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
    this.#process.stdin.flush();
  }

  async #requestAgent(method: string, params: JsonRecord): Promise<JsonRecord> {
    const id = `gambi:${method}:${nanoid(8)}`;
    const key = requestKey(id);
    if (!key) {
      throw new Error("Failed to create an ACP request id.");
    }
    const response = new Promise<JsonRecord>((resolveResponse, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingRequests.delete(key);
        reject(new Error(`ACP ${method} timed out.`));
      }, INTERNAL_REQUEST_TIMEOUT_MS);
      this.#pendingRequests.set(key, {
        resolve: resolveResponse,
        reject,
        timeout,
      });
    });
    this.#writeAgent({ jsonrpc: "2.0", id, method, params });
    return await response;
  }

  async #initializeAgent(): Promise<void> {
    const response = await this.#requestAgent("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "gambi", version: "0.6.0" },
    });
    if (isJsonRecord(response.error)) {
      throw new Error(
        `ACP initialize failed: ${String(response.error.message ?? "unknown error")}`
      );
    }
    if (
      !isJsonRecord(response.result) ||
      response.result.protocolVersion !== PROTOCOL_VERSION
    ) {
      throw new Error(`Harness did not negotiate ACP v${PROTOCOL_VERSION}.`);
    }
  }

  async #openAgentSession(outerSessionId: string, cwd: string): Promise<void> {
    const resolvedCwd = resolve(cwd);
    const workspaceRoot = `${resolve(this.workspacePath)}${sep}`;
    if (
      resolvedCwd !== resolve(this.workspacePath) &&
      !`${resolvedCwd}${sep}`.startsWith(workspaceRoot)
    ) {
      this.#sendStatus(
        outerSessionId,
        "error",
        "Harness sessions must stay inside the participant workspace."
      );
      return;
    }

    const response = await this.#requestAgent("session/new", {
      cwd: resolvedCwd,
      mcpServers: [],
    });
    if (isJsonRecord(response.error)) {
      throw new Error(
        `ACP session/new failed: ${String(response.error.message ?? "unknown error")}`
      );
    }
    const innerSessionId = isJsonRecord(response.result)
      ? response.result.sessionId
      : undefined;
    if (typeof innerSessionId !== "string" || !innerSessionId) {
      throw new Error("ACP session/new returned no sessionId.");
    }
    this.#outerToInnerSession.set(outerSessionId, innerSessionId);
    this.#innerToOuterSession.set(innerSessionId, outerSessionId);
    this.#sendStatus(outerSessionId, "opened");
    this.#emit({ type: "session_opened", sessionId: outerSessionId });
  }

  #sendStatus(
    sessionId: string,
    status: "closed" | "error" | "opened",
    message?: string
  ): void {
    this.#sendTunnel({
      type: "tunnel.harness.status",
      sessionId,
      status,
      message,
    });
  }

  async #readProcessOutput(): Promise<void> {
    const reader = this.#process.stdout.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffered += decoder.decode(value, { stream: true });
      while (true) {
        const newline = buffered.indexOf("\n");
        if (newline < 0) {
          break;
        }
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) {
          this.#handleAgentLine(line);
        }
      }
    }
    const finalLine = `${buffered}${decoder.decode()}`.trim();
    if (finalLine) {
      this.#handleAgentLine(finalLine);
    }
  }

  async #readProcessStderr(): Promise<void> {
    const text = await new Response(this.#process.stderr).text();
    this.#processStderr = text.slice(-4000);
  }

  #handleAgentLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!isJsonRecord(parsed)) {
      return;
    }

    const key = requestKey(parsed.id);
    const pending = key ? this.#pendingRequests.get(key) : undefined;
    if (key && pending) {
      clearTimeout(pending.timeout);
      this.#pendingRequests.delete(key);
      pending.resolve(parsed);
      return;
    }

    let outerSessionId: string | undefined;
    if (isJsonRecord(parsed.params)) {
      const innerSessionId = parsed.params.sessionId;
      if (typeof innerSessionId === "string") {
        outerSessionId = this.#innerToOuterSession.get(innerSessionId);
      }
    }
    if (!outerSessionId && key) {
      outerSessionId = this.#externalRequestSessions.get(key);
      this.#externalRequestSessions.delete(key);
    }
    outerSessionId ??= this.sessionId;

    this.#sendTunnel({
      type: "tunnel.harness.message",
      sessionId: outerSessionId,
      message: replaceSessionId(parsed, outerSessionId),
    });
  }

  async #handleTunnelMessage(rawData: MessageEvent["data"]): Promise<void> {
    const text =
      typeof rawData === "string"
        ? rawData
        : Buffer.from(rawData as ArrayBuffer).toString("utf8");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return;
    }
    const parsed = TunnelServerMessage.safeParse(value);
    if (!parsed.success) {
      return;
    }
    if (parsed.data.type === "tunnel.harness.control") {
      await this.#handleControl(parsed.data);
      return;
    }
    if (parsed.data.type === "tunnel.harness.message") {
      this.#handleHarnessMessage(parsed.data);
    }
  }

  async #handleControl(message: TunnelHarnessControlMessage): Promise<void> {
    if (message.action === "open") {
      if (this.#outerToInnerSession.has(message.sessionId)) {
        this.#sendStatus(message.sessionId, "opened");
        return;
      }
      try {
        await this.#openAgentSession(
          message.sessionId,
          message.cwd ?? this.workspacePath
        );
      } catch (error) {
        this.#sendStatus(
          message.sessionId,
          "error",
          error instanceof Error ? error.message : String(error)
        );
      }
      return;
    }

    const innerSessionId = this.#outerToInnerSession.get(message.sessionId);
    if (innerSessionId) {
      let response: JsonRecord;
      try {
        response = await this.#requestAgent("session/close", {
          sessionId: innerSessionId,
        });
      } catch (error) {
        this.#sendStatus(
          message.sessionId,
          "error",
          error instanceof Error ? error.message : String(error)
        );
        return;
      }
      if (isJsonRecord(response.error)) {
        this.#sendStatus(
          message.sessionId,
          "error",
          `ACP session/close failed: ${String(response.error.message ?? "unknown error")}`
        );
        return;
      }
      this.#outerToInnerSession.delete(message.sessionId);
      this.#innerToOuterSession.delete(innerSessionId);
    }
    this.#sendStatus(message.sessionId, "closed");
  }

  #handleHarnessMessage(frame: TunnelHarnessMessage): void {
    const innerSessionId = this.#outerToInnerSession.get(frame.sessionId);
    if (!innerSessionId) {
      this.#sendStatus(
        frame.sessionId,
        "error",
        "Harness session is not open."
      );
      return;
    }
    const message = replaceSessionId(frame.message, innerSessionId);
    const key = requestKey(message.id);
    if (key && typeof message.method === "string") {
      this.#externalRequestSessions.set(key, frame.sessionId);
    }
    this.#writeAgent(message);
  }

  #startWatcher(): void {
    this.#watcher = watch(
      this.workspacePath,
      { recursive: true },
      (_eventType, filename) => {
        if (
          !filename ||
          filename.split(PATH_SEPARATOR_REGEX).includes(".gambi.json")
        ) {
          return;
        }
        this.#scheduleArtifact();
      }
    );
    (this.#watcher as ErrorAwareFsWatcher).on("error", (error) => {
      this.#sendStatus(
        this.sessionId,
        "error",
        `Workspace watcher: ${error.message}`
      );
    });
  }

  #scheduleArtifact(): void {
    if (this.#artifactTimer) {
      clearTimeout(this.#artifactTimer);
    }
    this.#artifactTimer = setTimeout(() => {
      this.#artifactTimer = undefined;
      ignorePromise(this.#sendArtifact("watch"));
    }, this.#artifactDebounceMs);
  }

  async #sendArtifact(reason: "final" | "watch"): Promise<void> {
    if (this.#ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const files = await collectArtifactFiles(this.workspacePath);
    this.#artifactVersion += 1;
    this.#sendTunnel({
      type: "tunnel.harness.artifact",
      sessionId: this.sessionId,
      version: this.#artifactVersion,
      files,
      reason,
    });
    this.#emit({
      type: "artifact_sent",
      sessionId: this.sessionId,
      version: this.#artifactVersion,
      fileCount: files.length,
      reason,
    });
  }

  async #sendHeartbeat(): Promise<void> {
    try {
      await heartbeatHarness(this.#hubUrl, this.#roomCode, this.#participantId);
    } catch (error) {
      await this.#stop(
        "heartbeat_failed",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async #stop(
    reason: HarnessParticipantSessionCloseEvent["reason"],
    error?: Error
  ): Promise<HarnessParticipantSessionCloseEvent> {
    if (this.#stopping) {
      return await this.#closePromise;
    }
    this.#stopping = true;
    clearInterval(this.#heartbeatInterval);
    clearInterval(this.#pingInterval);
    if (this.#artifactTimer) {
      clearTimeout(this.#artifactTimer);
    }
    this.#watcher?.close();

    if (reason === "closed") {
      try {
        await this.#sendArtifact("final");
      } catch {
        // The artifact is best effort during shutdown.
      }
    }

    for (const pending of this.#pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error ?? new Error("Harness session closed."));
    }
    this.#pendingRequests.clear();

    if (this.#process.exitCode === null) {
      this.#process.kill();
      await Promise.race([
        this.harnessExited,
        new Promise<void>((resolveTimeout) =>
          setTimeout(resolveTimeout, PROCESS_EXIT_TIMEOUT_MS)
        ),
      ]);
      if (this.#process.exitCode === null) {
        this.#process.kill(9);
        await this.harnessExited;
      }
    }

    if (this.#ws.readyState === WebSocket.OPEN) {
      this.#sendStatus(this.sessionId, "closed");
      this.#ws.close();
    }
    if (reason !== "tunnel_closed") {
      try {
        await removeHarness(this.#hubUrl, this.#roomCode, this.#participantId);
      } catch {
        // The hub may already have removed the participant.
      }
    }
    const closeEvent = { reason, error };
    this.#resolveClose(closeEvent);
    return closeEvent;
  }
}

export async function createHarnessParticipantSession(
  options: HarnessParticipantSessionOptions
): Promise<HarnessParticipantSession> {
  if (options.harnessId === "claude-code" && options.hosted) {
    throw new HarnessDependencyError(
      "Claude Code cannot run as a Gambi-hosted harness for third parties. Each end user must run the unmodified binary with their own local authentication."
    );
  }
  const adapter = options.adapter ?? getHarnessAdapter(options.harnessId);
  if (adapter.id !== options.harnessId) {
    throw new HarnessDependencyError(
      `Adapter '${adapter.id}' does not match requested harness '${options.harnessId}'.`
    );
  }
  const detection = await adapter.detect();
  if (!detection.ok) {
    throw new HarnessDependencyError(
      detection.message ?? `Harness '${adapter.id}' is not ready.`
    );
  }

  const model = options.model ?? options.harnessId;
  const workspacePath = await createHarnessWorkspace({
    gambiHome: options.gambiHome,
    roomCode: options.roomCode,
    participantId: options.participantId,
    harness: options.harnessId,
    model,
  });
  const harness: HarnessParticipant = {
    id: options.harnessId,
    model: options.model,
    hosted: options.hosted,
  };
  const hubUrl = normalizeHubUrl(options.hubUrl ?? DEFAULT_HUB_URL);
  const registration = await registerHarness(hubUrl, options, harness);

  let ws: WebSocket | undefined;
  try {
    ws = await openHarnessTunnel(registration.tunnel);
    return await ManagedHarnessParticipantSession.create({
      adapter,
      artifactDebounceMs: options.artifactDebounceMs ?? ARTIFACT_DEBOUNCE_MS,
      hubUrl,
      onEvent: options.onEvent,
      participantId: options.participantId,
      registration,
      roomCode: options.roomCode,
      sessionId: nanoid(),
      workspacePath,
      ws,
    });
  } catch (error) {
    ws?.close();
    try {
      await removeHarness(hubUrl, options.roomCode, options.participantId);
    } catch {
      // Best effort cleanup after a failed startup.
    }
    throw error;
  }
}
