import type { RuntimeConfig } from "@gambi/core/types";
import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Footer } from "../components/footer";
import { useCreateRoom } from "../hooks/queries";
import type { Screen } from "../hooks/use-navigation";
import { useAppStore } from "../store/app-store";
import { colors } from "../types";

interface CreateRoomProps {
  onNavigate: (screen: Screen, params: Record<string, unknown>) => void;
  onBack: () => void;
  canGoBack: boolean;
}

type Step = "form" | "success";

/**
 * Copy text to clipboard using system clipboard.
 * Returns true if successful, false otherwise.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Try using pbcopy (macOS), xclip (Linux), or clip.exe (Windows)
    const proc = Bun.spawn([
      "sh",
      "-c",
      `echo -n "${text}" | pbcopy 2>/dev/null || echo -n "${text}" | xclip -selection clipboard 2>/dev/null || echo -n "${text}" | clip.exe 2>/dev/null`,
    ]);
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

function buildRuntimeConfig(options: {
  instructions: string;
  maxTokens: string;
  temperature: string;
}): { config: RuntimeConfig; error: string | null } {
  const config: RuntimeConfig = {};

  const instructions = options.instructions.trim();
  if (instructions) {
    config.instructions = instructions;
  }

  const temperature = options.temperature.trim();
  if (temperature) {
    const parsedTemperature = Number(temperature);
    if (Number.isNaN(parsedTemperature)) {
      return { config: {}, error: "Temperature must be a number" };
    }
    config.temperature = parsedTemperature;
  }

  const maxTokens = options.maxTokens.trim();
  if (maxTokens) {
    const parsedMaxTokens = Number(maxTokens);
    if (Number.isNaN(parsedMaxTokens)) {
      return { config: {}, error: "Max tokens must be a number" };
    }
    config.max_tokens = parsedMaxTokens;
  }

  return { config, error: null };
}

export function CreateRoom({ onNavigate, onBack, canGoBack }: CreateRoomProps) {
  const createRoom = useCreateRoom();
  const addRoom = useAppStore((s) => s.addRoom);

  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [instructions, setInstructions] = useState("");
  const [temperature, setTemperature] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [focusedField, setFocusedField] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [createdRoom, setCreatedRoom] = useState<{
    code: string;
    name: string;
  } | null>(null);

  // Success screen state
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear copied state after 2 seconds
  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async (code: string) => {
    const success = await copyToClipboard(code);
    if (success) {
      setCopied(true);
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
      copiedTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (!name.trim()) {
      setValidationError("Name is required");
      return;
    }

    const runtimeConfig = buildRuntimeConfig({
      instructions,
      maxTokens,
      temperature,
    });
    if (runtimeConfig.error) {
      setValidationError(runtimeConfig.error);
      return;
    }

    setValidationError(null);

    createRoom.mutate(
      {
        defaults:
          Object.keys(runtimeConfig.config).length > 0
            ? runtimeConfig.config
            : undefined,
        name: name.trim(),
        password: password || undefined,
      },
      {
        onSuccess: (data) => {
          setCreatedRoom({
            code: data.room.code,
            name: data.room.name,
          });
          // Add room to active rooms list
          addRoom(data.room.code);
          setStep("success");
        },
      }
    );
  }, [
    addRoom,
    createRoom,
    instructions,
    maxTokens,
    name,
    password,
    temperature,
  ]);

  const handleSuccessKey = useCallback(
    (keyName: string) => {
      if (!createdRoom) {
        return false;
      }
      switch (keyName) {
        case "m":
          onNavigate("monitor", { roomCodes: [createdRoom.code] });
          return true;
        case "j":
          onNavigate("join", { roomCode: createdRoom.code });
          return true;
        case "s":
          setShowSharePanel((prev) => !prev);
          return true;
        case "c":
          handleCopy(createdRoom.code);
          return true;
        case "escape":
          onBack();
          return true;
        default:
          return false;
      }
    },
    [createdRoom, onNavigate, onBack, handleCopy]
  );

  const handleFormKey = useCallback(
    (keyName: string) => {
      switch (keyName) {
        case "escape":
          onBack();
          break;
        case "tab":
          setFocusedField((i) => (i + 1) % 5);
          break;
        case "return":
          handleSubmit();
          break;
        default:
          break;
      }
    },
    [onBack, handleSubmit]
  );

  useKeyboard(
    (key) => {
      if (step === "success") {
        handleSuccessKey(key.name);
      } else {
        handleFormKey(key.name);
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
        {/* Header */}
        <box padding={1}>
          <text fg={colors.success}>✓ Room Created</text>
        </box>

        {/* Main content */}
        <box flexDirection="column" flexGrow={1} gap={2} padding={2}>
          {/* Room code - large and prominent */}
          <box
            alignItems="center"
            border
            borderColor={colors.primary}
            borderStyle="rounded"
            flexDirection="column"
            gap={1}
            padding={2}
          >
            <text fg={colors.muted}>ROOM CODE</text>
            <text fg={colors.primary}>
              {"  "}
              {createdRoom.code}
              {"  "}
            </text>
            <text fg={colors.muted}>{createdRoom.name}</text>
            {copied && <text fg={colors.success}>✓ Copied!</text>}
          </box>

          {/* Share instructions panel (collapsible) */}
          {showSharePanel && (
            <box
              border
              borderColor={colors.muted}
              borderStyle="single"
              flexDirection="column"
              gap={1}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={colors.text}>Share Instructions</text>
              <text fg={colors.muted}>
                To join this room, participants need to run:
              </text>
              <box backgroundColor={colors.surface} paddingLeft={1}>
                <text fg={colors.accent}>
                  gambi join {createdRoom.code} --endpoint {"<"}llm-url{">"}{" "}
                  --model {"<"}model{">"}
                </text>
              </box>
              <text fg={colors.muted}>Press [s] to hide</text>
            </box>
          )}

          {/* Next Steps section */}
          <box flexDirection="column" gap={1}>
            <text fg={colors.text}>Next Steps</text>

            {/* Option 1: Copy */}
            <box>
              <text>
                <span fg={colors.accent}>[c]</span>
                <span fg={colors.text}> Copy code</span>
                <span fg={colors.muted}> - Copy to clipboard</span>
              </text>
            </box>

            {/* Option 2: Share */}
            <box>
              <text>
                <span fg={colors.accent}>[s]</span>
                <span fg={colors.text}>
                  {" "}
                  {showSharePanel ? "Hide" : "Share"} instructions
                </span>
                <span fg={colors.muted}> - CLI command for others</span>
              </text>
            </box>

            {/* Option 3: Join */}
            <box>
              <text>
                <span fg={colors.accent}>[j]</span>
                <span fg={colors.text}> Join as participant</span>
                <span fg={colors.muted}> - Share your LLM</span>
              </text>
            </box>

            {/* Option 4: Monitor */}
            <box>
              <text>
                <span fg={colors.accent}>[m]</span>
                <span fg={colors.text}> Go to monitor</span>
                <span fg={colors.muted}> - Watch room activity</span>
              </text>
            </box>
          </box>
        </box>

        <Footer
          canGoBack={canGoBack}
          shortcuts={[
            { key: "c", description: "Copy" },
            { key: "s", description: showSharePanel ? "Hide" : "Share" },
            { key: "j", description: "Join" },
            { key: "m", description: "Monitor" },
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

        <box flexDirection="column">
          <text fg={colors.text}>Room instructions / system prompt</text>
          <input
            backgroundColor={focusedField === 2 ? colors.surface : undefined}
            focused={focusedField === 2}
            onChange={setInstructions}
            placeholder="Optional room-wide default instructions"
            value={instructions}
            width={60}
          />
        </box>

        <box flexDirection="row" gap={2}>
          <box flexDirection="column">
            <text fg={colors.text}>Temperature</text>
            <input
              backgroundColor={focusedField === 3 ? colors.surface : undefined}
              focused={focusedField === 3}
              onChange={setTemperature}
              placeholder="Optional"
              value={temperature}
              width={16}
            />
          </box>

          <box flexDirection="column">
            <text fg={colors.text}>Max tokens</text>
            <input
              backgroundColor={focusedField === 4 ? colors.surface : undefined}
              focused={focusedField === 4}
              onChange={setMaxTokens}
              placeholder="Optional"
              value={maxTokens}
              width={16}
            />
          </box>
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
