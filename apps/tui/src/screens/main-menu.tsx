import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { Footer } from "../components/footer";
import type { Screen } from "../hooks/use-navigation";
import { colors } from "../types";

const LOGO = `
  ██████╗  █████╗ ███╗   ███╗██████╗ ██╗
 ██╔════╝ ██╔══██╗████╗ ████║██╔══██╗██║
 ██║  ███╗███████║██╔████╔██║██████╔╝██║
 ██║   ██║██╔══██║██║╚██╔╝██║██╔══██╗██║
 ╚██████╔╝██║  ██║██║ ╚═╝ ██║██████╔╝██║
  ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚═╝
`;

interface MenuOption {
  key: string;
  screen: Screen;
  name: string;
  description: string;
}

const menuOptions: MenuOption[] = [
  {
    key: "h",
    screen: "serve",
    name: "Hub",
    description: "Start/stop local hub server",
  },
  {
    key: "c",
    screen: "create",
    name: "Create Room",
    description: "Create a new room",
  },
  {
    key: "j",
    screen: "join",
    name: "Join Room",
    description: "Join as LLM participant",
  },
  {
    key: "l",
    screen: "list",
    name: "List Rooms",
    description: "View available rooms",
  },
  {
    key: "m",
    screen: "monitor",
    name: "Monitor",
    description: "Monitor room activity",
  },
];

interface MainMenuProps {
  onNavigate: (screen: Screen) => void;
  onQuit: () => void;
}

export function MainMenu({ onNavigate, onQuit }: MainMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useKeyboard(
    (key) => {
      if (key.name === "q") {
        onQuit();
        return;
      }

      // Quick navigation by key
      const option = menuOptions.find((o) => o.key === key.name);
      if (option) {
        onNavigate(option.screen);
        return;
      }

      // Arrow navigation
      if (key.name === "up" || key.name === "k") {
        setSelectedIndex((i) => (i > 0 ? i - 1 : menuOptions.length - 1));
      } else if (key.name === "down" || key.name === "j") {
        setSelectedIndex((i) => (i < menuOptions.length - 1 ? i + 1 : 0));
      } else if (key.name === "return") {
        const selected = menuOptions[selectedIndex];
        if (selected) {
          onNavigate(selected.screen);
        }
      }
    },
    { release: false }
  );

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Logo */}
      <box justifyContent="center" paddingTop={1}>
        <text fg={colors.primary}>{LOGO}</text>
      </box>

      <box justifyContent="center" paddingBottom={1}>
        <text fg={colors.muted}>Share LLMs on your network</text>
      </box>

      {/* Menu Options */}
      <box flexDirection="column" flexGrow={1} gap={1} padding={1}>
        {menuOptions.map((option, index) => {
          const isSelected = index === selectedIndex;
          return (
            <box key={option.screen}>
              <text>
                <span fg={isSelected ? colors.primary : colors.muted}>
                  {isSelected ? "▸ " : "  "}
                </span>
                <span fg={colors.accent}>[{option.key}]</span>
                <span fg={isSelected ? colors.text : colors.muted}>
                  {" "}
                  {option.name}
                </span>
                <span fg={colors.muted}> - {option.description}</span>
              </text>
            </box>
          );
        })}
      </box>

      {/* Quick tip */}
      <box padding={1}>
        <text fg={colors.muted}>
          Tip: Press the letter key to jump directly, or use ↑↓ and Enter
        </text>
      </box>

      {/* Footer */}
      <Footer
        shortcuts={[
          { key: "↑↓", description: "Navigate" },
          { key: "Enter", description: "Select" },
          { key: "q", description: "Quit" },
        ]}
      />
    </box>
  );
}
