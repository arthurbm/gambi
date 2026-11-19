/**
 * The TUI's own participant in a room: joining, following the participant
 * runtime while it is in the room, and leaving. One at a time.
 *
 * Plain functions over the session store, so the screens reach them through
 * `useParticipantSession` and the tests call them against a real hub.
 */
import {
  createParticipantSession,
  type ParticipantAuthHeaders,
  type ParticipantLifecycleEvent,
  type ParticipantSession,
} from "gambi-sdk/participant";
import { useSessionStore } from "../store/session-store";
import type {
  MachineSpecs,
  ParticipantCapabilities,
  RuntimeConfig,
} from "../types";

export interface JoinParticipantData {
  authHeaders?: ParticipantAuthHeaders | undefined;
  capabilities?: ParticipantCapabilities | undefined;
  config?: RuntimeConfig | undefined;
  endpoint: string;
  id: string;
  model: string;
  nickname: string;
  password?: string | undefined;
  specs?: MachineSpecs | undefined;
}

const UNKNOWN_CAPABILITIES: ParticipantCapabilities = {
  chatCompletions: "unknown",
  openResponses: "unknown",
};

// The participant this process hosts - persists across navigation
let activeSession: ParticipantSession | null = null;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Joins `code` on the hub at `hubUrl` as a participant that shares
 * `data.endpoint`. Resolves `true` once the participant is online, and
 * `false` when the join failed (the session store says why) or another
 * session is already under way.
 */
export const joinAsParticipant = async (
  hubUrl: string,
  code: string,
  data: JoinParticipantData
): Promise<boolean> => {
  const store = useSessionStore.getState();
  if (
    store.status === "joined" ||
    store.status === "joining" ||
    store.status === "leaving"
  ) {
    return false;
  }

  store.setJoining(code);

  try {
    let session: ParticipantSession | undefined;
    const onLifecycle = (event: ParticipantLifecycleEvent) => {
      // An event of a session that is no longer the current one.
      if (session !== undefined && activeSession !== session) {
        return;
      }
      followLifecycle(event);
    };
    session = await createParticipantSession({
      hubUrl,
      roomCode: code,
      participantId: data.id,
      endpoint: data.endpoint,
      model: data.model,
      nickname: data.nickname,
      password: data.password,
      specs: data.specs,
      config: data.config,
      // What the join form found when it tested the endpoint. Without a
      // result the participant registers as `unknown`, at once: the session
      // would otherwise probe the endpoint itself before joining.
      capabilities: data.capabilities ?? UNKNOWN_CAPABILITIES,
      authHeaders: data.authHeaders,
      onLifecycle,
    });

    activeSession = session;
    store.setJoined(session.participant.id, code, {
      nickname: session.participant.nickname,
      model: session.participant.model,
      endpoint: session.participant.endpoint,
    });
    return true;
  } catch (err) {
    store.setError(messageOf(err));
    return false;
  }
};

/** Why a runtime that ended by itself did, in words for the screen. */
const whyItEnded = (
  event: Extract<ParticipantLifecycleEvent, { type: "left" }>
): string => {
  if (event.error !== undefined) {
    return event.error.message;
  }
  switch (event.reason) {
    case "replaced":
      return "Another participant runtime joined the room with this participant's id.";
    case "removed":
      return "This participant was taken out of the room.";
    default:
      return "Participant tunnel closed.";
  }
};

/**
 * What a step of the runtime's life means for the session shown on screen.
 * The runtime comes back by itself after a drop, so only its end is an error.
 */
export const followLifecycle = (event: ParticipantLifecycleEvent): void => {
  const store = useSessionStore.getState();
  switch (event.type) {
    case "connected":
      store.setConnection("healthy");
      return;
    case "reconnecting":
      store.setConnection("degraded");
      return;
    case "left": {
      // `stopped` is this process leaving, which `leaveAsParticipant` shows.
      if (event.reason === "stopped") {
        return;
      }
      const ended = activeSession;
      activeSession = null;
      store.setError(whyItEnded(event));
      // The runtime is over: release what it still holds. The hub is not
      // told that the participant left: after `replaced`, the participant
      // with this id is another runtime, and it stays in the room; after
      // `removed` there is none.
      ended?.stop();
      return;
    }
    default: {
      const _unhandled: never = event;
    }
  }
};

/** Leaves the room the TUI joined, if any. It never rejects. */
export const leaveAsParticipant = async (): Promise<void> => {
  const store = useSessionStore.getState();
  const session = activeSession;
  activeSession = null;
  if (session === null && store.status !== "joined") {
    return;
  }

  store.setLeaving();
  await session?.leave();

  if (activeSession === null) {
    useSessionStore.getState().reset();
  }
};
