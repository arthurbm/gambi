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
import {
  injectTileStatusBridge,
  TILE_CONTENT_SECURITY_POLICY,
} from "./tile-response";

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
  const unsubscribeArtifacts = harness?.subscribeArtifacts(async (envelope) => {
    try {
      const result = await repository.ingestTileArtifact({
        participantId: envelope.participantId,
        sessionId: envelope.sessionId,
        sourceVersion: envelope.event.version,
        reason: envelope.event.reason,
        files: envelope.event.files,
      });
      if (result.created) {
        await events.publish({
          type: "board.changed",
          change: result.valid ? "tile.versioned" : "tile.invalid",
          revision: result.revision,
        });
      }
    } catch (error) {
      reportError(error);
    }
  });

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

  app.get("/tiles/:squadId/live/index.html", async (context) => {
    const tile = await repository.getLiveTileDocument(
      context.req.param("squadId")
    );
    if (!tile) {
      return context.text("Nenhum tile está no ar para este squad.", 404, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
    }
    return context.body(
      injectTileStatusBridge({
        tileId: tile.id,
        squadId: tile.squadId,
        boardVersion: tile.boardVersion,
        indexHtml: tile.indexHtml,
      }),
      200,
      {
        "Cache-Control": "no-store",
        "Content-Security-Policy": TILE_CONTENT_SECURITY_POLICY,
        "Content-Type": "text/html; charset=utf-8",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      }
    );
  });

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
      unsubscribeArtifacts?.();
      await harness?.close();
      client.close();
    },
  };
}
