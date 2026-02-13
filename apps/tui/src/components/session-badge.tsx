import { useSessionStore } from "../store/session-store";
import { colors } from "../types";
import { HealthIndicator } from "./health-indicator";

export function SessionBadge() {
  const status = useSessionStore((s) => s.status);
  const roomCode = useSessionStore((s) => s.roomCode);
  const model = useSessionStore((s) => s.model);
  const nickname = useSessionStore((s) => s.nickname);
  const healthStatus = useSessionStore((s) => s.healthStatus);

  const isJoined = status === "joined";
  const isJoining = status === "joining";
  const isLeaving = status === "leaving";

  if (!(isJoined || isJoining || isLeaving)) {
    return (
      <box flexDirection="column">
        <text fg={colors.muted}>Session</text>
        <text fg={colors.muted}>Not joined</text>
        <text fg={colors.muted}>[j] join room</text>
      </box>
    );
  }

  if (isJoining) {
    return (
      <box flexDirection="column">
        <text fg={colors.muted}>Session</text>
        <text fg={colors.warning}>◐ Joining...</text>
        {roomCode && <text fg={colors.muted}>{roomCode}</text>}
      </box>
    );
  }

  if (isLeaving) {
    return (
      <box flexDirection="column">
        <text fg={colors.muted}>Session</text>
        <text fg={colors.warning}>◐ Leaving...</text>
      </box>
    );
  }

  return (
    <box flexDirection="column">
      <box>
        <text fg={colors.muted}>Session </text>
        <HealthIndicator status={healthStatus} />
      </box>
      {roomCode && <text fg={colors.accent}>{roomCode}</text>}
      {model && <text fg={colors.muted}>{model}</text>}
      {nickname && <text fg={colors.muted}>as {nickname}</text>}
    </box>
  );
}
