import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useState } from "react";
import { AddRoomModal } from "./components/add-room-modal";
import { Footer } from "./components/footer";
import { useNavigation } from "./hooks/use-navigation";
import { useRooms } from "./hooks/use-rooms";
import { CreateRoom } from "./screens/create-room";
import { JoinRoom } from "./screens/join-room";
import { ListRooms } from "./screens/list-rooms";
import { MainMenu } from "./screens/main-menu";
import { Monitor } from "./screens/monitor";
import { ServeHub } from "./screens/serve-hub";

interface AppProps {
  hubUrl: string;
}

export function App({ hubUrl: initialHubUrl }: AppProps) {
  const renderer = useRenderer();
  const [hubUrl, setHubUrl] = useState(initialHubUrl);
  const { screen, params, navigate, goBack, canGoBack } = useNavigation({
    initialScreen: "menu",
    initialParams: { hubUrl },
  });

  const {
    rooms,
    activeRoom,
    setActiveRoom,
    addRoom,
    removeRoom,
    allConnected,
  } = useRooms({ hubUrl });

  const handleQuit = useCallback(() => {
    renderer.destroy();
  }, [renderer]);

  // Global keyboard handlers (only for screens that don't handle their own keyboard)
  useKeyboard(
    (key) => {
      // These screens handle their own keyboard
      if (
        ["menu", "serve", "create", "list", "join", "monitor"].includes(screen)
      ) {
        return;
      }

      // Global quit
      if (key.name === "q" && screen !== "addRoom") {
        handleQuit();
        return;
      }
    },
    { release: false }
  );

  // Screen: Menu Principal
  if (screen === "menu") {
    return (
      <MainMenu
        hubUrl={hubUrl}
        onHubUrlChange={setHubUrl}
        onNavigate={navigate}
        onQuit={handleQuit}
      />
    );
  }

  // Screen: Serve Hub
  if (screen === "serve") {
    return <ServeHub canGoBack={canGoBack()} onBack={goBack} />;
  }

  // Screen: Create Room
  if (screen === "create") {
    return (
      <CreateRoom
        canGoBack={canGoBack()}
        hubUrl={hubUrl}
        onBack={goBack}
        onNavigate={(s, p) => {
          if (p.roomCodes) {
            for (const code of p.roomCodes as string[]) {
              addRoom(code);
            }
          }
          navigate(s, p as Record<string, unknown>);
        }}
      />
    );
  }

  // Screen: List Rooms
  if (screen === "list") {
    return (
      <ListRooms
        canGoBack={canGoBack()}
        hubUrl={hubUrl}
        onBack={goBack}
        onNavigate={(s, p) => {
          if (p.roomCodes) {
            for (const code of p.roomCodes as string[]) {
              addRoom(code);
            }
          }
          navigate(s, p as Record<string, unknown>);
        }}
      />
    );
  }

  // Screen: Join Room
  if (screen === "join") {
    return (
      <JoinRoom
        canGoBack={canGoBack()}
        hubUrl={hubUrl}
        onBack={goBack}
        onNavigate={(s, p) => {
          if (p.roomCodes) {
            for (const code of p.roomCodes as string[]) {
              addRoom(code);
            }
          }
          navigate(s, p as Record<string, unknown>);
        }}
        roomCode={params.roomCode as string | undefined}
      />
    );
  }

  // Screen: Add Room Modal
  if (screen === "addRoom") {
    return (
      <AddRoomModal
        hubUrl={hubUrl}
        onAdd={(code) => {
          addRoom(code);
          navigate("monitor", { hubUrl, roomCodes: [code] });
        }}
        onCancel={() => goBack()}
      />
    );
  }

  // Screen: Monitor (Dashboard)
  if (screen === "monitor") {
    return (
      <Monitor
        activeRoom={activeRoom}
        allConnected={allConnected}
        canGoBack={canGoBack()}
        hubUrl={hubUrl}
        onAddRoom={addRoom}
        onBack={goBack}
        onNavigate={(s, p) => {
          if (p.roomCodes) {
            for (const code of p.roomCodes as string[]) {
              addRoom(code);
            }
          }
          navigate(s, p as Record<string, unknown>);
        }}
        onRemoveRoom={removeRoom}
        onSetActiveRoom={setActiveRoom}
        rooms={rooms}
      />
    );
  }

  // Fallback: Telas não implementadas
  return (
    <box
      alignItems="center"
      borderStyle="single"
      flexDirection="column"
      flexGrow={1}
      justifyContent="center"
    >
      <text>Screen not implemented: {screen}</text>
      <text>Press ESC to go back or q to quit</text>
      <Footer canGoBack={canGoBack()} />
    </box>
  );
}
