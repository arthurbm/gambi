import { DEFAULT_BOARD_DATABASE_URL } from "../env";
import { createBoardDatabase } from "./client";
import { migrateBoardDatabase } from "./migrate";

const databaseUrl =
  process.env.BOARD_DATABASE_URL ??
  process.env.DATABASE_URL ??
  DEFAULT_BOARD_DATABASE_URL;
const { client } = createBoardDatabase(databaseUrl);

try {
  await migrateBoardDatabase(client);
  console.log(`Board database migrated at ${databaseUrl}`);
} finally {
  client.close();
}
