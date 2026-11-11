import { describe, expect, test } from "bun:test";
import { type ParticipantStatus, transitionStatus } from "@gambi/protocol";

/**
 * The status table of the spec (#109), one test per row. Anything the table
 * does not list is not a transition.
 */
describe("participant status transitions", () => {
  test("registration puts a new participant offline", () => {
    expect(transitionStatus(undefined, "registered")).toBe("offline");
  });

  test("an offline participant whose tunnel opens goes online", () => {
    expect(transitionStatus("offline", "tunnelOpened")).toBe("online");
  });

  test("an online participant the hub dispatches a request to goes busy", () => {
    expect(transitionStatus("online", "requestDispatched")).toBe("busy");
  });

  test("a busy participant whose request ends, is cancelled or times out goes back online", () => {
    expect(transitionStatus("busy", "requestEnded")).toBe("online");
  });

  test.each<ParticipantStatus>([
    "online",
    "busy",
  ])("an %s participant whose tunnel drops goes offline", (status) => {
    expect(transitionStatus(status, "tunnelDropped")).toBe("offline");
  });

  test("an offline participant that does not reconnect in time is removed", () => {
    expect(transitionStatus("offline", "reconnectDeadlinePassed")).toBe(
      "removed"
    );
  });

  test.each<ParticipantStatus>([
    "offline",
    "online",
    "busy",
  ])("an %s participant that leaves the room is removed", (status) => {
    expect(transitionStatus(status, "left")).toBe("removed");
  });

  test("an event the table does not list for a status changes nothing", () => {
    expect(transitionStatus("offline", "requestDispatched")).toBeUndefined();
    expect(transitionStatus("online", "registered")).toBeUndefined();
    expect(transitionStatus("busy", "reconnectDeadlinePassed")).toBeUndefined();
    expect(transitionStatus(undefined, "tunnelOpened")).toBeUndefined();
  });
});
