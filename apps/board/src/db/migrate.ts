import type { Client } from "@libsql/client";

const INITIAL_MIGRATION = "0000_initial";

export async function migrateBoardDatabase(client: Client) {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute(`
    CREATE TABLE IF NOT EXISTS board_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const existing = await client.execute({
    sql: "SELECT id FROM board_migrations WHERE id = ?",
    args: [INITIAL_MIGRATION],
  });
  if (existing.rows.length > 0) {
    return;
  }

  const migrationUrl = new URL(
    "../../drizzle/0000_initial.sql",
    import.meta.url
  );
  const migrationSql = await Bun.file(migrationUrl).text();
  await client.executeMultiple(migrationSql);
  await client.execute({
    sql: "INSERT INTO board_migrations (id) VALUES (?)",
    args: [INITIAL_MIGRATION],
  });
}
