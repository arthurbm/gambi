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
  const root = createRoot(renderer);
  // The tree goes first. A state update that is still pending when the
  // renderer is destroyed would be rendered into it and abort the process;
  // unmounting also stops what the screens keep open (the watched rooms).
  const quit = () => {
    root.unmount();
    // A query nobody observes any more would hold the process for its
    // garbage-collection timer.
    queryClient.clear();
    renderer.destroy();
  };
  root.render(
    <QueryClientProvider client={queryClient}>
      <App onQuit={quit} />
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
