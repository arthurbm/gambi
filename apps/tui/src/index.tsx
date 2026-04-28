import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app";
import { useAppStore } from "./store/app-store";

export interface StartTUIOptions {
  hubUrl: string;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s before data is considered stale
      retry: 2,
      refetchOnWindowFocus: false, // TUI doesn't have window focus events
    },
  },
});

export async function startTUI(options: StartTUIOptions) {
  useAppStore.getState().setHubUrl(options.hubUrl);
  const renderer = await createCliRenderer();
  createRoot(renderer).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

// Run standalone when executed directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  const hubIndex = args.indexOf("--hub");
  const customHub = hubIndex !== -1 ? args[hubIndex + 1] : undefined;
  const hubUrl = customHub ?? "http://localhost:3000";

  startTUI({ hubUrl });
}
