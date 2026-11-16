#!/usr/bin/env bun
/**
 * A harness that misbehaves on purpose, run as a subprocess by the harness
 * tests. `bun fixture-acp-agent.ts <mode> [path]`; the modes are listed in
 * `harness-fixtures.ts`. It calls no model.
 *
 * With `path`, it opens that file for writing and keeps it open, and so does
 * every process it starts. A test that made `path` a FIFO learns that all of
 * them are gone when the FIFO reaches end of file.
 */
import { spawn } from "node:child_process";
import { appendFileSync, openSync } from "node:fs";
import { createInterface } from "node:readline";

const [mode = "", path] = process.argv.slice(2);

interface Request {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

const send = (message: Record<string, unknown>) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const held =
  path === undefined || mode === "recording" ? undefined : openSync(path, "w");

if (mode === "with-child" && held !== undefined) {
  spawn("sleep", ["1000"], { stdio: ["ignore", held, "ignore"] });
}
if (mode === "stubborn" && held !== undefined) {
  process.on("SIGTERM", () => undefined);
  process.on("SIGINT", () => undefined);
  // The shell ignores SIGTERM and SIGINT, and so does the `sleep` it starts.
  spawn("sh", ["-c", "trap '' TERM INT; sleep 1000"], {
    stdio: ["ignore", held, "ignore"],
  });
}

let sessions = 0;

const answer = (request: Request) => {
  if (mode === "silent") {
    return;
  }
  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: { protocolVersion: mode === "acp-v2" ? 2 : 1 },
    });
    return;
  }
  if (request.method === "session/new") {
    sessions += 1;
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: { sessionId: `fixture-session-${sessions}` },
    });
    return;
  }
  if (request.method === "session/prompt") {
    if (mode === "crashes-on-prompt") {
      process.stderr.write("fixture: crashing on purpose\n");
      process.exit(7);
    }
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: { stopReason: "end_turn" },
    });
    return;
  }
  send({ jsonrpc: "2.0", id: request.id, result: {} });
};

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === "") {
    continue;
  }
  if (mode === "recording" && path !== undefined) {
    appendFileSync(path, `${line}\n`);
  }
  answer(JSON.parse(line) as Request);
}
