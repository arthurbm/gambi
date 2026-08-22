import { createBoardApp } from "./app";
import { readBoardEnv } from "./env";

const env = readBoardEnv();
const runtime = await createBoardApp({
  adminToken: env.BOARD_ADMIN_TOKEN,
  databaseUrl: env.BOARD_DATABASE_URL,
});

const server = Bun.serve({
  hostname: env.BOARD_HOST,
  idleTimeout: 255,
  port: env.BOARD_PORT,
  fetch: runtime.app.fetch,
});

console.log(
  `Gambi board listening on http://${server.hostname}:${server.port}`
);

async function shutdown() {
  server.stop();
  await runtime.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
