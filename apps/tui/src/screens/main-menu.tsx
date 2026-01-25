import { useKeyboard, useRenderer } from "@opentui/react";
import { useState } from "react";
import { Footer } from "../components/footer";
import type { Screen } from "../hooks/use-navigation";
import { useAppStore } from "../store/app-store";
import { colors } from "../types";

const LOGO = `
 ██████╗  █████╗ ███╗   ███╗██████╗ ██╗ █████╗ ██████╗ ██████╗  █████╗
██╔════╝ ██╔══██╗████╗ ████║██╔══██╗██║██╔══██╗██╔══██╗██╔══██╗██╔══██╗
██║  ███╗███████║██╔████╔██║██████╔╝██║███████║██████╔╝██████╔╝███████║
██║   ██║██╔══██║██║╚██╔╝██║██╔══██╗██║██╔══██║██╔══██╗██╔══██╗██╔══██║
╚██████╔╝██║  ██║██║ ╚═╝ ██║██████╔╝██║██║  ██║██║  ██║██║  ██║██║  ██║
 ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝
`;

interface MenuOption {
  screen: Screen;
  name: string;
  description: string;
}

const menuOptions: MenuOption[] = [
  {
    screen: "serve",
    name: "Serve Hub",
    description: "Start a local hub server",
  },
  { screen: "create", name: "Create Room", description: "Create a new room" },
  { screen: "list", name: "List Rooms", description: "View available rooms" },
  { screen: "join", name: "Join Room", description: "Join as LLM participant" },
  { screen: "monitor", name: "Monitor", description: "Monitor room activity" },
];

interface MainMenuProps {
  onNavigate: (screen: Screen) => void;
  onQuit: () => void;
}

export function MainMenu({ onNavigate, onQuit }: MainMenuProps) {
  const _renderer = useRenderer();
  const hubUrl = useAppStore((s) => s.hubUrl);
  const setHubUrl = useAppStore((s) => s.setHubUrl);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlValue, setUrlValue] = useState(hubUrl);

  const cancelEdit = () => {
    setEditingUrl(false);
    setUrlValue(hubUrl);
  };

  const confirmEdit = () => {
    setEditingUrl(false);
    setHubUrl(urlValue);
  };

  const handleMenuKey = (keyName: string) => {
    const isUp = keyName === "up" || keyName === "k";
    const isDown = keyName === "down" || keyName === "j";

    if (isUp) {
      setSelectedIndex((i) => (i > 0 ? i - 1 : menuOptions.length - 1));
    } else if (isDown) {
      setSelectedIndex((i) => (i < menuOptions.length - 1 ? i + 1 : 0));
    } else if (keyName === "return") {
      const option = menuOptions[selectedIndex];
      if (option) {
        onNavigate(option.screen);
      }
    } else if (keyName === "e") {
      setEditingUrl(true);
    }
  };

  useKeyboard(
    (key) => {
      if (editingUrl) {
        if (key.name === "escape") {
          cancelEdit();
        } else if (key.name === "return") {
          confirmEdit();
        }
        return;
      }
      if (key.name === "q") {
        onQuit();
        return;
      }
      handleMenuKey(key.name);
    },
    { release: false }
  );

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Logo */}
      <box justifyContent="center" paddingTop={1}>
        <text fg={colors.primary}>{LOGO}</text>
      </box>

      {/* Hub URL */}
      <box justifyContent="center" paddingBottom={1}>
        <text>
          <span fg={colors.muted}>Hub: </span>
          {editingUrl ? (
            <input
              backgroundColor={colors.surface}
              focused
              onChange={setUrlValue}
              value={urlValue}
              width={40}
            />
          ) : (
            <span fg={colors.accent}>{hubUrl}</span>
          )}
          {!editingUrl && <span fg={colors.muted}> (press e to edit)</span>}
        </text>
      </box>

      {/* Menu Options */}
      <box
        alignItems="center"
        flexDirection="column"
        flexGrow={1}
        paddingTop={1}
      >
        {menuOptions.map((option, index) => {
          const isSelected = index === selectedIndex;
          return (
            <box key={option.screen} paddingLeft={2} paddingRight={2}>
              <text>
                <span fg={isSelected ? colors.primary : colors.muted}>
                  {isSelected ? "▸ " : "  "}
                </span>
                <span fg={isSelected ? colors.text : colors.muted}>
                  {option.name}
                </span>
                <span fg={colors.muted}> - {option.description}</span>
              </text>
            </box>
          );
        })}
      </box>

      {/* Footer */}
      <Footer
        shortcuts={[
          { key: "↑↓", description: "Navigate" },
          { key: "Enter", description: "Select" },
          { key: "e", description: "Edit URL" },
        ]}
      />
    </box>
  );
}
