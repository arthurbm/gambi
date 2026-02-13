import { type HubStatus, useHubStore } from "../store/hub-store";
import { colors } from "../types";

const STATUS_CONFIG: Record<
  HubStatus,
  { icon: string; color: string; label: string }
> = {
  running: {
    icon: "●",
    color: colors.success,
    label: "Running",
  },
  starting: {
    icon: "◐",
    color: colors.warning,
    label: "Starting",
  },
  stopping: {
    icon: "◐",
    color: colors.warning,
    label: "Stopping",
  },
  stopped: {
    icon: "○",
    color: colors.muted,
    label: "Stopped",
  },
  error: {
    icon: "✗",
    color: colors.error,
    label: "Error",
  },
};

export function HubStatusIndicator() {
  const status = useHubStore((s) => s.status);
  const url = useHubStore((s) => s.url);
  const port = useHubStore((s) => s.port);

  const config = STATUS_CONFIG[status];
  const displayPort = url ? `:${new URL(url).port}` : `:${port}`;

  return (
    <box flexDirection="column" gap={0}>
      <text>
        <span fg={colors.muted}>Hub </span>
        <span fg={config.color}>{config.icon}</span>
      </text>
      {status === "running" ? (
        <text fg={colors.accent}>{displayPort}</text>
      ) : (
        <text fg={colors.muted}>{config.label}</text>
      )}
      <text fg={colors.muted}>
        {status === "running" ? "[h] stop" : "[h] start"}
      </text>
    </box>
  );
}
