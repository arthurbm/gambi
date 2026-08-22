import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Client, createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import {
  boardConfig,
  events,
  memberships,
  people,
  rounds,
  squads,
} from "./schema";

const schema = { boardConfig, events, memberships, people, rounds, squads };

export type BoardDatabase = LibSQLDatabase<typeof schema>;

function ensureDatabaseDirectory(url: string) {
  if (!url.startsWith("file:") || url.includes(":memory:")) {
    return;
  }

  const filePath = url.slice("file:".length);
  const absolutePath = filePath.startsWith("/")
    ? filePath
    : resolve(process.cwd(), filePath);
  const directory = dirname(absolutePath);
  mkdirSync(directory, { recursive: true });
}

export function createBoardDatabase(url: string): {
  client: Client;
  db: BoardDatabase;
} {
  ensureDatabaseDirectory(url);
  // libSQL transactions use a second connection. Shared-cache mode keeps an
  // injected in-memory database visible to both the client and Drizzle.
  const client = createClient({
    url: url === ":memory:" ? "file::memory:?cache=shared" : url,
  });
  return { client, db: drizzle({ client, schema }) };
}
