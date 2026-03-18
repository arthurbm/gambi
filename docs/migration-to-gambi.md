# Migração Completa de Gambiarra para Gambi

## Resumo

Migrar o projeto para a marca canônica **Gambi**, com repo final em **`arthurbm/gambi`**, domínio principal **`https://gambi.sh`** e hard cut de naming público/técnico. O rename deve atingir branding, npm, CLI, SDK, imports, metadata HTTP, mDNS, config local, release artifacts, docs, automações e links externos.

A migração não manterá compatibilidade funcional longa com `gambiarra`, mas terá um caminho de migração prático para usuários já instalados via **docs + scripts**, sem bridge release dos pacotes antigos. Localmente, a pasta será renomeada para `gambi` e o caminho antigo ficará apontando para ela via symlink temporário para preservar histórico/contexto em Codex e Claude Code.

## Mudanças Principais

### Marca, repo e domínio

- Renomear o repo GitHub para **`arthurbm/gambi`**.
- Trocar o nome visível do produto para **Gambi** em README, docs, landing, badges, site metadata, social links, release notes e exemplos.
- Tornar **`https://gambi.sh`** a URL canônica do site/docs.
- Atualizar todas as referências de `github.com/arthurbm/gambiarra` e `raw.githubusercontent.com/arthurbm/gambiarra/...` para o repo novo.
- Se `gambiarra.dev` ainda estiver sob seu controle, configurar **redirect 301** para `gambi.sh`.

### Pacotes, binário e identificadores públicos

- Renomear o pacote CLI npm de `gambiarra` para **`gambi`**.
- Renomear o pacote SDK npm de `gambiarra-sdk` para **`gambi-sdk`**.
- Renomear workspaces internos `@gambiarra/core` e `@gambiarra/config` para **`@gambi/core`** e **`@gambi/config`**.
- Renomear o binário CLI de `gambiarra` para **`gambi`**.
- Renomear artefatos de release para `gambi-linux-x64`, `gambi-darwin-arm64`, `gambi-windows-x64.exe`.
- Atualizar `scripts/publish.ts`, workflows de release e build, metadata de `package.json`, homepage, bugs e repository.

### API, SDK e runtime

- Fazer full public rename no SDK:
  - `createGambiarra()` -> **`createGambi()`**
  - `GambiarraOptions` -> **`GambiOptions`**
  - `GambiarraProvider` -> **`GambiProvider`**
  - `GambiarraProtocol` -> **`GambiProtocol`**
  - `GambiarraModel` -> **`GambiModel`**
  - `GambiarraClient` -> **`GambiClient`**
- Atualizar imports e exemplos para `import { createGambi } from "gambi-sdk"`.
- Trocar `name: "gambiarra"` do provider AI SDK para **`"gambi"`**.
- Renomear a chave extra de metadata retornada em `/v1/models` de `gambiarra` para **`gambi`**.
- Renomear nomes de serviço e namespace mDNS:
  - `gambiarra-hub-{port}` -> **`gambi-hub-{port}`**
  - `_gambiarra._tcp.local` -> **`_gambi._tcp.local`**
- Renomear o diretório local de config de `~/.gambiarra` para **`~/.gambi`**.
- Atualizar logos ASCII, labels e textos do TUI/CLI para Gambi.

### Docs e narrativa de naming

- Atualizar `README.md` e `docs/architecture.md` para refletirem o novo nome e todos os novos comandos/imports/URLs.
- Atualizar `apps/docs/astro.config.mjs` para `site`, `title`, `projectName` e links sociais com `gambi.sh` e o repo novo.
- Adicionar uma página de **Explanation** no estilo Diátaxis, ligada do README e da landing, com a posição oficial:
  - **Gambi** é abreviação de **gambiarra**.
  - Em inglês, o nome curto melhora pronúncia, memorização, CLI, imports e package names.
  - Em PT-BR, “gambiarra” deve ser explicada como **engenhosidade sob restrição**, improviso inteligente, solução criativa e comunitária; não como “coisa malfeita”.
  - Amarrar isso ao espírito do projeto: local-first, portátil, comunitário, hacker no melhor sentido.
- Atualizar exemplos, guides, reference e landing para `gambi`, `gambi-sdk`, `gambi.sh` e o novo discurso de marca.
- Padronizar menções ao futuro “managed mode” para não competir com a nova marca principal.

## Sequência de Execução

1. Preparar o corte de branding e contratos no código.
   Atualizar nomes de pacote, binário, imports internos, scopes, metadata HTTP, mDNS, config path, logos, exemplos e textos.
