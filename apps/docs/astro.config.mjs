import starlight from "@astrojs/starlight";
// @ts-check
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";

// https://astro.build/config
export default defineConfig({
  site: "https://gambi.sh",
  vite: {
    ssr: {
      noExternal: ["zod"],
    },
  },
  integrations: [
    starlight({
      plugins: [
        starlightLlmsTxt({
          projectName: "Gambi",
          description:
            "Local-first LLM sharing hub. Pool Ollama, LM Studio, or any OpenAI-compatible endpoint with your team via rooms and an HTTP proxy. Expose a single OpenAI-compatible API that routes to any participant.",
          promote: [
            "guides/quickstart*",
            "reference/api*",
            "reference/sdk*",
            "guides/ai-tools*",
            "guides/challenges*",
            "guides/remote-providers*",
          ],
          demote: ["guides/homelab*", "architecture/*"],
        }),
      ],
      title: "Gambi",
      customCss: ["./src/styles/custom.css"],
      components: {
        Hero: "./src/components/Hero.astro",
      },
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
            {
              label: "Migrate from Gambiarra",
              slug: "guides/migrate-from-gambiarra",
            },
            { label: "Challenges & Dynamics", slug: "guides/challenges" },
            { label: "Hackathon Setup", slug: "guides/hackathon" },
            { label: "Using with AI Tools", slug: "guides/ai-tools" },
            { label: "Remote Providers", slug: "guides/remote-providers" },
            {
              label: "Custom Participant Runtime",
              slug: "guides/custom-participant",
            },
            { label: "Home Lab Setup", slug: "guides/homelab" },
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
