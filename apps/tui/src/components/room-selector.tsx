import { RoomSummary as RoomInfoSchema } from "@gambi/core/types";
import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import type { RoomInfo } from "../types";
import { colors } from "../types";

interface RoomSelectorProps {
  hubUrl: string;
  onSelectRooms: (roomCodes: string[]) => void;
  onQuit: () => void;
}

interface RoomWithSelection extends RoomInfo {
  selected: boolean;
  participantCount: number;
}

export function RoomSelector({
  hubUrl,
  onSelectRooms,
  onQuit,
}: RoomSelectorProps) {
  const [rooms, setRooms] = useState<RoomWithSelection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursorIndex, setCursorIndex] = useState(0);

  // Fetch rooms from hub
  useEffect(() => {
    const fetchRooms = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`${hubUrl}/v1/rooms`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const envelope = (await response.json()) as { data?: unknown };
        const parsed = z.array(RoomInfoSchema).safeParse(envelope.data ?? envelope);
        if (!parsed.success) {
          throw new Error("Invalid room data");
        }

        // Fetch participant counts for each room
        const roomsWithCounts = await Promise.all(
          parsed.data.map(async (room) => {
            try {
              const participantsRes = await fetch(
                `${hubUrl}/v1/rooms/${room.code}/participants`
              );
              const participantsEnvelope = participantsRes.ok
                ? ((await participantsRes.json()) as { data?: unknown })
                : undefined;
              const participants = participantsEnvelope?.data ?? [];
              return {
                ...room,
                selected: false,
                participantCount: Array.isArray(participants)
                  ? participants.length
                  : 0,
              };
            } catch {
              return { ...room, selected: false, participantCount: 0 };
            }
          })
        );

        setRooms(roomsWithCounts);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch rooms");
      } finally {
        setLoading(false);
      }
    };

    fetchRooms();
  }, [hubUrl]);

  const toggleSelection = useCallback((index: number) => {
    setRooms((prev) =>
      prev.map((room, i) =>
        i === index ? { ...room, selected: !room.selected } : room
      )
    );
  }, []);

  const selectAll = useCallback(() => {
    setRooms((prev) => prev.map((room) => ({ ...room, selected: true })));
  }, []);

  const selectNone = useCallback(() => {
    setRooms((prev) => prev.map((room) => ({ ...room, selected: false })));
  }, []);

  const confirm = useCallback(() => {
    const selectedCodes = rooms.filter((r) => r.selected).map((r) => r.code);
    if (selectedCodes.length > 0) {
      onSelectRooms(selectedCodes);
    } else if (rooms[cursorIndex]) {
      // If nothing selected, use the room under cursor
      onSelectRooms([rooms[cursorIndex].code]);
    }
  }, [rooms, cursorIndex, onSelectRooms]);

  useKeyboard((key) => {
    if (key.name === "q") {
      onQuit();
    } else if (key.name === "up") {
      setCursorIndex((prev) => Math.max(0, prev - 1));
    } else if (key.name === "down") {
      setCursorIndex((prev) => Math.min(rooms.length - 1, prev + 1));
    } else if (key.name === "space") {
      toggleSelection(cursorIndex);
    } else if (key.name === "return") {
      confirm();
    } else if (key.name === "a") {
      selectAll();
    } else if (key.name === "n") {
      selectNone();
    }
  });

  if (loading) {
    return (
      <box
        alignItems="center"
        borderStyle="double"
        flexGrow={1}
        justifyContent="center"
      >
        <text fg={colors.muted}>Loading rooms...</text>
      </box>
    );
  }

  if (error) {
    return (
      <box
        alignItems="center"
        borderStyle="double"
        flexDirection="column"
        flexGrow={1}
        justifyContent="center"
      >
        <text fg={colors.error}>Error: {error}</text>
        <text fg={colors.muted}>Press q to quit</text>
      </box>
    );
  }

  return (
    <box borderStyle="double" flexDirection="column" flexGrow={1}>
      {/* Header */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={1}
        paddingRight={1}
      >
        <ascii-font font="tiny" text="GAMBI" />
        <text fg={colors.muted}>Hub: {hubUrl}</text>
      </box>

      {/* Separator */}
      <text fg={colors.muted}>
        ───────────────────────────────────────────────────────────
      </text>

      {/* Content */}
      <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2}>
        <text />
        <text fg={colors.primary}>Select rooms to monitor:</text>
        <text />

        {rooms.length === 0 ? (
          <text fg={colors.muted}>No rooms available</text>
        ) : (
          rooms.map((room, index) => {
            const isCursor = index === cursorIndex;
            const checkbox = room.selected ? "[x]" : "[ ]";

            return (
              <text
                bg={isCursor ? colors.primary : undefined}
                fg={isCursor ? "#000000" : undefined}
                key={room.code}
              >
                {checkbox} {room.code} ({room.participantCount} participants)
              </text>
            );
          })
        )}
      </box>

      {/* Footer */}
      <text fg={colors.muted}>
        ───────────────────────────────────────────────────────────
      </text>
      <box paddingLeft={1} paddingRight={1}>
        <text>
          <span fg={colors.primary}>Space</span>
          <span fg={colors.muted}> Toggle </span>
          <span fg={colors.primary}>Enter</span>
          <span fg={colors.muted}> Connect </span>
          <span fg={colors.primary}>a</span>
          <span fg={colors.muted}> All </span>
          <span fg={colors.primary}>n</span>
          <span fg={colors.muted}> None </span>
          <span fg={colors.primary}>q</span>
          <span fg={colors.muted}> Quit</span>
        </text>
      </box>
    </box>
  );
}
