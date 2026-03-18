import { colors } from "../types";

interface HeaderProps {
  hubUrl: string;
  roomCount: number;
  connected: boolean;
}

export function Header({ hubUrl, roomCount, connected }: HeaderProps) {
  const connectionIndicator = connected ? "↑" : "↓";
  const connectionColor = connected ? colors.success : colors.error;

  return (
    <box
      borderStyle="double"
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row">
        <ascii-font font="tiny" text="GAMBI" />
      </box>
      <box flexDirection="row" gap={2}>
        <text fg={colors.muted}>Hub: {hubUrl}</text>
        <text>│</text>
        <text>
          <span fg={colors.primary}>{roomCount}</span>
          <span fg={colors.muted}> rooms</span>
        </text>
        <text>│</text>
        <text fg={connectionColor}>{connectionIndicator}</text>
      </box>
    </box>
  );
}
