import type { HealthStatus } from "../store/session-store";
import { colors } from "../types";

interface HealthIndicatorProps {
  status: HealthStatus;
  showLabel?: boolean;
  lastCheck?: Date | null;
  showLastCheck?: boolean;
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

const STALE_THRESHOLD_MS = 30_000; // 30 seconds

/**
 * Format time since last check in a human-readable way.
 */
function formatTimeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

/**
 * Compute effective status considering staleness.
 * If last check is > 30s ago, consider degraded.
 */
function getEffectiveStatus(
  status: HealthStatus,
  lastCheck: Date | null | undefined
): HealthStatus {
  if (!lastCheck) {
    return status;
  }
  const timeSince = Date.now() - lastCheck.getTime();
  if (timeSince > STALE_THRESHOLD_MS && status === "healthy") {
    return "degraded";
  }
  return status;
}

export function HealthIndicator({
  status,
  showLabel = false,
  lastCheck,
  showLastCheck = false,
}: HealthIndicatorProps) {
  // Auto-degrade if last check is stale
  const effectiveStatus = getEffectiveStatus(status, lastCheck);
  const config = STATUS_CONFIG[effectiveStatus];

  const lastCheckText =
    showLastCheck && lastCheck ? ` (${formatTimeSince(lastCheck)})` : "";

  return (
    <text>
      <span fg={config.color}>{config.icon}</span>
      {showLabel && <span fg={config.color}> {config.label}</span>}
      {lastCheckText && <span fg={colors.muted}>{lastCheckText}</span>}
    </text>
  );
}
