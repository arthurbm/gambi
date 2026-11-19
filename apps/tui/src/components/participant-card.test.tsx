import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { ReactNode } from "react";
import { createParticipant } from "../__tests__/factories";
import { ParticipantCard } from "./participant-card";

/** What the terminal shows for `node`. */
const frameOf = async (node: ReactNode): Promise<string> => {
  const rendered = await testRender(node, { width: 48, height: 14 });
  await rendered.renderOnce();
  const frame = rendered.captureCharFrame();
  rendered.renderer.destroy();
  return frame;
};

test.each([
  ["online", "●"],
  ["busy", "◐"],
  ["offline", "○"],
] as const)("a participant that is %s shows that one status", async (status, icon) => {
  const frame = await frameOf(
    <ParticipantCard
      expanded
      participant={createParticipant("p1", "Arthur", { status })}
    />
  );

  expect(frame).toContain(`${icon} Arthur`);
  expect(frame).toContain(`Status ${status}`);
  // One status, shown once: no second dot beside the name to read against it.
  expect(frame.match(/[●◐○]/g)).toEqual([icon]);
  // The tunnel is not a second thing to read: the status already says it.
  expect(frame).not.toContain("Tunnel");
  expect(frame).not.toContain("Last tunnel seen");
});

test("a participant with no model endpoint shows no endpoint line", async () => {
  const { endpoint: _endpoint, ...harness } = createParticipant("p1", "Arthur");

  const frame = await frameOf(<ParticipantCard participant={harness} />);

  expect(frame).toContain("Arthur");
  expect(frame).not.toContain("undefined");
});

test("the TUI's own card shows the hub's status and no health of its own", async () => {
  const frame = await frameOf(
    <ParticipantCard
      isOwnParticipant
      participant={createParticipant("p1", "Arthur", { status: "offline" })}
    />
  );

  expect(frame).toContain("○ Arthur YOU");
  expect(frame.match(/[●◐○]/g)).toEqual(["○"]);
});
