import { useKeyboard } from "@opentui/react";
import { useCallback, useState } from "react";
import { Footer } from "../components/footer";
import { formatSpecs, useMachineSpecs } from "../hooks/use-machine-specs";
import type { Screen } from "../hooks/use-navigation";
import { useParticipantSession } from "../hooks/use-participant-session";
import { colors } from "../types";

interface JoinRoomProps {
  hubUrl: string;
  roomCode?: string;
  onNavigate: (screen: Screen, params: Record<string, unknown>) => void;
  onBack: () => void;
  canGoBack: boolean;
}

function generateNickname(): string {
  const chars = "abcdef0123456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `user-${suffix}`;
}

export function JoinRoom({
  hubUrl,
  roomCode: initialRoomCode,
  onNavigate,
  onBack,
  canGoBack,
}: JoinRoomProps) {
  const { specs, loading: specsLoading } = useMachineSpecs();
  const session = useParticipantSession({ hubUrl });

  const [roomCode, setRoomCode] = useState(initialRoomCode ?? "");
  const [endpoint, setEndpoint] = useState("http://localhost:11434");
  const [model, setModel] = useState("");
  const [nickname, setNickname] = useState(generateNickname());
  const [password, setPassword] = useState("");
  const [shareSpecs, setShareSpecs] = useState(true);
  const [focusedField, setFocusedField] = useState(0);

  const totalFields = 6;

  const handleJoin = useCallback(async () => {
    if (!roomCode.trim()) {
      return;
    }
    if (!model.trim()) {
      return;
    }

    await session.join(roomCode.trim(), {
      id: crypto.randomUUID(),
      nickname: nickname.trim() || generateNickname(),
      model: model.trim(),
      endpoint: endpoint.trim(),
      password: password || undefined,
      specs: shareSpecs && specs ? specs : undefined,
    });

    if (session.status === "joined") {
      onNavigate("monitor", { hubUrl, roomCodes: [roomCode] });
    }
  }, [
    roomCode,
    model,
    nickname,
    endpoint,
    password,
    shareSpecs,
    specs,
    session,
    hubUrl,
    onNavigate,
  ]);

  useKeyboard(
    (key) => {
      if (session.status === "joined") {
        if (key.name === "m") {
          onNavigate("monitor", { hubUrl, roomCodes: [roomCode] });
        } else if (key.name === "l") {
          session.leave();
        }
        return;
      }

      if (key.name === "escape") {
        onBack();
        return;
      }

      if (key.name === "tab") {
        setFocusedField((i) => (i + 1) % totalFields);
      } else if (key.name === "return") {
        handleJoin();
      } else if (key.name === "space" && focusedField === 5) {
        setShareSpecs((v) => !v);
      }
    },
    { release: false }
  );

  // Success screen
  if (session.status === "joined") {
    return (
      <box flexDirection="column" flexGrow={1}>
        <box
          alignItems="center"
          flexDirection="column"
          flexGrow={1}
          gap={2}
          justifyContent="center"
        >
          <text fg={colors.success}>✓ Joined room successfully!</text>
          <box alignItems="center" flexDirection="column" gap={1}>
            <text>
              <span fg={colors.muted}>Room: </span>
              <span fg={colors.primary}>{roomCode}</span>
            </text>
            <text>
              <span fg={colors.muted}>As: </span>
              <span fg={colors.text}>{nickname}</span>
            </text>
            <text>
              <span fg={colors.muted}>Model: </span>
              <span fg={colors.accent}>{model}</span>
            </text>
          </box>
          <text fg={colors.muted}>Health checks running in background</text>
        </box>

        <Footer
          canGoBack={canGoBack}
          shortcuts={[
            { key: "m", description: "Go to Monitor" },
            { key: "l", description: "Leave room" },
          ]}
        />
      </box>
    );
  }

  return (
    <box flexDirection="column" flexGrow={1}>
      <box padding={1}>
        <text fg={colors.primary}>Join Room as LLM Participant</text>
      </box>

      <box flexDirection="column" flexGrow={1} gap={1} padding={2}>
        {/* Room Code */}
        <box flexDirection="column">
          <text>
            <span fg={colors.text}>Room Code</span>
            <span fg={colors.error}> *</span>
          </text>
          <input
            backgroundColor={focusedField === 0 ? colors.surface : undefined}
            focused={focusedField === 0}
            onChange={setRoomCode}
            placeholder="ABC123"
            value={roomCode}
            width={10}
          />
        </box>

        {/* LLM Endpoint */}
        <box flexDirection="column">
          <text fg={colors.text}>LLM Endpoint</text>
          <input
            backgroundColor={focusedField === 1 ? colors.surface : undefined}
            focused={focusedField === 1}
            onChange={setEndpoint}
            placeholder="http://localhost:11434"
            value={endpoint}
            width={40}
          />
        </box>

        {/* Model */}
        <box flexDirection="column">
          <text>
            <span fg={colors.text}>Model</span>
            <span fg={colors.error}> *</span>
          </text>
          <input
            backgroundColor={focusedField === 2 ? colors.surface : undefined}
            focused={focusedField === 2}
            onChange={setModel}
            placeholder="llama3, gpt-4, etc."
            value={model}
            width={30}
          />
        </box>

        {/* Nickname */}
        <box flexDirection="column">
          <text fg={colors.text}>Nickname</text>
          <input
            backgroundColor={focusedField === 3 ? colors.surface : undefined}
            focused={focusedField === 3}
            onChange={setNickname}
            placeholder={generateNickname()}
            value={nickname}
            width={20}
          />
        </box>

        {/* Password */}
        <box flexDirection="column">
          <text fg={colors.text}>Password (if required)</text>
          <input
            backgroundColor={focusedField === 4 ? colors.surface : undefined}
            focused={focusedField === 4}
            onChange={setPassword}
            placeholder="Leave empty if no password"
            value={password}
            width={30}
          />
        </box>

        {/* Share specs checkbox */}
        <box>
          <text>
            <span fg={focusedField === 5 ? colors.primary : colors.muted}>
              [{shareSpecs ? "x" : " "}] Share machine specs
            </span>
            {focusedField === 5 && (
              <span fg={colors.muted}> (press space to toggle)</span>
            )}
          </text>
        </box>

        {/* Show specs if enabled */}
        {shareSpecs && specs && (
          <box paddingLeft={2}>
            <text fg={colors.muted}>{formatSpecs(specs)}</text>
          </box>
        )}
        {shareSpecs && specsLoading && (
          <box paddingLeft={2}>
            <text fg={colors.muted}>Detecting specs...</text>
          </box>
        )}

        {/* Error */}
        {session.error && <text fg={colors.error}>Error: {session.error}</text>}

        {/* Loading */}
        {session.status === "joining" && (
          <text fg={colors.muted}>Joining room...</text>
        )}
      </box>

      <Footer
        canGoBack={canGoBack}
        shortcuts={[
          { key: "Tab", description: "Next field" },
          { key: "Enter", description: "Join" },
        ]}
      />
    </box>
  );
}
