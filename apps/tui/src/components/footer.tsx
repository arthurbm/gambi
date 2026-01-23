import { colors } from "../types";

interface FooterProps {
  shortcuts?: Array<{ key: string; description: string }>;
  canGoBack?: boolean;
}

export function Footer({ shortcuts = [], canGoBack = false }: FooterProps) {
  const allShortcuts = [
    ...(canGoBack ? [{ key: "Esc", description: "Back" }] : []),
    ...shortcuts,
    { key: "q", description: "Quit" },
  ];

  return (
    <box borderStyle="single" paddingLeft={1} paddingRight={1}>
      <text>
        {allShortcuts.map((shortcut, index) => (
          <span key={shortcut.key}>
            {index > 0 && "  "}
            <span fg={colors.primary}>{shortcut.key}</span>
            <span fg={colors.muted}> {shortcut.description}</span>
          </span>
        ))}
      </text>
    </box>
  );
}
