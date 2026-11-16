import type { HealthStatus } from "../store/session-store";
import { colors } from "../types";

interface HealthIndicatorProps {
  status: HealthStatus;
  showLabel?: boolean;
}

const STATUS_CONFIG = {
  healthy: {
    icon: "●",
    color: colors.success,
    label: "healthy",
  },
  degraded: {
    icon: "◐",
    color: colors.warning,
    label: "degraded",
  },
  unhealthy: {
    icon: "○",
    color: colors.error,
    label: "unhealthy",
  },
} as const;

/**
 * How a participant runtime is doing: `healthy` while its tunnel is open,
 * `degraded` while it tries to come back, `unhealthy` once it ended.
 */
export function HealthIndicator({
  status,
  showLabel = false,
}: HealthIndicatorProps) {
  const config = STATUS_CONFIG[status];

  return (
    <text>
      <span fg={config.color}>{config.icon}</span>
      {showLabel && <span fg={config.color}> {config.label}</span>}
    </text>
  );
}