2. Atualizar automações e publish.
   Ajustar workflows de GitHub Actions, scripts de publish/install/uninstall e nomes de artefato para o novo naming.
3. Publicar a migração para usuários existentes.
   Criar página de migração em `gambi.sh` e scripts dedicados de migração com one-liners por canal de instalação:
   - npm global: `npm uninstall -g gambiarra && npm install -g gambi`
   - bun global: `bun remove -g gambiarra && bun add -g gambi`
   - standalone Linux/macOS: uninstall legado + install novo
   - Windows: uninstall legado + install novo
4. Fazer o corte do repo e site.
   Renomear repo GitHub para `arthurbm/gambi`, ajustar remote URLs, badges, raw URLs e deploy das docs para `gambi.sh`.
5. Renomear o diretório local por último.
   Mover `/home/arthur/Documents/PESSOAL/GAMBIARRA-CLUB/gambiarra` para `/home/arthur/Documents/PESSOAL/GAMBIARRA-CLUB/gambi` e criar symlink temporário do caminho antigo para o novo para preservar associação nas ferramentas.
6. Finalizar comunicação do corte.
   Release notes, changelog, README e landing devem explicitar que `gambiarra` virou `gambi`, que é a abreviação oficial, e apontar para a página de migração.

## Mudanças em Interfaces Públicas

- CLI:
  - `gambiarra ...` -> `gambi ...`
- npm:
  - `gambiarra` -> `gambi`
  - `gambiarra-sdk` -> `gambi-sdk`
- workspace imports:
  - `@gambiarra/*` -> `@gambi/*`
- SDK:
  - `createGambiarra` -> `createGambi`
  - todos os tipos `Gambiarra*` -> `Gambi*`
- HTTP models metadata:
  - `gambiarra: { ... }` -> `gambi: { ... }`
- mDNS:
  - `_gambiarra` -> `_gambi`
- config local:
  - `~/.gambiarra/config.json` -> `~/.gambi/config.json`
- domínio:
  - `gambiarra.dev` -> `gambi.sh`
- repo:
  - `arthurbm/gambiarra` -> `arthurbm/gambi`

## Plano de Migração do Usuário Instalado

- Criar um guia único “Migrating from Gambiarra to Gambi”.
- Incluir caminhos distintos para:
  - npm global
  - bun global
  - binário standalone Linux/macOS
  - Windows PowerShell
- Adicionar scripts de migração no novo repo/site para evitar instruções longas no README.
- Garantir que os scripts de uninstall novo saibam instruir usuários a remover instalações antigas quando detectarem restos do nome `gambiarra`.
- Atualizar docs para cobrir também a migração de:
  - imports `gambiarra-sdk` -> `gambi-sdk`
  - `createGambiarra` -> `createGambi`
  - config path `~/.gambiarra` -> `~/.gambi`
  - service/systemd names `gambiarra-hub` -> `gambi-hub`
  - mDNS `_gambiarra` -> `_gambi`

## Testes e Validação

- Auditoria por grep: não sobrar referências públicas antigas a `gambiarra` fora de release notes/migration docs e menções históricas intencionais.
- Validar build e tipos:
  - `bun run check-types`
  - `bun run --cwd packages/sdk build`
  - `bun run --cwd packages/cli build`
  - `bun run --cwd apps/docs build`
- Validar testes direcionados:
  - `bun test packages/core/src`
  - `bun test packages/sdk/src`
  - `bun run --cwd apps/tui test`
- Validar UX pública:
  - `gambi --help`
  - install/uninstall/migrate scripts
  - imports do SDK com `gambi-sdk`
  - docs buildando com `gambi.sh`
  - release artifacts com nomes novos
- Validar pós-rename local:
  - repo abre corretamente no caminho novo
  - symlink antigo resolve para a pasta nova
  - Git remote aponta para `arthurbm/gambi`

## Assumptions

- `gambi` e `gambi-sdk` já estão disponíveis/reservados no npm.
- O slug final do GitHub será `arthurbm/gambi`.
- `gambi.sh` será a URL canônica das docs/site.
- O projeto aceita breaking changes imediatas de naming técnico; não haverá janela longa de aliases.
- O path de migração para usuários existentes será fornecido por docs e scripts, não por release bridge dos pacotes legados.
- A pasta local será renomeada com symlink temporário para reduzir risco de perda de histórico em Codex/Claude.
- Baseei o plano no código atual como fonte de verdade; onde README/AGENTS divergem do runtime, o plano segue o código.
