import { defineCollection, z } from "astro:content";
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // UI strings for our own components, next to Starlight's built-in ones.
  i18n: defineCollection({
    loader: i18nLoader(),
    schema: i18nSchema({
      extend: z.object({
        "agentPrompt.label": z.string().optional(),
        "agentPrompt.lede": z.string().optional(),
        "agentPrompt.copy": z.string().optional(),
        "agentPrompt.copied": z.string().optional(),
        "agentPrompt.failed": z.string().optional(),
      }),
    }),
  }),
};
