import { useKeyboard } from "@opentui/react";
import { useCallback, useState } from "react";
import { Footer } from "../components/footer";
import { useHubApi } from "../hooks/use-hub-api";
import type { Screen } from "../hooks/use-navigation";
import { colors } from "../types";

interface CreateRoomProps {
  hubUrl: string;
  onNavigate: (screen: Screen, params: Record<string, unknown>) => void;
  onBack: () => void;
  canGoBack: boolean;
}

type Step = "form" | "success";

export function CreateRoom({
  hubUrl,
  onNavigate,
  onBack,
  canGoBack,
}: CreateRoomProps) {
  const api = useHubApi({ hubUrl });
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [focusedField, setFocusedField] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdRoom, setCreatedRoom] = useState<{ code: string; name: string } | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setLoading(true);
    setError(null);

    const result = await api.createRoom(name.trim(), password || undefined);

    if (result.error) {
      setError(result.error);
      setLoading(false);
    } else if (result.data) {
      setCreatedRoom({
        code: result.data.room.code,
        name: result.data.room.name,
      });
      setStep("success");
      setLoading(false);
    }
  }, [api, name, password]);

  useKeyboard(
    (key) => {
      if (step === "success") {
        if (key.name === "m" && createdRoom) {
          onNavigate("monitor", { hubUrl, roomCodes: [createdRoom.code] });
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

  if (step === "success" && createdRoom) {
    return (
      <box flexDirection="column" flexGrow={1}>
        <box
          alignItems="center"
          flexDirection="column"
          flexGrow={1}
          justifyContent="center"
          gap={2}
        >
          <text fg={colors.success}>✓ Room created successfully!</text>
          <box flexDirection="column" alignItems="center" gap={1}>
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

      <box
        flexDirection="column"
        flexGrow={1}
        padding={2}
        gap={2}
      >
        {/* Name field */}
        <box flexDirection="column">
          <text>
            <span fg={colors.text}>Room Name</span>
            <span fg={colors.error}> *</span>
          </text>
          <input
            value={name}
            onChange={setName}
            placeholder="Enter room name..."
            focused={focusedField === 0}
            width={40}
            backgroundColor={focusedField === 0 ? colors.surface : undefined}
          />
        </box>

        {/* Password field */}
        <box flexDirection="column">
          <text fg={colors.text}>Password (optional)</text>
          <input
            value={password}
            onChange={setPassword}
            placeholder="Leave empty for no password"
            focused={focusedField === 1}
            width={40}
            backgroundColor={focusedField === 1 ? colors.surface : undefined}
          />
        </box>

        {/* Error message */}
        {error && (
          <text fg={colors.error}>Error: {error}</text>
        )}

        {/* Loading state */}
        {loading && (
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
