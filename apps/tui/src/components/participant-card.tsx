import type { HealthStatus } from "../store/session-store";
import type { LogMetrics, ParticipantInfo } from "../types";
import { colors, statusIndicators } from "../types";
import { HealthIndicator } from "./health-indicator";

const statusColorMap: Record<ParticipantInfo["status"], string> = {
  online: colors.success,
  busy: colors.warning,
  offline: colors.muted,
};

function formatTunnelSeenAt(timestamp: number | null): string {
  if (!timestamp) {
    return "never";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  return `${Math.floor(seconds / 60)}m ago`;
}

interface ParticipantCardProps {
  participant: ParticipantInfo;
  isProcessing?: boolean;
  metrics?: LogMetrics;
  expanded?: boolean;
  selected?: boolean;
  isOwnParticipant?: boolean;
  ownHealthStatus?: HealthStatus;
}

export function ParticipantCard({
  participant,
  isProcessing = false,
  metrics,
  expanded = false,
  selected = false,
  isOwnParticipant = false,
  ownHealthStatus,
}: ParticipantCardProps) {
  const available = participant.connection.connected;
  const status =
    isProcessing && available
      ? "busy"
      : available
        ? participant.status
        : "offline";
  const indicator = statusIndicators[status];
  const statusColor = statusColorMap[status];

  // Own participant gets highlighted border, selected gets primary
  function getBorderColor(): string | undefined {
    if (isOwnParticipant) {
      return colors.accent;
    }
    if (selected) {
      return colors.primary;
    }
    return undefined;
  }
  const borderColor = getBorderColor();

  // Format metrics
  const metricsText =
    isProcessing && metrics
      ? `${metrics.tokensPerSecond?.toFixed(0) ?? "?"} tok/s ${metrics.latencyMs ?? "?"}ms`
      : "";
  const tunnelSeenText = participant.connection.lastTunnelSeenAt
    ? new Date(participant.connection.lastTunnelSeenAt).toLocaleTimeString()
    : "never";

  return (
    <box
      borderColor={borderColor}
      borderStyle="rounded"
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Header line: status indicator + name + badge */}
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={1}>
          <text>
            <span fg={statusColor}>{indicator}</span>
            <span fg={status === "offline" ? colors.muted : undefined}>
              {" "}
              {participant.nickname}
            </span>
            {isOwnParticipant && <span fg={colors.accent}> YOU</span>}
            {selected && !isOwnParticipant && (
              <span fg={colors.primary}> ◉</span>
            )}
          </text>
          {/* Health indicator: own participant uses session health, others derive from status */}
          {isOwnParticipant && ownHealthStatus ? (
            <HealthIndicator status={ownHealthStatus} />
          ) : (
            <HealthIndicator
              status={status === "offline" ? "unhealthy" : "healthy"}
            />
          )}
        </box>
        {isProcessing && (
          <text>
            <span fg={colors.warning}>{statusIndicators.request}</span>
            <span fg={colors.warning}> LLM</span>
          </text>
        )}
      </box>

      {/* Model */}
      <text>
        <span fg={colors.primary}> {participant.model}</span>
        {metricsText && <span fg={colors.metrics}> {metricsText}</span>}
      </text>

      {/* Endpoint */}
      <text fg={colors.muted}> {participant.endpoint}</text>

      {/* Expanded details */}
      {expanded && (
        <>
          <text fg={colors.muted}> ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈</text>
          {participant.specs.gpu && (
            <box flexDirection="row">
              <text fg={colors.muted}> GPU </text>
              <text>{participant.specs.gpu}</text>
              {participant.specs.vram && (
                <text fg={colors.muted}> │ {participant.specs.vram}GB</text>
              )}
            </box>
          )}
          {participant.specs.ram && (
            <box flexDirection="row">
              <text fg={colors.muted}> RAM </text>
              <text>{participant.specs.ram}GB</text>
              {participant.config.temperature !== undefined && (
                <text fg={colors.muted}>
                  {" "}
                  │ temp {participant.config.temperature}
                </text>
              )}
            </box>
          )}
          <text fg={participant.connection.connected ? colors.success : colors.error}>
            Tunnel {participant.connection.connected ? "connected" : "disconnected"}
          </text>
          <text fg={colors.muted}>
            Last tunnel seen:{" "}
            {formatTunnelSeenAt(participant.connection.lastTunnelSeenAt)}
          </text>
          {participant.config.hasInstructions && (
            <text fg={colors.muted}> Prompt defaults configured</text>
          )}
        </>
      )}
    </box>
  );
}
