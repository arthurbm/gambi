import { useKeyboard } from "@opentui/react";
import { useCallback, useState } from "react";
import { Footer } from "../components/footer";
import { useCreateRoom } from "../hooks/queries";
import type { Screen } from "../hooks/use-navigation";
import { colors } from "../types";

interface CreateRoomProps {
  onNavigate: (screen: Screen, params: Record<string, unknown>) => void;
  onBack: () => void;
  canGoBack: boolean;
}

type Step = "form" | "success";

export function CreateRoom({ onNavigate, onBack, canGoBack }: CreateRoomProps) {
  const createRoom = useCreateRoom();

  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [focusedField, setFocusedField] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [createdRoom, setCreatedRoom] = useState<{
    code: string;
    name: string;
  } | null>(null);

  const handleSubmit = useCallback(() => {
    if (!name.trim()) {
      setValidationError("Name is required");
      return;
    }

    setValidationError(null);

    createRoom.mutate(
      { name: name.trim(), password: password || undefined },
      {
        onSuccess: (data) => {
          setCreatedRoom({
            code: data.room.code,
            name: data.room.name,
          });
          setStep("success");
        },
      }
    );
  }, [createRoom, name, password]);

  useKeyboard(
    (key) => {
      if (step === "success") {
        if (key.name === "m" && createdRoom) {
          onNavigate("monitor", { roomCodes: [createdRoom.code] });
        } else if (key.name === "escape" || key.name === "b") {
          onBack();
        }
        return;
      }

      if (key.name === "escape") {
        onBack();
        return;
      }

      if (key.name === "tab") {
        setFocusedField((i) => (i + 1) % 2);
      } else if (key.name === "return") {
        handleSubmit();
      }
    },
    { release: false }
  );

  const error =
    validationError ||
    (createRoom.error instanceof Error ? createRoom.error.message : null);

  if (step === "success" && createdRoom) {
    return (
      <box flexDirection="column" flexGrow={1}>
        <box
          alignItems="center"
          flexDirection="column"
          flexGrow={1}
          gap={2}
          justifyContent="center"
        >
          <text fg={colors.success}>✓ Room created successfully!</text>
          <box alignItems="center" flexDirection="column" gap={1}>
            <text>
              <span fg={colors.muted}>Code: </span>
              <span fg={colors.primary}>{createdRoom.code}</span>
            </text>
            <text>
              <span fg={colors.muted}>Name: </span>
              <span fg={colors.text}>{createdRoom.name}</span>
            </text>
          </box>
        </box>

        <Footer
          canGoBack={canGoBack}
          shortcuts={[
            { key: "m", description: "Monitor this room" },
            { key: "b", description: "Back to menu" },
          ]}
        />
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box padding={1}>
        <text fg={colors.primary}>Create New Room</text>
      </box>

      <box flexDirection="column" flexGrow={1} gap={2} padding={2}>
        {/* Name field */}
        <box flexDirection="column">
          <text>
            <span fg={colors.text}>Room Name</span>
            <span fg={colors.error}> *</span>
          </text>
          <input
            backgroundColor={focusedField === 0 ? colors.surface : undefined}
            focused={focusedField === 0}
            onChange={setName}
            placeholder="Enter room name..."
            value={name}
            width={40}
          />
        </box>

        {/* Password field */}
        <box flexDirection="column">
          <text fg={colors.text}>Password (optional)</text>
          <input
            backgroundColor={focusedField === 1 ? colors.surface : undefined}
            focused={focusedField === 1}
            onChange={setPassword}
            placeholder="Leave empty for no password"
            value={password}
            width={40}
          />
        </box>

        {/* Error message */}
        {error && <text fg={colors.error}>Error: {error}</text>}

        {/* Loading state */}
        {createRoom.isPending && (
          <text fg={colors.muted}>Creating room...</text>
        )}

        {/* Instructions */}
        <box paddingTop={1}>
          <text fg={colors.muted}>
            Press Tab to switch fields, Enter to create
          </text>
        </box>
      </box>

      <Footer
        canGoBack={canGoBack}
        shortcuts={[
          { key: "Tab", description: "Next field" },
          { key: "Enter", description: "Create" },
        ]}
      />
    </box>
  );
}
