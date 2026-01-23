import { colors } from "../types";

interface InputFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: "text" | "password";
  error?: string;
  focused?: boolean;
  width?: number;
}

export function InputField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  type = "text",
  error,
  focused = false,
  width = 30,
}: InputFieldProps) {
  const _displayValue = type === "password" ? "•".repeat(value.length) : value;

  return (
    <box flexDirection="column" gap={0}>
      <box>
        <text>
          <span fg={colors.text}>{label}</span>
          {required && <span fg={colors.error}> *</span>}
        </text>
      </box>
      <input
        backgroundColor={focused ? colors.surface : undefined}
        focused={focused}
        onChange={onChange}
        placeholder={placeholder}
        textColor={colors.text}
        value={value}
        width={width}
      />
      {error && <text fg={colors.error}>{error}</text>}
    </box>
  );
}
