export interface SeededRound {
  number: number;
  slug: string;
  title: string;
  skippable: boolean;
  challenge: string;
  proposals: readonly [string, string, ...string[]];
}

export const SEEDED_ROUNDS: readonly SeededRound[] = [
  {
    number: 1,
    slug: "fundacao",
    title: "Fundação",
    skippable: false,
    challenge:
      "Defina a fundação do lote e a regra que orienta todas as escolhas seguintes.",
    proposals: [
      "Uma praça pequena que organiza os caminhos ao redor.",
      "Um pátio compartilhado com entradas por dois lados.",
      "Uma construção compacta que deixa metade do lote livre.",
    ],
  },
  {
    number: 2,
    slug: "construcao",
    title: "Construção",
    skippable: false,
    challenge:
      "Construa um lugar reconhecível que responda ao caráter do bairro.",
    proposals: [
      "Oficina aberta com estrutura aparente.",
      "Casa coletiva organizada ao redor de um quintal.",
      "Mercado de esquina com fachada que se abre para a rua.",
    ],
  },
  {
    number: 3,
    slug: "servico-publico",
    title: "Serviço público",
    skippable: true,
    challenge: "Adicione um serviço público útil para mais de um squad.",
    proposals: [
      "Posto de cuidado com sala multiuso.",
      "Biblioteca de ferramentas e materiais.",
      "Cozinha comunitária ligada a uma pequena horta.",
    ],
  },
  {
    number: 4,
    slug: "metro",
    title: "Metrô",
    skippable: false,
    challenge:
      "Conecte o lote à rede de metrô sem apagar o que já foi construído.",
    proposals: [
      "Entrada discreta na borda mais movimentada.",
      "Passarela que conecta dois níveis do terreno.",
      "Praça de chegada com comércio no térreo.",
    ],
  },
  {
    number: 5,
    slug: "crise",
    title: "Crise",
    skippable: true,
    challenge: "Adapte o lote a uma crise mantendo seu uso mais importante.",
    proposals: [
      "Converter espaços internos em abrigo temporário.",
      "Criar uma reserva de água visível e acessível.",
      "Abrir uma rota segura que atravesse o lote.",
    ],
  },
  {
    number: 6,
    slug: "festival",
    title: "Festival",
    skippable: false,
    challenge:
      "Prepare o lote para o festival final e convide a cidade a entrar.",
    proposals: [
      "Palco de pequena escala voltado para a rua.",
      "Mesa coletiva que atravessa o pátio.",
      "Percurso de luz que revela as mudanças das seis rodadas.",
    ],
  },
];

export function roundSeed(roundId: string) {
  const number = Number(roundId.replace("round-", ""));
  return SEEDED_ROUNDS.find((round) => round.number === number);
}
