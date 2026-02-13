import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { Footer } from "../components/footer";
import { useHubServer } from "../hooks/use-hub-server";
import { colors } from "../types";

interface ServeHubProps {
  onBack: () => void;
  canGoBack: boolean;
}

function getShortcuts(isTransitioning: boolean, isRunning: boolean) {
  if (isTransitioning) {
    return [];
  }
  if (isRunning) {
    return [{ key: "Enter", description: "Stop" }];
  }
  return [
    { key: "Tab", description: "Next field" },
    { key: "Enter", description: "Start" },
  ];
}

export function ServeHub({ onBack, canGoBack }: ServeHubProps) {
  const { status, url, mdnsName, error, start, stop, port, hostname, mdns } =
    useHubServer();
  const [localPort, setLocalPort] = useState(String(port));
  const [localHostname, setLocalHostname] = useState(hostname);
  const [localMdns, setLocalMdns] = useState(mdns);
  const [focusedField, setFocusedField] = useState(0);

  const isRunning = status === "running";
  const isTransitioning = status === "starting" || status === "stopping";
  const canEdit = status === "stopped" || status === "error";

  const handleEnter = () => {
    if (isRunning) {
      stop();
    } else if (canEdit) {
      start({
        port: Number.parseInt(localPort, 10) || 3000,
        hostname: localHostname,
        mdns: localMdns,
      });
    }
  };

  const handleEditKey = (keyName: string) => {
    if (keyName === "tab") {
      setFocusedField((i) => (i + 1) % 3);
    } else if (keyName === "m" && focusedField === 2) {
      setLocalMdns((v) => !v);
    }
  };

  useKeyboard(
    (key) => {
      if (key.name === "escape") {
        onBack();
        return;
      }
      if (isTransitioning) {
        return;
      }
      if (key.name === "return") {
        handleEnter();
        return;
      }
      if (canEdit) {
        handleEditKey(key.name);
      }
    },
    { release: false }
  );

  const renderStatusIndicator = () => {
    switch (status) {
      case "running":
        return <span fg={colors.success}>● Running</span>;
      case "starting":
        return <span fg={colors.warning}>◐ Starting...</span>;
      case "stopping":
        return <span fg={colors.warning}>◐ Stopping...</span>;
      case "error":
        return <span fg={colors.error}>✗ Error</span>;
      default:
        return <span fg={colors.muted}>○ Stopped</span>;
    }
  };

  const renderContent = () => {
    if (isRunning) {
      return (
        <>
          <box flexDirection="column" gap={1}>
            <text>
              <span fg={colors.muted}>URL: </span>
              <span fg={colors.accent}>{url}</span>
            </text>
            <text>
              <span fg={colors.muted}>Health: </span>
              <span fg={colors.accent}>{url}/health</span>
            </text>
            {mdnsName && (
              <text>
                <span fg={colors.muted}>mDNS: </span>
                <span fg={colors.accent}>{mdnsName}</span>
              </text>
            )}
          </box>
          <box paddingTop={2}>
            <text fg={colors.success}>
              ✓ Hub persists while navigating. Press Enter to stop.
            </text>
          </box>
        </>
      );
    }

    if (isTransitioning) {
      return (
        <box>
          <text fg={colors.warning}>
            {status === "starting" ? "Starting hub..." : "Stopping hub..."}
          </text>
        </box>
      );
    }

    return (
      <>
        <box flexDirection="column">
          <text fg={colors.text}>Port</text>
          <input
            backgroundColor={focusedField === 0 ? colors.surface : undefined}
            focused={focusedField === 0}
            onChange={setLocalPort}
            placeholder="3000"
            value={localPort}
            width={10}
          />
        </box>

        <box flexDirection="column">
          <text fg={colors.text}>Hostname</text>
          <input
            backgroundColor={focusedField === 1 ? colors.surface : undefined}
            focused={focusedField === 1}
            onChange={setLocalHostname}
            placeholder="0.0.0.0"
            value={localHostname}
            width={20}
          />
        </box>

        <box>
          <text>
            <span fg={focusedField === 2 ? colors.primary : colors.muted}>
              [{localMdns ? "x" : " "}] Enable mDNS discovery
            </span>
            {focusedField === 2 && (
              <span fg={colors.muted}> (press m to toggle)</span>
            )}
          </text>
        </box>
      </>
    );
  };

  return (
    <box flexDirection="column" flexGrow={1}>
      <box padding={1}>
        <text fg={colors.primary}>Serve Hub</text>
      </box>

      <box flexDirection="column" flexGrow={1} gap={2} padding={2}>
        <box>
          <text>
            <span fg={colors.muted}>Status: </span>
            {renderStatusIndicator()}
          </text>
        </box>

        {renderContent()}

        {error && <text fg={colors.error}>Error: {error}</text>}
      </box>

      <Footer
        canGoBack={canGoBack}
        shortcuts={getShortcuts(isTransitioning, isRunning)}
      />
    </box>
  );
}
