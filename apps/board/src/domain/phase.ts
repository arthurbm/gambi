export const PHASES = [
  "lobby",
  "round:1",
  "round:2",
  "round:3",
  "round:4",
  "round:5",
  "round:6",
  "finale",
] as const;

export type BoardPhase = (typeof PHASES)[number];

export function isBoardPhase(value: string): value is BoardPhase {
  return PHASES.includes(value as BoardPhase);
}

export function nextPhase(current: BoardPhase): BoardPhase | null {
  const index = PHASES.indexOf(current);
  return PHASES[index + 1] ?? null;
}

export function roundNumberForPhase(phase: BoardPhase): number | null {
  if (!phase.startsWith("round:")) {
    return null;
  }
  return Number.parseInt(phase.slice("round:".length), 10);
}
