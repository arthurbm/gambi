import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
// @ts-check
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";

// https://astro.build/config
export default defineConfig({
  site: "https://gambi.sh",
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    ssr: {
      noExternal: ["zod"],
    },
  },
  integrations: [
    react(),
    starlight({
      plugins: [
        starlightLlmsTxt({
          projectName: "Gambi",
          description:
            "Local-first LLM sharing hub. Pool Ollama, LM Studio, or any OpenAI-compatible endpoint with your team via rooms and an HTTP proxy. Expose a single OpenAI-compatible API that routes to any participant.",
          promote: [
            "guides/quickstart*",
            "guides/patterns*",
            "reference/api*",
            "reference/sdk*",
            "guides/ai-tools*",
            "guides/remote-providers*",
          ],
          demote: ["architecture/*"],
        }),
      ],
      title: "Gambi",
      customCss: ["./src/styles/custom.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/arthurbm/gambi",
        },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            { label: "Quick Start", slug: "guides/quickstart" },
            { label: "Multi-LLM Patterns", slug: "guides/patterns" },
            { label: "Using with AI Tools", slug: "guides/ai-tools" },
            { label: "Remote Providers", slug: "guides/remote-providers" },
            {
              label: "Custom Participant Runtime",
              slug: "guides/custom-participant",
            },
            {
              label: "Migrate from Gambiarra",
              slug: "guides/migrate-from-gambiarra",
            },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "API Reference", slug: "reference/api" },
            { label: "CLI Reference", slug: "reference/cli" },
            { label: "SDK Reference", slug: "reference/sdk" },
            { label: "Observability", slug: "reference/observability" },
          ],
        },
        {
          label: "Architecture",
          autogenerate: { directory: "architecture" },
        },
        {
          label: "Explanation",
          autogenerate: { directory: "explanation" },
        },
        {
          label: "Troubleshooting",
          autogenerate: { directory: "troubleshooting" },
        },
      ],
    }),
  ],
});
