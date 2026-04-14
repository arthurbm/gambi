import type { RoomSummary } from "@gambi/core/types";
import { useKeyboard } from "@opentui/react";
import { useCallback, useState } from "react";
import { Footer } from "../components/footer";
import { Header } from "../components/header";
import { Table, type TableColumn } from "../components/table";
import { useRoomsList } from "../hooks/queries";
import type { Screen } from "../hooks/use-navigation";
import { useAppStore } from "../store/app-store";
import { colors } from "../types";

interface RoomData {
  code: string;
  name: string;
  participantCount: number;
  createdAt: string;
}

interface ListRoomsProps {
  onNavigate: (screen: Screen, params: Record<string, unknown>) => void;
  onBack: () => void;
  canGoBack: boolean;
}

const columns: TableColumn<RoomData>[] = [
  { key: "code", header: "Code", width: 8 },
  { key: "name", header: "Name", width: 20 },
  { key: "participantCount", header: "Users", width: 6 },
  { key: "createdAt", header: "Created", width: 20 },
];

export function ListRooms({ onNavigate, onBack, canGoBack }: ListRoomsProps) {
  const hubUrl = useAppStore((s) => s.hubUrl);
  const { data, isLoading, error, refetch } = useRoomsList();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const rooms: RoomData[] =
    data?.map((room: RoomSummary) => ({
      code: room.code,
      name: room.name,
      participantCount: room.participantCount,
      createdAt: new Date(room.createdAt).toLocaleString(),
    })) ?? [];

  useKeyboard(
    (key) => {
      if (key.name === "r") {
        refetch();
      } else if (key.name === "m" && rooms[selectedIndex]) {
        onNavigate("monitor", {
          roomCodes: [rooms[selectedIndex].code],
        });
      } else if (key.name === "j" && rooms[selectedIndex]) {
        onNavigate("join", { roomCode: rooms[selectedIndex].code });
      } else if (key.name === "escape") {
        onBack();
      }
    },
    { release: false }
  );

  const handleSelect = useCallback(
    (item: RoomData) => {
      onNavigate("monitor", { roomCodes: [item.code] });
    },
    [onNavigate]
  );

  const handleChange = useCallback((_item: RoomData, index: number) => {
    setSelectedIndex(index);
  }, []);

  const errorMessage = error instanceof Error ? error.message : null;

  return (
    <box flexDirection="column" flexGrow={1}>
      <Header
        connected={!errorMessage}
        hubUrl={hubUrl}
        roomCount={rooms.length}
      />

      <box flexDirection="column" flexGrow={1} padding={1}>
        <box paddingBottom={1}>
          <text>
            <span fg={colors.primary}>Available Rooms</span>
            {isLoading && <span fg={colors.muted}> (loading...)</span>}
          </text>
        </box>

        {errorMessage ? (
          <box
            alignItems="center"
            borderStyle="single"
            flexGrow={1}
            justifyContent="center"
          >
            <text fg={colors.error}>Error: {errorMessage}</text>
          </box>
        ) : (
          <Table
            columns={columns}
            data={rooms}
            emptyMessage="No rooms found. Create one first!"
            focused
            onChange={handleChange}
            onSelect={handleSelect}
            selectedIndex={selectedIndex}
          />
        )}
      </box>

      <Footer
        canGoBack={canGoBack}
        shortcuts={[
          { key: "↑↓", description: "Navigate" },
          { key: "Enter", description: "Monitor" },
          { key: "m", description: "Monitor" },
          { key: "j", description: "Join" },
          { key: "r", description: "Refresh" },
        ]}
      />
    </box>
  );
}
