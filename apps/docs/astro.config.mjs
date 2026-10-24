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
            "Local-first hub for sharing OpenAI-compatible model endpoints and local coding harnesses. Model requests and ACP messages travel through participant-opened tunnels.",
          promote: [
            "guides/quickstart*",
            "guides/bring-your-harness*",
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
              label: "Bring Your Harness",
              slug: "guides/bring-your-harness",
            },
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
