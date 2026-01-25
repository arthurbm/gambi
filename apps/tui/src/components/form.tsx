import { useKeyboard } from "@opentui/react";
import { useState } from "react";

// Hook for form field focus management
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
