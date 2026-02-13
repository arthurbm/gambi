import type { HealthStatus } from "../store/session-store";
import type { LogMetrics, ParticipantInfo } from "../types";
import { colors } from "../types";
import { ParticipantCard } from "./participant-card";

interface ParticipantListProps {
  participants: Map<string, ParticipantInfo>;
  processingRequests: Set<string>;
  metrics?: Map<string, LogMetrics>;
  selectedId?: string;
  expanded?: boolean;
  ownParticipantId?: string | null;
  ownHealthStatus?: HealthStatus;
}

export function ParticipantList({
  participants,
  processingRequests,
  metrics,
  selectedId,
  expanded = false,
  ownParticipantId,
  ownHealthStatus,
}: ParticipantListProps) {
  const sortedParticipants = [...participants.values()].sort((a, b) => {
    // Online first, then busy, then offline
    const statusOrder = { online: 0, busy: 1, offline: 2 };
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }
    // Then by nickname
    return a.nickname.localeCompare(b.nickname);
  });

  if (sortedParticipants.length === 0) {
    return (
      <box
        borderColor={colors.muted}
        borderStyle="single"
        flexDirection="column"
        flexGrow={1}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={colors.muted}>─ PARTICIPANTS ─</text>
        <box alignItems="center" flexGrow={1} justifyContent="center">
          <text fg={colors.muted}>No participants yet</text>
        </box>
      </box>
    );
  }

  return (
    <box
      borderColor={colors.muted}
      borderStyle="single"
      flexDirection="column"
      flexGrow={1}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={colors.muted}>─ PARTICIPANTS ─</text>
      <scrollbox flexGrow={1}>
        {sortedParticipants.map((participant) => {
          const isOwn = participant.id === ownParticipantId;
          return (
            <ParticipantCard
              expanded={expanded}
              isOwnParticipant={isOwn}
              isProcessing={processingRequests.has(participant.id)}
              key={participant.id}
              metrics={metrics?.get(participant.id)}
              ownHealthStatus={isOwn ? ownHealthStatus : undefined}
              participant={participant}
              selected={selectedId === participant.id}
            />
          );
        })}
      </scrollbox>
    </box>
  );
}
