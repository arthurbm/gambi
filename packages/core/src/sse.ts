/**
 * Server-Sent Events helper for broadcasting events to TUI clients
 */
import type { RoomEvent, RoomEventType } from "./types.ts";

export interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  roomCode?: string;
}

const encoder = new TextEncoder();
const clients = new Map<string, SSEClient>();

/**
 * Create an SSE response for a client
 */
export function createSSEResponse(
  clientId: string,
  roomCode?: string
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      clients.set(clientId, { id: clientId, controller, roomCode });

      // Send initial connection event
      const connectedEvent: RoomEvent = {
        type: "connected",
        timestamp: Date.now(),
        roomCode,
        data: { clientId },
      };
      const data = encoder.encode(
        `event: connected\ndata: ${JSON.stringify(connectedEvent)}\n\n`
      );
      controller.enqueue(data);
    },
    cancel() {
      clients.delete(clientId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Broadcast an event to all connected clients
 */
export function broadcast(
  event: RoomEventType,
  data: unknown,
  roomCode?: string
): void {
  const payload: RoomEvent = {
    type: event,
    timestamp: Date.now(),
    roomCode,
    data,
  };
  const message = encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
  );

  for (const client of clients.values()) {
    // If roomCode is specified, only send to clients watching that room
    if (roomCode && client.roomCode && client.roomCode !== roomCode) {
      continue;
    }

    try {
      client.controller.enqueue(message);
    } catch {
      // Client disconnected, remove from map
      clients.delete(client.id);
    }
  }
}

/**
 * Get the number of connected SSE clients
 */
export function getClientCount(): number {
  return clients.size;
}

/**
 * Close all SSE connections (for cleanup)
 */
export function closeAll(): void {
  for (const client of clients.values()) {
    try {
      client.controller.close();
    } catch {
      // Already closed
    }
  }
  clients.clear();
}

export const SSE = {
  createResponse: createSSEResponse,
  broadcast,
  getClientCount,
  closeAll,
} as const;
