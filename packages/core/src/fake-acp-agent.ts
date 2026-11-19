#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

interface JsonRpcRequest {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

/**
 * The sessions of one run of the agent: session id to the folder it runs in.
 * It belongs to the run, not to the module, so two agents in one process
 * (a test that calls `runFakeAcpAgent` twice) do not share sessions.
 */
interface AgentSessions {
  readonly folders: Map<string, string>;
  next: number;
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function textFromPrompt(prompt: unknown): string {
  if (!Array.isArray(prompt)) {
    return "";
  }
  return prompt
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
    )
    .map((block) => block.text)
    .join("\n");
}

async function handleRequest(
  sessions: AgentSessions,
  request: JsonRpcRequest
): Promise<void> {
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {},
        agentInfo: { name: "gambi-fake-acp", version: "1" },
      },
    });
    return;
  }

  if (request.method === "session/new") {
    const cwd = request.params?.cwd;
    if (typeof cwd !== "string") {
      send({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32_602, message: "cwd is required" },
      });
      return;
    }
    const sessionId = `fake-session-${sessions.next}`;
    sessions.next += 1;
    sessions.folders.set(sessionId, cwd);
    await mkdir(cwd, { recursive: true });
    send({ jsonrpc: "2.0", id: request.id, result: { sessionId } });
    return;
  }

  if (request.method === "session/prompt") {
    const sessionId = request.params?.sessionId;
    const cwd =
      typeof sessionId === "string" ? sessions.folders.get(sessionId) : null;
    if (!(typeof sessionId === "string" && cwd)) {
      send({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32_602, message: "unknown session" },
      });
      return;
    }
    const prompt = textFromPrompt(request.params?.prompt);
    const responseText = `Fake ACP response: ${prompt}`;
    await writeFile(join(cwd, "fake-output.txt"), `${responseText}\n`);
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: responseText },
        },
      },
    });
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: { stopReason: "end_turn" },
    });
    return;
  }

  if (request.method === "session/close") {
    const sessionId = request.params?.sessionId;
    if (typeof sessionId === "string") {
      sessions.folders.delete(sessionId);
    }
    send({ jsonrpc: "2.0", id: request.id, result: {} });
    return;
  }

  if (request.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32_601, message: `Method not found: ${request.method}` },
    });
  }
}

export async function runFakeAcpAgent(): Promise<void> {
  const sessions: AgentSessions = { folders: new Map(), next: 1 };
  const lines = createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      await handleRequest(sessions, JSON.parse(line) as JsonRpcRequest);
    } catch (error) {
      process.stderr.write(
        `fake ACP error: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
}

if (import.meta.main) {
  await runFakeAcpAgent();
}
