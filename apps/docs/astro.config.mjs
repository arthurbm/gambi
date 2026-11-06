// @ts-check
import { satteri } from "@astrojs/markdown-satteri";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";
import { mermaidDiagrams } from "./src/plugins/mermaid.mjs";

/**
 * Code blocks sit on the dark slab in both themes (DESIGN.md, "The Printed
 * Display Rule"), so Expressive Code gets one theme built from the syntax
 * tokens in src/styles/tokens.css.
 */
const slab = {
  name: "gambi-slab",
  type: "dark",
  colors: {
    "editor.background": "#16181b",
    "editor.foreground": "#dfe6ef",
    "editor.selectionBackground": "#3a3f46",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#858d99" },
    },
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "storage.modifier",
        "keyword.operator.new",
      ],
      settings: { foreground: "#ff8f7a" },
    },
    {
      scope: ["string", "string.template", "markup.inline.raw"],
      settings: { foreground: "#f2cf3a" },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call",
        "entity.name.tag",
      ],
      settings: { foreground: "#6fdcf0" },
    },
    {
      scope: [
        "constant",
        "constant.numeric",
        "constant.language",
        "support.constant",
        "variable.other.constant",
        "entity.name.type",
        "support.type",
        "entity.other.attribute-name",
        "support.type.property-name",
      ],
      settings: { foreground: "#b9c7ff" },
    },
    {
      scope: ["punctuation", "meta.brace", "keyword.operator"],
      settings: { foreground: "#a7b0bc" },
    },
    {
      scope: ["variable", "variable.parameter"],
      settings: { foreground: "#dfe6ef" },
    },
  ],
};

// https://astro.build/config
export default defineConfig({
  site: "https://gambi.sh",
  markdown: {
    processor: satteri({ mdastPlugins: [mermaidDiagrams] }),
  },
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
      customCss: [
        "@fontsource-variable/archivo/wdth.css",
        "@fontsource-variable/jetbrains-mono/index.css",
        "./src/styles/tokens.css",
        "./src/styles/docs.css",
      ],
      components: {
        Hero: "./src/components/Hero.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      expressiveCode: {
        themes: [slab],
        useStarlightUiThemeColors: false,
        styleOverrides: {
          borderRadius: "12px",
          borderColor: "var(--e-line)",
          codeBackground: "var(--e-code-bg)",
          codeFontFamily: "var(--e-mono)",
          codeFontSize: "0.86rem",
          codeLineHeight: "1.65",
          codePaddingBlock: "0.95rem",
          codePaddingInline: "1.15rem",
          uiFontFamily: "var(--e-text)",
          focusBorder: "#4fd1e8",
          scrollbarThumbColor: "var(--e-code-scrollbar)",
          frames: {
            frameBoxShadowCssValue: "none",
            editorBackground: "var(--e-code-bg)",
            editorTabBarBackground: "var(--e-code-bg)",
            editorTabBarBorderBottomColor: "var(--e-code-line)",
            editorActiveTabBackground: "var(--e-code-bg)",
            editorActiveTabForeground: "var(--e-code-ink)",
            editorActiveTabIndicatorTopColor: "transparent",
            editorActiveTabIndicatorBottomColor: "var(--e-code-accent)",
            editorActiveTabIndicatorHeight: "2px",
            terminalBackground: "var(--e-code-bg)",
            terminalTitlebarBackground: "var(--e-code-bg)",
            terminalTitlebarForeground: "var(--e-code-dim)",
            terminalTitlebarBorderBottomColor: "var(--e-code-line)",
            terminalTitlebarDotsForeground: "var(--e-code-dim)",
            terminalTitlebarDotsOpacity: "0.45",
            inlineButtonForeground: "var(--e-code-ink)",
            inlineButtonBorder: "var(--e-code-dim)",
          },
        },
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
