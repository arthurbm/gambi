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
import {
  type BoardHarnessRuntime,
  type BoardHarnessRuntimeOptions,
  createBoardHarnessRuntime,
} from "./harness-runtime";
import { createContext } from "./orpc/context";
import { createAppRouter } from "./orpc/routers";
import { BoardEventBus } from "./sse";

export interface CreateBoardAppOptions {
  adminToken?: string;
  databaseUrl?: string;
  eventBus?: BoardEventBus;
  onError?: (error: unknown) => void;
  harness?: false | Omit<BoardHarnessRuntimeOptions, "events" | "repository">;
}

export interface BoardRuntime {
  app: Hono;
  client: Client;
  repository: BoardRepository;
  events: BoardEventBus;
  harness?: BoardHarnessRuntime;
  close: () => Promise<void>;
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
  const harnessOptions =
    options.harness === false
      ? undefined
      : (options.harness ??
        (process.env.GAMBI_ROOM_CODE
          ? {
              roomCode: process.env.GAMBI_ROOM_CODE,
              hubUrl: process.env.GAMBI_HUB_URL ?? "http://localhost:3000",
              hostedHarnessId:
                process.env.BOARD_HOSTED_HARNESS === "fake"
                  ? "fake"
                  : "opencode",
            }
          : undefined));
  const harness = harnessOptions
    ? await createBoardHarnessRuntime({
        ...harnessOptions,
        events,
        repository,
        onError: harnessOptions.onError ?? reportError,
      })
    : undefined;

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
          ...(event.type === "harness.stream"
            ? {}
            : { id: String(event.revision) }),
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
      harness,
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
    harness,
    close: async () => {
      await harness?.close();
      client.close();
    },
  };
}
