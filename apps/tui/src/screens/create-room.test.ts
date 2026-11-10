import { describe, expect, test } from "bun:test";

import { buildParticipantJoinCommand } from "./create-room";

describe("create room share instructions", () => {
  test("uses the canonical room flag in the copyable participant command", () => {
    expect(buildParticipantJoinCommand("ABC123")).toBe(
      "gambi participant join --room=ABC123 --endpoint <llm-url> --model <model>"
    );
  });

  test("keeps a code that starts with a dash attached to --room", () => {
    expect(buildParticipantJoinCommand("-DLWVQ")).toContain("--room=-DLWVQ ");
  });
});
