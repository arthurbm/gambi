import { useKeyboard } from "@opentui/react";
import { colors } from "../types";

interface ConfirmModalProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useKeyboard(
    (key) => {
      if (key.name === "y") {
        onConfirm();
      } else if (key.name === "n" || key.name === "escape") {
        onCancel();
      }
    },
    { release: false }
  );

  return (
    <box
      alignItems="center"
      flexDirection="column"
      flexGrow={1}
      justifyContent="center"
    >
      <box
        borderColor={colors.warning}
        borderStyle="rounded"
        flexDirection="column"
        gap={1}
        paddingBottom={1}
        paddingLeft={3}
        paddingRight={3}
        paddingTop={1}
      >
        <text fg={colors.warning}>{title}</text>
        <text fg={colors.text}>{message}</text>
        <box flexDirection="row" gap={2} justifyContent="center" marginTop={1}>
          <text>
            <span fg={colors.success}>[Y]</span>
            <span fg={colors.text}> Yes</span>
          </text>
          <text>
            <span fg={colors.error}>[N]</span>
            <span fg={colors.text}> No</span>
          </text>
        </box>
      </box>
    </box>
  );
}
