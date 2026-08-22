import type { Client } from "@libsql/client";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";

import { createBoardDatabase } from "./db/client";
import { migrateBoardDatabase } from "./db/migrate";
import { BoardRepository } from "./db/repository";
import { DEFAULT_BOARD_DATABASE_URL } from "./env";
import { createContext } from "./orpc/context";
import { createAppRouter } from "./orpc/routers";
import { BoardEventBus } from "./sse";

export interface CreateBoardAppOptions {
  adminToken?: string;
  databaseUrl?: string;
  eventBus?: BoardEventBus;
  onError?: (error: unknown) => void;
}

export interface BoardRuntime {
  app: Hono;
  client: Client;
  repository: BoardRepository;
  events: BoardEventBus;
  close: () => void;
}

export async function createBoardApp(
  options: CreateBoardAppOptions = {}
): Promise<BoardRuntime> {
  const databaseUrl =
    options.databaseUrl ??
    process.env.BOARD_DATABASE_URL ??
    process.env.DATABASE_URL ??
    DEFAULT_BOARD_DATABASE_URL;
  const adminToken =
    options.adminToken ?? process.env.BOARD_ADMIN_TOKEN ?? "gambi-local-admin";
  const { client, db } = createBoardDatabase(databaseUrl);
  await migrateBoardDatabase(client);

  const repository = new BoardRepository(db);
  await repository.initialize();
  const events = options.eventBus ?? new BoardEventBus();
  const appRouter = createAppRouter();
  const reportError = options.onError ?? console.error;
  const app = new Hono();

  app.use(
    "/*",
    cors({
      origin: "*",
      allowHeaders: ["Content-Type", "x-board-admin-token"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    })
  );

  app.get("/events", async (context) =>
    streamSSE(context, async (stream) => {
      let aborted = false;
      const revision = await repository.getRevision();
      await stream.writeSSE({
        event: "board.snapshot",
        data: JSON.stringify({ type: "board.snapshot", revision }),
        id: String(revision),
      });
      const unsubscribe = events.subscribe(async (event) => {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
          id: String(event.revision),
        });
      });
      stream.onAbort(() => {
        aborted = true;
        unsubscribe();
      });

      while (!aborted) {
        await stream.sleep(15_000);
        if (!aborted) {
          await stream.writeSSE({ event: "ping", data: "{}" });
        }
      }
    })
  );

  const apiHandler = new OpenAPIHandler(appRouter, {
    plugins: [
      new OpenAPIReferencePlugin({
        schemaConverters: [new ZodToJsonSchemaConverter()],
      }),
    ],
    interceptors: [onError(reportError)],
  });
  const rpcHandler = new RPCHandler(appRouter, {
    interceptors: [onError(reportError)],
  });

  app.use("/*", async (context, next) => {
    const rpcContext = createContext({
      context,
      repository,
      events,
      adminToken,
    });
    const rpcResult = await rpcHandler.handle(context.req.raw, {
      prefix: "/rpc",
      context: rpcContext,
    });
    if (rpcResult.matched) {
      return rpcResult.response;
    }

    const apiResult = await apiHandler.handle(context.req.raw, {
      prefix: "/api-reference",
      context: rpcContext,
    });
    if (apiResult.matched) {
      return apiResult.response;
    }
    return next();
  });

  app.get("/", (context) =>
    context.json({ service: "gambi-board", status: "ok" })
  );

  return {
    app,
    client,
    repository,
    events,
    close: () => client.close(),
  };
}
