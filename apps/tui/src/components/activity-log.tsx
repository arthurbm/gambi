import type { ActivityLogEntry } from "../types";
import { colors, statusIndicators } from "../types";

interface ActivityLogProps {
  entries: ActivityLogEntry[];
  maxVisible?: number;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function getEntryIcon(type: ActivityLogEntry["type"]): {
  icon: string;
  color: string;
} {
  switch (type) {
    case "join":
    case "online":
      return { icon: statusIndicators.online, color: colors.success };
    case "leave":
      return { icon: statusIndicators.leave, color: colors.warning };
    case "offline":
      return { icon: statusIndicators.offline, color: colors.muted };
    case "request":
      return { icon: statusIndicators.request, color: colors.warning };
    case "complete":
      return { icon: statusIndicators.complete, color: colors.success };
    case "error":
      return { icon: statusIndicators.error, color: colors.error };
    default: {
      const _exhaustive: never = type;
      return { icon: "?", color: colors.muted };
    }
  }
}

export function ActivityLog({ entries, maxVisible = 50 }: ActivityLogProps) {
  const visibleEntries = entries.slice(-maxVisible);

  return (
    <box
      borderColor={colors.muted}
      borderStyle="single"
      flexDirection="column"
      flexGrow={1}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={colors.muted}>─ ACTIVITY ─</text>
      <scrollbox flexGrow={1}>
        {visibleEntries.length === 0 ? (
          <text fg={colors.muted}>No activity yet</text>
        ) : (
          visibleEntries.map((entry) => {
            const { icon, color } = getEntryIcon(entry.type);
            return (
              <box flexDirection="column" key={entry.id}>
                <text>
                  <span fg={colors.muted}>{formatTime(entry.timestamp)} </span>
                  <span fg={color}>{icon}</span>
                  <span> {entry.message}</span>
                </text>
                {entry.metrics && (
                  <text>
                    <span fg={colors.muted}> ╰ </span>
                    {entry.metrics.tokensPerSecond !== undefined && (
                      <span fg={colors.metrics}>
                        {entry.metrics.tokensPerSecond.toFixed(0)} tok/s
                      </span>
                    )}
                    {entry.metrics.latencyMs !== undefined && (
                      <span fg={colors.metrics}>
                        {" "}
                        {entry.metrics.latencyMs}ms
                      </span>
                    )}
                    {entry.metrics.totalTokens !== undefined && (
                      <span fg={colors.metrics}>
                        {" "}
                        {entry.metrics.totalTokens} tok
                      </span>
                    )}
                  </text>
                )}
              </box>
            );
          })
        )}
      </scrollbox>
    </box>
  );
}
