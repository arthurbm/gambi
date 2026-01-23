import { useKeyboard } from "@opentui/react";
import { type ReactNode, useState } from "react";

interface FormProps {
  children: ReactNode;
  fieldCount: number;
  onSubmit: () => void;
  onCancel?: () => void;
}

export function Form({ children, fieldCount, onSubmit, onCancel }: FormProps) {
  const [_focusedIndex, setFocusedIndex] = useState(0);

  useKeyboard(
    (key) => {
      if (key.name === "tab" || key.name === "down") {
        setFocusedIndex((i) => (i + 1) % fieldCount);
      } else if (key.name === "up" && key.shift) {
        setFocusedIndex((i) => (i - 1 + fieldCount) % fieldCount);
      } else if (key.name === "return") {
        onSubmit();
      } else if (key.name === "escape" && onCancel) {
        onCancel();
      }
    },
    { release: false }
  );

  return (
    <box flexDirection="column" gap={1}>
      {children}
    </box>
  );
}

// Export a hook for form field focus
export function useFormFocus(totalFields: number) {
  const [focusedIndex, setFocusedIndex] = useState(0);

  useKeyboard(
    (key) => {
      if (key.name === "tab") {
        if (key.shift) {
          setFocusedIndex((i) => (i - 1 + totalFields) % totalFields);
        } else {
          setFocusedIndex((i) => (i + 1) % totalFields);
        }
      }
    },
    { release: false }
  );

  return {
    focusedIndex,
    setFocusedIndex,
    isFocused: (index: number) => focusedIndex === index,
  };
}
