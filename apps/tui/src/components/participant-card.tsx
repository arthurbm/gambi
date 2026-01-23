import type { LogMetrics, ParticipantInfo } from "../types";
import { colors, statusIndicators } from "../types";

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
}

export function ParticipantCard({
  participant,
  isProcessing = false,
  metrics,
  expanded = false,
  selected = false,
}: ParticipantCardProps) {
  const status = isProcessing ? "busy" : participant.status;
  const indicator = statusIndicators[status];
  const statusColor = statusColorMap[status];

  const borderColor = selected ? colors.primary : undefined;

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
        <text>
          <span fg={statusColor}>{indicator}</span>
          <span fg={status === "offline" ? colors.muted : undefined}>
            {" "}
            {participant.nickname}
          </span>
          {selected && <span fg={colors.primary}> ◉</span>}
          {status === "offline" && <span fg={colors.muted}> (offline)</span>}
        </text>
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
