# ADR: CLI Distribution Model (Wrapper + Per-Platform Binaries)

**Status:** Aceito (implementado)
**Data:** decidido durante o redesign de release / 2026-05-20 (registrado como ADR)
**Escopo:** `packages/cli` (source + build), `scripts/publish.ts`, `.github/workflows/release.yml`

---

## 1. Contexto

A primeira versão do CLI vivia diretamente como pacote npm publicável em `packages/cli`. Isso causou dois problemas estruturais:

1. **Metadados de workspace vazavam pro registro.** `workspace:*` references, devDependencies internas, scripts de dev — tudo ia parar no tarball publicado.
2. **`npm install -g gambi` não era install path de primeira classe.** Usuários tinham que adivinhar entre `npm`, binário standalone via curl, ou rodar source.

A referência principal pra redesenhar foi o OpenCode (`../opencode`), que enfrentou problemas equivalentes e convergiu pra um modelo de wrapper + binários per-plataforma. A pergunta era: copiar inteiro, simplificar, ou divergir?

---

## 2. Decisão

Separar **fonte**, **distribuição** e **assets de release** em três camadas:

1. **Source workspace** (`packages/cli`) — `private: true`. Continua participando de `bun install`, `turbo`, scripts de dev. Mas `npm publish` não consegue empurrar ele as-is.
2. **Distribuição npm gerada** (`packages/cli/dist/npm/`) — wrapper público `gambi` + um pacote por plataforma (`gambi-linux-x64`, `gambi-linux-arm64`, `gambi-darwin-arm64`, `gambi-darwin-x64`, `gambi-windows-x64`).
3. **Assets de GitHub Release** (`packages/cli/dist/releases/`) — binários crus, usados pelo `scripts/install.sh` / `install.ps1` e anexados ao tag.

### Sub-decisões

#### D1 — Wrapper público `gambi` + `optionalDependencies` por plataforma

O pacote `gambi` no npm é apenas um launcher pequeno. Ele declara todos os pacotes de plataforma em `optionalDependencies`. Cada pacote de plataforma declara `os` e `cpu` específicos. O package manager instala só o que casa.

Resultado: o usuário roda `npm install -g gambi`. Em Linux x64 ele recebe `gambi` + `gambi-linux-x64`, nada mais. A complexidade de "qual binário?" some.

**Rejeitadas:**
- *Single fat binary distribuído via Homebrew/curl* — exige manter formula/script de install em paralelo ao npm, dobra superfície de release. Adiada explicitamente.
- *Postinstall script que baixa o binário certo* — fragiliza install offline, viola sandbox de algumas configs npm corporativas, e perde a vantagem do package manager fazer o trabalho.
- *npm-only sem platform split (binário Node)* — empurra Node como dep obrigatória do CLI. CLI gambi roda em Bun-compiled; quebraria o ponto inteiro.

#### D2 — Publish order: binários antes do wrapper

Ordem obrigatória no `scripts/publish.ts`:
1. `gambi-sdk`
2. `gambi-tui`
3. todos os binários de plataforma
4. wrapper `gambi`

Wrapper depende dos binários existirem no registro — se publicar primeiro, install resolve `optionalDependencies` pra pacotes inexistentes e falha silenciosa.

**Rejeitada:** *publish paralelo com retry* — adiciona não-determinismo num pipeline que precisa ser auditável.

#### D3 — Build uma vez, reusar em CI

O workflow tem 4 estágios (`version`, `build-cli`, `publish`, `github-release`). `build-cli` sobe `packages/cli/dist` como artifact; `publish` e `github-release` baixam o mesmo artifact.

Sem isso, npm e GitHub Release poderiam, em teoria, embalar binários compilados em momentos diferentes da mesma versão. Reproduzibilidade some.

**Rejeitada:** *rebuild por job* — economia zero (build é caro), risco real (artifacts divergentes).

#### D4 — Release pinned a um commit

`version` job captura o SHA logo no início. Todos os checkouts seguintes usam esse SHA exato, não `main`.

Sem pin, três jobs poderiam ler três revisões: tags Git, pacotes npm e GitHub Release assets descritiriam três estados-fonte diferentes.

**Rejeitada:** *cada job faz seu checkout de `main`* — race condition é praticamente inevitável em qualquer release que demore mais de minutos.

#### D5 — Verificação pós-publish explícita

Após publicar, `publish` valida via npm metadata API que cada pacote saiu com a versão e dist-tag esperadas. `github-release` valida nome e tamanho de cada asset contra o manifest do build.

Sem isso, falhas parciais (registro rejeitou um pacote, asset corrompeu no upload) passavam silenciosamente.

**Rejeitada:** *confiar no exit code do `npm publish`* — historicamente insuficiente; npm responde 200 antes de propagar metadata.

---

## 3. Consequências

### Positivas

- `npm install -g gambi` é o caminho único e de primeira classe. Outros canais (curl install, GitHub asset) são consistentes com ele porque compartilham os mesmos artifacts.
- O wrapper isola a complexidade de "qual binário?" no package manager.
- Pipeline é auditável: um SHA, um build, dois canais publicação com verificação.

### Aceitas

- **Oito pacotes npm publicados por release** (`gambi` + 5 plataformas + `gambi-sdk` + `gambi-tui`). Cada um precisa ter granular access token autorizado com 2FA bypass em `npmjs.com`. Ver [`docs/reference/release-architecture.md`](../reference/release-architecture.md#authentication) para o checklist quando adicionar novo pacote.
- **Modelo só faz sentido publicando o set inteiro junto.** Versionamento independente por pacote é incompatível — isso ancora ADR-0005 (synchronized versions).
- **Setup-fee uma vez:** scripts de install (`scripts/install.sh`, `scripts/install.ps1`) precisam ser mantidos junto. Aceito por consistência com OpenCode.

### Comparação explícita com OpenCode

**Copiamos conceitualmente:**
- Wrapper + binary package split
- `optionalDependencies` pra resolução
- Launcher script que resolve o binário certo em runtime
- Ordem de publish: SDK → TUI → binaries → wrapper
- Build once, reuse artifacts

**Deliberadamente NÃO copiamos (ainda):**
- Beta channel via npm dist-tags
- Variantes musl
- Baseline CPU fallbacks / detecção AVX2
- Distribuição via Homebrew, AUR, Scoop
- Multi-product release orchestration
- `--provenance` para attestation
- npm Trusted Publishing (OIDC)

A versão Gambi é estruturalmente equivalente, **simpler em escopo**.

---

## 4. Estado atual (referência)

- [`docs/reference/release-architecture.md`](../reference/release-architecture.md) — operação (os 3 layers descritos, workflow stages, autenticação, comandos de verificação).
- [`docs/reference/versioning.md`](../reference/versioning.md) — package layout e mecânica de versão (sincronizada — ver ADR-0005).
- `.github/workflows/release.yml` — pipeline de release.
- `scripts/publish.ts` — script de publish com a ordem D2 e verificação D5.

---

## 5. Origem

Esta ADR foi extraída em 2026-05-20 do `docs/reference/release-architecture.md`, que misturava "por que essa arquitetura" (decisão) com "como operar essa arquitetura" (referência). O reference doc foi enxugado para conter apenas o operacional; o decisional vive aqui.
