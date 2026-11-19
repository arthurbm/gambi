// A room code never contains a space, so the pair is unambiguous.
export const participantKey = (roomCode: string, participantId: string) =>
  `${roomCode} ${participantId}`;
