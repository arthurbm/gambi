import { useKeyboard } from "@opentui/react";
import { ClientError } from "gambi-sdk";
import { useCallback, useState } from "react";
import { useHubClient } from "../hooks/use-hub-client";
import { colors } from "../types";

interface AddRoomModalProps {
  onAdd: (roomCode: string) => void;
  onCancel: () => void;
}

export function AddRoomModal({ onAdd, onCancel }: AddRoomModalProps) {
  const client = useHubClient();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    const code = value.trim().toUpperCase();
    if (!code) {
      setError("Please enter a room code");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Verify room exists
      await client.rooms.get(code);
      onAdd(code);
    } catch (err) {
      const notFound =
        err instanceof ClientError && err.code === "ROOM_NOT_FOUND";
      setError(
        notFound || !(err instanceof Error) ? "Room not found" : err.message
      );
      setLoading(false);
    }
  }, [value, client, onAdd]);

  useKeyboard((key) => {
    if (key.name === "escape") {
      onCancel();
    } else if (key.name === "return") {
      handleSubmit();
    }
  });

  return (
    <box alignItems="center" flexGrow={1} justifyContent="center">
      <box
        borderStyle="double"
        flexDirection="column"
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        width={40}
      >
        {/* Title */}
        <text fg={colors.primary}>ADD ROOM</text>
        <text />

        {/* Input label */}
        <text fg={colors.muted}>Room Code:</text>

        {/* Input */}
        <box
          borderColor={error ? colors.error : undefined}
          borderStyle="single"
        >
          <input onChange={setValue} placeholder="ABC123" value={value} />
        </box>

        {/* Error message */}
        {error && (
          <>
            <text />
            <text fg={colors.error}>{error}</text>
          </>
        )}

        {/* Loading indicator */}
        {loading && (
          <>
            <text />
            <text fg={colors.muted}>Connecting...</text>
          </>
        )}

        {/* Footer */}
        <text />
        <text>
          <span fg={colors.primary}>[Enter]</span>
          <span fg={colors.muted}> Connect </span>
          <span fg={colors.primary}>[Esc]</span>
          <span fg={colors.muted}> Cancel</span>
        </text>
      </box>
    </box>
  );
}
