import type { HealthStatus } from "../store/session-store";
import type { LogMetrics, ParticipantInfo } from "../types";
import { colors, statusIndicators } from "../types";
import { HealthIndicator } from "./health-indicator";

const statusColorMap: Record<ParticipantInfo["status"], string> = {
  online: colors.success,
  busy: colors.warning,
  offline: colors.muted,
};

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
  const status = isProcessing ? "busy" : participant.status;
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
        </>
      )}
    </box>
  );
}
