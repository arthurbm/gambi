export const SEEDED_ROUNDS = [
  { number: 1, slug: "fundacao", title: "Fundação", skippable: false },
  { number: 2, slug: "construcao", title: "Construção", skippable: false },
  {
    number: 3,
    slug: "servico-publico",
    title: "Serviço público",
    skippable: true,
  },
  { number: 4, slug: "metro", title: "Metrô", skippable: false },
  { number: 5, slug: "crise", title: "Crise", skippable: true },
  { number: 6, slug: "festival", title: "Festival", skippable: false },
] as const;
