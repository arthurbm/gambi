import { hubClient } from "../hub-client";
import { useAppStore } from "../store/app-store";

/** The management client of the hub the TUI points at. */
export function useHubClient() {
  const hubUrl = useAppStore((s) => s.hubUrl);
  return hubClient(hubUrl);
}
