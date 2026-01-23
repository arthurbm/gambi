import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useState } from "react";
import { Footer } from "../components/footer";
import { Header } from "../components/header";
import { Table, type TableColumn } from "../components/table";
import { useHubApi } from "../hooks/use-hub-api";
import type { Screen } from "../hooks/use-navigation";
import { colors } from "../types";

interface RoomData {
  code: string;
  name: string;
  participantCount: number;
  createdAt: string;
}

interface ListRoomsProps {
  hubUrl: string;
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

export function ListRooms({
  hubUrl,
  onNavigate,
  onBack,
  canGoBack,
}: ListRoomsProps) {
  const api = useHubApi({ hubUrl });
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await api.listRooms();
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      setRooms(
        result.data.rooms.map((room) => ({
          code: room.code,
          name: room.name,
          participantCount: room.participantCount ?? 0,
          createdAt: new Date(room.createdAt).toLocaleString(),
        }))
      );
    }
    setLoading(false);
  }, [api]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  useKeyboard(
    (key) => {
      if (key.name === "r") {
        fetchRooms();
      } else if (key.name === "m" && rooms[selectedIndex]) {
        onNavigate("monitor", {
          hubUrl,
          roomCodes: [rooms[selectedIndex].code],
        });
      } else if (key.name === "j" && rooms[selectedIndex]) {
        onNavigate("join", { hubUrl, roomCode: rooms[selectedIndex].code });
      } else if (key.name === "escape") {
        onBack();
      }
    },
    { release: false }
  );

  const handleSelect = useCallback(
    (item: RoomData) => {
      onNavigate("monitor", { hubUrl, roomCodes: [item.code] });
    },
    [hubUrl, onNavigate]
  );

  const handleChange = useCallback((_item: RoomData, index: number) => {
    setSelectedIndex(index);
  }, []);

  return (
    <box flexDirection="column" flexGrow={1}>
      <Header connected={!error} hubUrl={hubUrl} roomCount={rooms.length} />

      <box flexDirection="column" flexGrow={1} padding={1}>
        <box paddingBottom={1}>
          <text>
            <span fg={colors.primary}>Available Rooms</span>
            {loading && <span fg={colors.muted}> (loading...)</span>}
          </text>
        </box>

        {error ? (
          <box
            alignItems="center"
            borderStyle="single"
            flexGrow={1}
            justifyContent="center"
          >
            <text fg={colors.error}>Error: {error}</text>
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
