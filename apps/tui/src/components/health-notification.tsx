import { useEffect, useRef } from "react";
import { useTemporaryNotification } from "../hooks/use-temporary-notification";
import { type HealthStatus, useSessionStore } from "../store/session-store";
import { colors } from "../types";

interface NotificationConfig {
  icon: string;
  message: string;
  bgColor: string;
  fgColor: string;
}

const NOTIFICATION_CONFIGS: Record<
  Exclude<HealthStatus, "healthy">,
  NotificationConfig
> = {
  degraded: {
    icon: "⚠",
    message: "Connection degraded",
    bgColor: colors.warning,
    fgColor: "#000000",
  },
  unhealthy: {
    icon: "✗",
    message: "Connection lost",
    bgColor: colors.error,
    fgColor: "#FFFFFF",
  },
};

export function HealthNotification() {
  const healthStatus = useSessionStore((s) => s.healthStatus);
  const sessionStatus = useSessionStore((s) => s.status);
  const prevHealthRef = useRef<HealthStatus>("healthy");
  const [notification, show, hide] =
    useTemporaryNotification<NotificationConfig>();

  useEffect(() => {
    // Only show notifications when joined as participant
    if (sessionStatus !== "joined") {
      prevHealthRef.current = "healthy";
      return;
    }

    const prevHealth = prevHealthRef.current;
    prevHealthRef.current = healthStatus;

    // Show notification when health degrades from healthy
    if (prevHealth === "healthy" && healthStatus !== "healthy") {
      show(NOTIFICATION_CONFIGS[healthStatus]);
    }

    // Hide notification when health improves to healthy
    if (healthStatus === "healthy" && notification) {
      hide();
    }
  }, [healthStatus, sessionStatus, notification, show, hide]);

  if (!notification) {
    return null;
  }

  return (
    <box
      backgroundColor={notification.bgColor}
      justifyContent="center"
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={notification.fgColor}>
        {notification.icon} {notification.message}
      </text>
    </box>
  );
}
