import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Client } from "@libsql/client";

export async function migrateBoardDatabase(client: Client) {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute(`
    CREATE TABLE IF NOT EXISTS board_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const existing = await client.execute("SELECT id FROM board_migrations");
  const applied = new Set(existing.rows.map((row) => String(row.id)));
  const migrationsDirectory = new URL("../../drizzle/", import.meta.url);
  const migrations = (await readdir(fileURLToPath(migrationsDirectory)))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const filename of migrations) {
    const migration = filename.slice(0, -4);
    if (applied.has(migration)) {
      continue;
    }
    const migrationUrl = new URL(filename, migrationsDirectory);
    const migrationSql = await Bun.file(migrationUrl).text();
    await client.executeMultiple(migrationSql);
    await client.execute({
      sql: "INSERT INTO board_migrations (id) VALUES (?)",
      args: [migration],
    });
  }
}
