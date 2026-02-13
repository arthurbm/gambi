import { colors } from "../types";

export interface Shortcut {
  key: string;
  description: string;
  primary?: boolean;
}

export interface GlobalState {
  hubRunning: boolean;
  hasRooms: boolean;
  isParticipant: boolean;
}

interface FooterProps {
  shortcuts?: Shortcut[];
  canGoBack?: boolean;
  globalState?: GlobalState;
  showGlobalShortcuts?: boolean;
}

/**
 * Get the primary action based on current state.
 * Rules: no hub→'h', hub without rooms→'c', rooms without join→'j', joined→'m'
 */
export function getPrimaryAction(state: GlobalState): "h" | "c" | "j" | "m" {
  if (!state.hubRunning) {
    return "h";
  }
  if (!state.hasRooms) {
    return "c";
  }
  if (!state.isParticipant) {
    return "j";
  }
  return "m";
}

/**
 * Get contextual shortcuts based on global state.
 * Primary action appears first in the list.
 */
export function getContextualShortcuts(state: GlobalState): Shortcut[] {
  const primaryAction = getPrimaryAction(state);

  const shortcuts: Shortcut[] = [
    {
      key: "h",
      description: primaryAction === "h" ? "Start Hub" : "Hub",
      primary: primaryAction === "h",
    },
    {
      key: "c",
      description: primaryAction === "c" ? "Create Room" : "Create",
      primary: primaryAction === "c",
    },
    {
      key: "j",
      description: primaryAction === "j" ? "Join Room" : "Join",
      primary: primaryAction === "j",
    },
    {
      key: "m",
      description: "Monitor",
      primary: primaryAction === "m",
    },
  ];

  // Sort so primary action comes first
  return shortcuts.sort((a, b) => {
    if (a.primary && !b.primary) {
      return -1;
    }
    if (!a.primary && b.primary) {
      return 1;
    }
    return 0;
  });
}

export function Footer({
  shortcuts = [],
  canGoBack = false,
  globalState,
  showGlobalShortcuts = false,
}: FooterProps) {
  // Build the shortcuts list
  const contextualShortcuts =
    showGlobalShortcuts && globalState
      ? getContextualShortcuts(globalState)
      : [];

  const allShortcuts: Shortcut[] = [
    ...(canGoBack ? [{ key: "Esc", description: "Back" }] : []),
    ...shortcuts,
    ...contextualShortcuts,
    { key: "q", description: "Quit" },
  ];

  return (
    <box borderStyle="single" paddingLeft={1} paddingRight={1}>
      <text>
        {allShortcuts.map((shortcut, index) => (
          <span key={shortcut.key}>
            {index > 0 && "  "}
            <span fg={shortcut.primary ? colors.accent : colors.primary}>
              {shortcut.key}
            </span>
            <span fg={shortcut.primary ? colors.text : colors.muted}>
              {" "}
              {shortcut.description}
            </span>
          </span>
        ))}
      </text>
    </box>
  );
}
