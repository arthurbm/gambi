import { useKeyboard, useRenderer } from "@opentui/react";
import { useCallback, useEffect, useState } from "react";
import { AddRoomModal } from "./components/add-room-modal";
import { ConfirmModal } from "./components/confirm-modal";
import { Footer } from "./components/footer";
import { HealthNotification } from "./components/health-notification";
import { Sidebar } from "./components/sidebar";
import { useHubHealthQuery } from "./hooks/queries";
import { useNavigation } from "./hooks/use-navigation";
import { useParticipantSession } from "./hooks/use-participant-session";
import { useRooms } from "./hooks/use-rooms";
import { CreateRoom } from "./screens/create-room";
import { JoinRoom } from "./screens/join-room";
import { ListRooms } from "./screens/list-rooms";
import { MainMenu } from "./screens/main-menu";
import { Monitor } from "./screens/monitor";
import { ServeHub } from "./screens/serve-hub";
import { useAppStore } from "./store/app-store";
import { shutdownHub, useHubStore } from "./store/hub-store";

interface AppProps {
  hubUrl: string;
}

// Layout wrapper that includes sidebar and notifications
function WithSidebar({ children }: { children: React.ReactNode }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <HealthNotification />
      <box flexDirection="row" flexGrow={1}>
        <Sidebar />
        <box flexDirection="column" flexGrow={1}>
          {children}
        </box>
      </box>
    </box>
  );
}

type ConfirmAction = "quit" | "leave" | null;

export function App({ hubUrl: initialHubUrl }: AppProps) {
  const renderer = useRenderer();
  const setHubUrl = useAppStore((s) => s.setHubUrl);
  const hubStatus = useHubStore((s) => s.status);
  const session = useParticipantSession();

  // Confirmation modal state
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmAction>(null);

  // Initialize store with prop value
  useEffect(() => {
    setHubUrl(initialHubUrl);
  }, [initialHubUrl, setHubUrl]);

  // Run periodic health checks on the local hub
  useHubHealthQuery();

  const { screen, params, navigate, goBack, canGoBack } = useNavigation({
    initialScreen: "menu",
  });

  const {
    rooms,
    activeRoom,
    setActiveRoom,
    addRoom,
    removeRoom,
    allConnected,
  } = useRooms();

  // Check if confirmation is needed before quitting
  const needsQuitConfirmation =
    hubStatus === "running" || session.status === "joined";

  const doQuit = useCallback(() => {
    shutdownHub();
    renderer.destroy();
  }, [renderer]);

  const handleQuit = useCallback(() => {
    if (needsQuitConfirmation) {
      setPendingConfirm("quit");
    } else {
      doQuit();
    }
  }, [needsQuitConfirmation, doQuit]);

  const handleConfirm = useCallback(() => {
    if (pendingConfirm === "quit") {
      doQuit();
    } else if (pendingConfirm === "leave") {
      session.leave();
    }
    setPendingConfirm(null);
  }, [pendingConfirm, doQuit, session]);

  const handleCancelConfirm = useCallback(() => {
    setPendingConfirm(null);
  }, []);

  // Screens with text inputs that should NOT receive global shortcuts
  const screensWithInputs = ["create", "join", "addRoom"];
  const hasActiveInput = screensWithInputs.includes(screen);

  // Global keyboard shortcuts for navigation
  useKeyboard(
    (key) => {
      // Don't capture shortcuts when modal is showing or on screens with inputs
      if (pendingConfirm || hasActiveInput) {
        return;
      }

      // Global quit
      if (key.name === "q") {
        handleQuit();
        return;
      }

      // Global navigation shortcuts (h/c/j/m)
      // Only navigate if not already on that screen
      if (key.name === "h" && screen !== "serve") {
        navigate("serve", {});
        return;
      }
      if (key.name === "c" && screen !== "create") {
        navigate("create", {});
        return;
      }
      if (key.name === "j" && screen !== "join") {
        navigate("join", {});
        return;
      }
      if (key.name === "m" && screen !== "monitor") {
        navigate("monitor", {});
        return;
      }
      if (key.name === "l" && screen !== "list") {
        navigate("list", {});
        return;
      }
    },
    { release: false }
  );

  // Confirmation Modal
  if (pendingConfirm === "quit") {
    const reasons: string[] = [];
    if (hubStatus === "running") {
      reasons.push("Hub is running");
    }
    if (session.status === "joined") {
      reasons.push("You are joined in a room");
    }
    return (
      <WithSidebar>
        <ConfirmModal
          message={`${reasons.join(" and ")}. Are you sure you want to quit?`}
          onCancel={handleCancelConfirm}
          onConfirm={handleConfirm}
          title="Confirm Quit"
        />
      </WithSidebar>
    );
  }

  if (pendingConfirm === "leave") {
    return (
      <WithSidebar>
        <ConfirmModal
          message="Are you sure you want to leave the room?"
          onCancel={handleCancelConfirm}
          onConfirm={handleConfirm}
          title="Confirm Leave"
        />
      </WithSidebar>
    );
  }

  // Screen: Menu Principal
  if (screen === "menu") {
    return (
      <WithSidebar>
        <MainMenu onNavigate={navigate} onQuit={handleQuit} />
      </WithSidebar>
    );
  }

  // Screen: Serve Hub
  if (screen === "serve") {
    return (
      <WithSidebar>
        <ServeHub canGoBack={canGoBack()} onBack={goBack} />
      </WithSidebar>
    );
  }

  // Screen: Create Room
  if (screen === "create") {
    return (
      <WithSidebar>
        <CreateRoom
          canGoBack={canGoBack()}
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
      </WithSidebar>
    );
  }

  // Screen: List Rooms
  if (screen === "list") {
    return (
      <WithSidebar>
        <ListRooms
          canGoBack={canGoBack()}
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
      </WithSidebar>
    );
  }

  // Screen: Join Room
  if (screen === "join") {
    return (
      <WithSidebar>
        <JoinRoom
          canGoBack={canGoBack()}
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
      </WithSidebar>
    );
  }

  // Screen: Add Room Modal (no sidebar - it's a modal overlay)
  if (screen === "addRoom") {
    return (
      <AddRoomModal
        onAdd={(code) => {
          addRoom(code);
          navigate("monitor", { roomCodes: [code] });
        }}
        onCancel={() => goBack()}
      />
    );
  }

  // Screen: Monitor (Dashboard)
  if (screen === "monitor") {
    return (
      <WithSidebar>
        <Monitor
          activeRoom={activeRoom}
          allConnected={allConnected}
          canGoBack={canGoBack()}
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
      </WithSidebar>
    );
  }

  // Fallback: Telas não implementadas
  return (
    <WithSidebar>
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
    </WithSidebar>
  );
}
