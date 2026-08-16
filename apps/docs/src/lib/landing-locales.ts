export type LandingLocale = "en" | "pt-BR";

interface LandingCopy {
  brandLabel: string;
  description: string;
  eyebrow: string;
  heading: string;
  htmlLang: LandingLocale;
  languageNavLabel: string;
  localePath: "/" | "/pt";
  quickStartLabel: string;
  summary: string;
  switchLocaleLabel: string;
  switchLocalePath: "/" | "/pt";
  title: string;
}

export const landingLocales = {
  en: {
    brandLabel: "Gambi",
    description: "The standalone English landing for the Gambi documentation.",
    eyebrow: "Landing scaffold",
    heading: "Gambi documentation",
    htmlLang: "en",
    languageNavLabel: "Language",
    localePath: "/",
    quickStartLabel: "Open Quick Start",
    summary:
      "This standalone page is ready for the localized landing design. The existing documentation remains available in Starlight.",
    switchLocaleLabel: "Português (Brasil)",
    switchLocalePath: "/pt",
    title: "Gambi documentation",
  },
  "pt-BR": {
    brandLabel: "Gambi",
    description: "A landing independente em português da documentação do Gambi.",
    eyebrow: "Scaffold da landing",
    heading: "Documentação do Gambi",
    htmlLang: "pt-BR",
    languageNavLabel: "Idioma",
    localePath: "/pt",
    quickStartLabel: "Abrir o início rápido",
    summary:
      "Esta página independente está pronta para o design localizado da landing. A documentação existente continua disponível no Starlight.",
    switchLocaleLabel: "English",
    switchLocalePath: "/",
    title: "Documentação do Gambi",
  },
} satisfies Record<LandingLocale, LandingCopy>;
