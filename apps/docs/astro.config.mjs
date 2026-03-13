import starlight from "@astrojs/starlight";
// @ts-check
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";

// https://astro.build/config
export default defineConfig({
  site: "https://gambiarra.dev",
  vite: {
    ssr: {
      noExternal: ["zod"],
    },
  },
  integrations: [
    starlight({
      plugins: [
        starlightLlmsTxt({
          projectName: "Gambiarra",
          description:
            "Local-first LLM sharing hub. Pool Ollama, LM Studio, or any OpenAI-compatible endpoint with your team via rooms and an HTTP proxy. Expose a single OpenAI-compatible API that routes to any participant.",
          promote: [
            "guides/quickstart*",
            "reference/api*",
            "guides/challenges*",
            "guides/remote-providers*",
          ],
          demote: ["guides/homelab*", "architecture/*"],
        }),
      ],
      title: "Gambiarra",
      customCss: ["./src/styles/custom.css"],
      components: {
        Hero: "./src/components/Hero.astro",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/arthurbm/gambiarra",
        },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            { label: "Quick Start", slug: "guides/quickstart" },
            { label: "Challenges & Dynamics", slug: "guides/challenges" },
            { label: "Hackathon Setup", slug: "guides/hackathon" },
            { label: "Remote Providers", slug: "guides/remote-providers" },
            { label: "Home Lab Setup", slug: "guides/homelab" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "API Reference", slug: "reference/api" },
            { label: "CLI Reference", slug: "reference/cli" },
            { label: "SDK Reference", slug: "reference/sdk" },
          ],
        },
        {
          label: "Architecture",
          autogenerate: { directory: "architecture" },
        },
        {
          label: "Troubleshooting",
          autogenerate: { directory: "troubleshooting" },
        },
      ],
    }),
  ],
});
