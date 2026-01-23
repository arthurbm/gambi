import { useCallback, useState } from "react";

// ============================================================================
// Types
// ============================================================================

// Supported screen types
export type Screen =
  | "menu"
  | "serve"
  | "create"
  | "list"
  | "join"
  | "monitor"
  | "selector" // Legacy: room selector
  | "dashboard" // Legacy: main dashboard
  | "addRoom"; // Legacy: add room modal

// Screen parameters by screen type
export interface ScreenParams {
  menu: { hubUrl?: string };
  serve: { hubUrl: string };
  create: { hubUrl: string };
  list: { hubUrl: string };
  join: { hubUrl: string; roomCode?: string };
  monitor: { hubUrl: string; roomCodes?: string[] };
  selector: { hubUrl: string };
  dashboard: { hubUrl: string };
  addRoom: { hubUrl: string };
}

// History entry
interface HistoryEntry {
  screen: Screen;
  params: Record<string, unknown>;
}

// Maximum history size
const MAX_HISTORY_SIZE = 10;

// ============================================================================
// Hook Options and Return Types
// ============================================================================

export interface UseNavigationOptions {
  initialScreen?: Screen;
  initialParams?: Record<string, unknown>;
}

export interface UseNavigationReturn {
  screen: Screen;
  params: Record<string, unknown>;
  navigate: <S extends Screen>(
    screen: S,
    params?: Partial<ScreenParams[S]>
  ) => void;
  goBack: () => void;
  canGoBack: () => boolean;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useNavigation(
  options: UseNavigationOptions = {}
): UseNavigationReturn {
  const { initialScreen = "menu", initialParams = {} } = options;

  const [currentScreen, setCurrentScreen] = useState<Screen>(initialScreen);
  const [screenParams, setScreenParams] =
    useState<Record<string, unknown>>(initialParams);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const navigate = useCallback(
    <S extends Screen>(screen: S, params?: Partial<ScreenParams[S]>) => {
      // Save current state to history before navigating
      setHistory((prev) => {
        const newHistory = [
          ...prev,
          { screen: currentScreen, params: screenParams },
        ];
        // Limit history size
        if (newHistory.length > MAX_HISTORY_SIZE) {
          return newHistory.slice(-MAX_HISTORY_SIZE);
        }
        return newHistory;
      });

      // Navigate to new screen
      setCurrentScreen(screen);
      setScreenParams(params ?? {});
    },
    [currentScreen, screenParams]
  );

  const goBack = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) {
        return prev;
      }

      const newHistory = [...prev];
      const lastEntry = newHistory.pop();

      if (lastEntry) {
        setCurrentScreen(lastEntry.screen);
        setScreenParams(lastEntry.params);
      }

      return newHistory;
    });
  }, []);

  const canGoBack = useCallback(() => {
    return history.length > 0;
  }, [history.length]);

  return {
    screen: currentScreen,
    params: screenParams,
    navigate,
    goBack,
    canGoBack,
  };
}
