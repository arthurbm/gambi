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
      // Link-preview card. Source and re-render command: og/card.html.
      head: [
        {
          tag: "meta",
          attrs: { property: "og:image", content: "https://gambi.sh/og.png" },
        },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        {
          tag: "meta",
          attrs: {
            property: "og:image:alt",
            content:
              "Agent tools are built for one person. Gambi is built for many. Six people's agents and models connected to one hub.",
          },
        },
        {
          tag: "meta",
          attrs: { name: "twitter:image", content: "https://gambi.sh/og.png" },
        },
      ],
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
          items: [{ autogenerate: { directory: "architecture" } }],
        },
        {
          label: "Explanation",
          items: [{ autogenerate: { directory: "explanation" } }],
        },
        {
          label: "Troubleshooting",
          items: [{ autogenerate: { directory: "troubleshooting" } }],
        },
      ],
    }),
  ],
});
