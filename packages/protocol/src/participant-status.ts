/**
 * The status of a participant and the one function that changes it.
 *
 * The status derives from the tunnel alone (ADR-0007): there is no heartbeat
 * and no separate connection state. `transitionStatus` is the table of the
 * spec, and the hub applies every change through it.
 */
import { Schema } from "effect";

/**
 * - `offline`: registered, no open tunnel. Receives no routes.
 * - `online`: the tunnel is open and the participant is idle. Only this
 *   status receives routes.
 * - `busy`: the hub dispatched a request that has not ended yet.
 */
export const ParticipantStatus = Schema.Literals(["offline", "online", "busy"]);
export type ParticipantStatus = typeof ParticipantStatus.Type;

/** What can happen to a participant, as the hub sees it. */
export type StatusEvent =
  /** The participant registered in the room. */
  | "registered"
  /** Its tunnel opened. */
  | "tunnelOpened"
  /** The hub dispatched a request into its tunnel. */
  | "requestDispatched"
  /** That request ended, was cancelled or timed out. */
  | "requestEnded"
  /** Its tunnel dropped. A request in flight fails with a typed error. */
  | "tunnelDropped"
  /** It stayed offline past the reconnection deadline. */
  | "reconnectDeadlinePassed"
  /** It left the room. */
  | "left";

/** Where a transition leads: a status, or out of the room. */
export type StatusAfter = ParticipantStatus | "removed";

const TRANSITIONS: Record<
  StatusEvent,
  Partial<Record<ParticipantStatus | "unregistered", StatusAfter>>
> = {
  registered: { unregistered: "offline" },
  tunnelOpened: { offline: "online" },
  requestDispatched: { online: "busy" },
  requestEnded: { busy: "online" },
  tunnelDropped: { online: "offline", busy: "offline" },
  reconnectDeadlinePassed: { offline: "removed" },
  left: { offline: "removed", online: "removed", busy: "removed" },
};

/**
 * The status a participant moves to when `event` happens. `current` is
 * `undefined` for a participant that is not in the room yet.
 *
 * Returns `undefined` when the table has no row for the pair: the event
 * changes nothing, and no room event is due.
 *
 * @example
 * transitionStatus("offline", "tunnelOpened"); // "online"
 * transitionStatus("offline", "requestDispatched"); // undefined
 */
export const transitionStatus = (
  current: ParticipantStatus | undefined,
  event: StatusEvent
): StatusAfter | undefined => TRANSITIONS[event][current ?? "unregistered"];
