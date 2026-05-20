# ADR: Synchronized Monorepo Versions

**Status:** Aceito (implementado)
**Data:** decidido durante o redesign de release / 2026-05-20 (registrado como ADR)
**Escopo:** todos os pacotes publicáveis (`gambi`, `gambi-<platform>-<arch>`, `gambi-sdk`, `gambi-tui`)

---

## 1. Contexto

Gambi publica oito pacotes npm por release: o wrapper `gambi`, cinco binários per-plataforma, `gambi-sdk` e `gambi-tui`. Esses pacotes têm dependências semânticas fortes entre si:

- O wrapper depende dos binários da mesma versão (via `optionalDependencies` — ver ADR-0004).
- A SDK consome os contratos do hub embutidos no binário CLI; um cliente SDK 0.3.2 não pode assumir compatibilidade com um hub 0.4.0.
- A TUI lê o mesmo management plane que a SDK; mesma restrição.

A pergunta era: cada pacote sobe versão sozinho conforme o que mudar, ou todo o set move junto?

---

## 2. Decisão

Todos os pacotes publicáveis usam **versão sincronizada**. Cada release move o conjunto inteiro pra mesma versão semver.

Exemplo (estado da v0.2.4):

```
gambi                 0.2.4
gambi-linux-x64       0.2.4
gambi-linux-arm64     0.2.4
gambi-darwin-arm64    0.2.4
gambi-darwin-x64      0.2.4
gambi-windows-x64     0.2.4
gambi-sdk             0.2.4
gambi-tui             0.2.4
```

Pacotes internos não publicados (`@gambi/core`, `@gambi/config`) seguem o mesmo número porque vivem no mesmo monorepo, mas isso é cosmético — o número só existe oficialmente nos publicados.

O workflow de release calcula o próximo número a partir do bump escolhido (`patch`/`minor`/`major`) e propaga pra todos os `package.json` num único commit.

### Alternativas rejeitadas

- **Versionamento independente per pacote (estilo Lerna/Changesets).**
  Rejeitado por dois motivos. (1) Compat entre pacotes vira matriz a documentar (`gambi 0.4.2` funciona com `gambi-sdk 0.3.x`? `0.4.x`? ambos?). Cada release inflaria os release notes pra explicar. (2) ADR-0004 já impõe ordem de publish acoplada (wrapper depende dos binários); versão independente complicaria a coordenação sem ganho.

- **Versionar só wrapper + binários juntos; SDK e TUI independentes.**
  Rejeitado porque SDK/TUI consomem contratos do hub. Quebrar SDK enquanto mantém wrapper em versão antiga geraria "0.3.2 SDK works with 0.3.x and 0.4.x hub" — exatamente o tipo de matriz que queremos evitar.

- **Calendar versioning (`YYYY.MM.PATCH`) per pacote.**
  Rejeitado: tirar o sinal de semver não resolve o problema de compatibilidade, só remove a heurística que devs já têm.

- **Versão única pra todo o monorepo, sem semver (`v17`, `v18`, ...).**
  Considerado. Rejeitado porque Gambi ainda está pre-1.0 e o ferramental npm/Bun assume semver pra dependency resolution.

---

## 3. Consequências

### Positivas

- **Compat instantâneo.** "Todos os pacotes com mesmo número foram testados juntos." Sem matriz.
- **Tooling simples.** Um `bump` no workflow propaga pra todo o set; um tag git por release; um job de publish ordenado.
- **Sinergia com ADR-0004.** O modelo de publish (`gambi` wrapper precisa dos binários no registry primeiro) só faz sentido se eles compartilham versão exata — caso contrário, qual versão de `gambi-linux-x64` o wrapper `0.3.4` declara em `optionalDependencies`?

### Aceitas

- **Patch em um pacote força bump em todos.** Se só `gambi-tui` mudar entre 0.3.3 e 0.3.4, `gambi-sdk` também sobe sem ter mudado. Aceito porque release notes deixam claro o que mudou, e o custo de cada release é baixo (workflow CI cuida).
- **Conventional Commits perde parte do sinal por escopo.** `fix(sdk):` e `fix(cli):` produzem o mesmo bump no set inteiro. Aceito; os escopos continuam úteis pra changelog e blame.
- **Manual version bumps são proibidos em feature PRs.** O workflow é a única forma legítima de mudar versão; PRs que tocam `version` em `package.json` são rejeitados em review. Documentado em [`docs/reference/versioning.md`](../reference/versioning.md#rules-for-everyday-development).
- **Tags Git carregam um único número.** `v0.2.4` representa o set inteiro. Não há `gambi-sdk-v0.2.4` separado.

---

## 4. Estado atual (referência)

- [`docs/reference/versioning.md`](../reference/versioning.md) — package layout (tabela do set publicado) + regras de dev.
- [`docs/reference/release-architecture.md`](../reference/release-architecture.md) — pipeline operacional.
- [`docs/adr/0004-cli-distribution-model.md`](./0004-cli-distribution-model.md) — modelo de distribuição (wrapper + binários) que ancora o requisito de sincronização.
- `.github/workflows/release.yml` — implementa o cálculo do bump e a propagação.
- `scripts/publish.ts` — publish ordenado com verificação.

---

## 5. Origem

Esta ADR foi extraída em 2026-05-20 da seção "Decision: Synchronized Versions" do `docs/reference/versioning.md`. O reference doc foi enxugado para conter apenas package layout e regras operacionais; a decisão e alternativas vivem aqui.
