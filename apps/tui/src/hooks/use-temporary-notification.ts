import { useCallback, useEffect, useRef, useState } from "react";

interface UseTemporaryNotificationOptions {
  duration?: number;
}

/**
 * Hook for managing temporary notifications that auto-hide after a duration.
 * Returns [notification, show, hide] tuple.
 */
export function useTemporaryNotification<T>(
  options: UseTemporaryNotificationOptions = {}
) {
  const { duration = 3000 } = options;
  const [notification, setNotification] = useState<T | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearExistingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const show = useCallback(
    (value: T) => {
      clearExistingTimeout();
      setNotification(value);

      timeoutRef.current = setTimeout(() => {
        setNotification(null);
        timeoutRef.current = null;
      }, duration);
    },
    [duration, clearExistingTimeout]
  );

  const hide = useCallback(() => {
    clearExistingTimeout();
    setNotification(null);
  }, [clearExistingTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    return clearExistingTimeout;
  }, [clearExistingTimeout]);

  return [notification, show, hide] as const;
}
