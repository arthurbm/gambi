import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { colors } from "../types";

export interface TableColumn<T> {
  key: keyof T | string;
  header: string;
  width?: number;
  render?: (item: T, index: number) => string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  selectedIndex?: number;
  onSelect?: (item: T, index: number) => void;
  onChange?: (item: T, index: number) => void;
  onAction?: (key: string, item: T, index: number) => void;
  focused?: boolean;
  emptyMessage?: string;
  maxHeight?: number;
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  selectedIndex: controlledIndex,
  onSelect,
  onChange,
  onAction,
  focused = true,
  emptyMessage = "No data",
  maxHeight,
}: TableProps<T>) {
  const [internalIndex, setInternalIndex] = useState(0);
  const selectedIndex = controlledIndex ?? internalIndex;

  useKeyboard(
    (key) => {
      if (!focused || data.length === 0) return;

      if (key.name === "up" || key.name === "k") {
        const newIndex = selectedIndex > 0 ? selectedIndex - 1 : data.length - 1;
        setInternalIndex(newIndex);
        const item = data[newIndex];
        if (item && onChange) onChange(item, newIndex);
      } else if (key.name === "down" || key.name === "j") {
        const newIndex = selectedIndex < data.length - 1 ? selectedIndex + 1 : 0;
        setInternalIndex(newIndex);
        const item = data[newIndex];
        if (item && onChange) onChange(item, newIndex);
      } else if (key.name === "return") {
        const item = data[selectedIndex];
        if (item && onSelect) onSelect(item, selectedIndex);
      } else if (onAction) {
        const item = data[selectedIndex];
        if (item) onAction(key.name, item, selectedIndex);
      }
    },
    { release: false }
  );

  const getCellValue = (item: T, column: TableColumn<T>, index: number): string => {
    if (column.render) {
      return column.render(item, index);
    }
    const value = item[column.key as keyof T];
    if (value === undefined || value === null) return "";
    return String(value);
  };

  const formatCell = (value: string, width?: number): string => {
    if (!width) return value;
    if (value.length > width) {
      return `${value.slice(0, width - 1)}…`;
    }
    return value.padEnd(width);
  };

  if (data.length === 0) {
    return (
      <box
        alignItems="center"
        borderStyle="single"
        flexGrow={1}
        justifyContent="center"
      >
        <text fg={colors.muted}>{emptyMessage}</text>
      </box>
    );
  }

  return (
    <box borderStyle="single" flexDirection="column" flexGrow={1}>
      {/* Header */}
      <box paddingLeft={1} paddingRight={1}>
        <text>
          {columns.map((col, i) => (
            <span key={col.key.toString()}>
              {i > 0 && " │ "}
              <span fg={colors.primary}>
                {formatCell(col.header, col.width)}
              </span>
            </span>
          ))}
        </text>
      </box>

      {/* Separator */}
      <box paddingLeft={1} paddingRight={1}>
        <text fg={colors.muted}>
          {columns.map((col, i) => {
            const width = col.width ?? col.header.length;
            return (i > 0 ? "─┼─" : "") + "─".repeat(width);
          }).join("")}
        </text>
      </box>

      {/* Rows */}
      <scrollbox focused={focused} flexGrow={1}>
        {data.map((item, rowIndex) => {
          const isSelected = rowIndex === selectedIndex;
          return (
            <box
              key={rowIndex}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={isSelected ? colors.surface : undefined}
            >
              <text>
                {columns.map((col, colIndex) => (
                  <span key={col.key.toString()}>
                    {colIndex > 0 && " │ "}
                    <span fg={isSelected ? colors.text : colors.muted}>
                      {formatCell(getCellValue(item, col, rowIndex), col.width)}
                    </span>
                  </span>
                ))}
              </text>
            </box>
          );
        })}
      </scrollbox>
    </box>
  );
}
