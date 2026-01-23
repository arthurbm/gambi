import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { Footer } from "../components/footer";
import { useHubServer } from "../hooks/use-hub-server";
import { colors } from "../types";

interface ServeHubProps {
  onBack: () => void;
  canGoBack: boolean;
}

export function ServeHub({ onBack, canGoBack }: ServeHubProps) {
  const { running, url, mdnsName, error, start, stop } = useHubServer();
  const [port, setPort] = useState("3000");
  const [hostname, setHostname] = useState("0.0.0.0");
  const [enableMdns, setEnableMdns] = useState(false);
  const [focusedField, setFocusedField] = useState(0);

  useKeyboard(
    (key) => {
      if (key.name === "escape") {
        onBack();
        return;
      }

      if (key.name === "return") {
        if (running) {
          stop();
        } else {
          start({
            port: Number.parseInt(port, 10) || 3000,
            hostname,
            mdns: enableMdns,
          });
        }
        return;
      }

      if (!running) {
        if (key.name === "tab") {
          setFocusedField((i) => (i + 1) % 3);
        } else if (key.name === "m" && focusedField === 2) {
          setEnableMdns((v) => !v);
        }
      }
    },
    { release: false }
  );

  return (
    <box flexDirection="column" flexGrow={1}>
      <box padding={1}>
        <text fg={colors.primary}>Serve Hub</text>
      </box>

      <box flexDirection="column" flexGrow={1} padding={2} gap={2}>
        {/* Status */}
        <box>
          <text>
            <span fg={colors.muted}>Status: </span>
            {running ? (
              <span fg={colors.success}>● Running</span>
            ) : (
              <span fg={colors.muted}>○ Stopped</span>
            )}
          </text>
        </box>

        {running ? (
          <>
            {/* Running info */}
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

            {/* Warning */}
            <box paddingTop={2}>
              <text fg={colors.warning}>
                ⚠ Hub will stop when you leave this screen
              </text>
            </box>
          </>
        ) : (
          <>
            {/* Configuration fields */}
            <box flexDirection="column">
              <text fg={colors.text}>Port</text>
              <input
                value={port}
                onChange={setPort}
                placeholder="3000"
                focused={focusedField === 0}
                width={10}
                backgroundColor={focusedField === 0 ? colors.surface : undefined}
              />
            </box>

            <box flexDirection="column">
              <text fg={colors.text}>Hostname</text>
              <input
                value={hostname}
                onChange={setHostname}
                placeholder="0.0.0.0"
                focused={focusedField === 1}
                width={20}
                backgroundColor={focusedField === 1 ? colors.surface : undefined}
              />
            </box>

            <box>
              <text>
                <span fg={focusedField === 2 ? colors.primary : colors.muted}>
                  [{enableMdns ? "x" : " "}] Enable mDNS discovery
                </span>
                {focusedField === 2 && (
                  <span fg={colors.muted}> (press m to toggle)</span>
                )}
              </text>
            </box>
          </>
        )}

        {/* Error */}
        {error && (
          <text fg={colors.error}>Error: {error}</text>
        )}
      </box>

      <Footer
        canGoBack={canGoBack}
        shortcuts={
          running
            ? [{ key: "Enter", description: "Stop" }]
            : [
                { key: "Tab", description: "Next field" },
                { key: "Enter", description: "Start" },
              ]
        }
      />
    </box>
  );
}
