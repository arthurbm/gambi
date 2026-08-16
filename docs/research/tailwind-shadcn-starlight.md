# Research: Tailwind v4 + shadcn islands + i18n numa app Starlight

> Issue: [#61](https://github.com/arthurbm/gambi/issues/61) · Parte do mapa [#58](https://github.com/arthurbm/gambi/issues/58) · Data: 2026-08-16

**Pergunta:** como integrar, em `apps/docs` (Astro 5 + Starlight 0.37, monorepo bun + turbo), uma landing custom em `src/pages/index.astro` com Tailwind v4 + React islands + shadcn **sem afetar o CSS das docs Starlight**, e com i18n `/` (EN) + `/pt` (PT-BR)?

## Estado atual do `apps/docs` (verificado localmente)

- `astro` **5.16.6** e `@astrojs/starlight` **0.37.1** instalados (`apps/docs/node_modules/*/package.json`); `package.json` declara `astro ^5.6.1` + `@astrojs/starlight ^0.37.1` + `starlight-llms-txt`. Sem Tailwind, sem React, sem `src/pages/`.
- Splash atual: `src/content/docs/index.mdx` (`template: splash`) renderizado via override de componente `Hero` (`astro.config.mjs` → `components: { Hero: "./src/components/Hero.astro" }`), que delega para `src/components/Lander.astro`.
- CSS custom das docs: `src/styles/custom.css` (tokens `--gambi-*` + overrides `--sl-*`), registrado em `customCss` do Starlight.
- Monorepo: bun workspaces (`apps/*`, `packages/*`), `packageManager: bun@1.3.13`, turbo com tasks `build`/`dev`/`check-types`.

---

## 1. Starlight cede a rota `/` para `src/pages/index.astro`?

**Resposta: sim.** O Starlight registra **uma única rota rest** `[...slug]` via `injectRoute` — ele não "possui" a raiz de forma especial. No Astro, rota estática vence rest parameter, então `src/pages/index.astro` ganha a rota `/`. Mas o `src/content/docs/index.mdx` atual deve ser **removido** (junto com o override de `Hero` e o `Lander.astro`), senão o `[...slug]` do Starlight continua tentando gerar `/` e há dois geradores para o mesmo path.

Detalhes:

- Fonte primária (código instalado): `apps/docs/node_modules/@astrojs/starlight/index.ts` linhas 87–93 — `injectRoute({ pattern: '[...slug]', entrypoint: '@astrojs/starlight/routes/static/index.astro', ... })`. Todas as páginas de `src/content/docs/` saem desse catch-all.
- Docs do Starlight ([Pages](https://starlight.astro.build/guides/pages/)): "For advanced use cases, you can add custom pages by creating a `src/pages/` directory. The `src/pages/` directory uses Astro's file-based routing". Páginas custom podem ter "completely custom layout" (sem o design do Starlight) ou usar `<StarlightPage>` se quiserem o chrome do Starlight — para a landing, layout totalmente custom.
- Prioridade de rotas do Astro ([Routing → route priority order](https://docs.astro.build/en/guides/routing/#route-priority-order)): "Static routes without path parameters will take precedence over dynamic routes" e named params vencem rest params. `index.astro` (estático) > `[...slug]` (rest).
- **Migração concreta neste repo:** apagar `src/content/docs/index.mdx`, remover o bloco `components: { Hero: ... }` do `astro.config.mjs` e apagar `src/components/Hero.astro` + `Lander.astro` (o conteúdo do Lander migra para a nova landing). Sem isso, o build tem dois candidatos para `/` (o estático ganha, mas fica lixo/aviso e conteúdo morto).

## 2. Como escopar o preflight do Tailwind v4 para não vazar no Starlight

**Resposta: escopo por página + cascade layers como defesa extra.** O CSS da landing (com `@import "tailwindcss"`) deve ser importado **apenas** pelas páginas da landing — o Astro só inclui CSS nas páginas que o importam (direta ou transitivamente). Assim o preflight nem chega a carregar nas rotas das docs. Como segunda linha de defesa, o Tailwind v4 coloca tudo em cascade layers e o Starlight também, então dá para controlar a ordem — e, no limite, dá para simplesmente **omitir o preflight**.

Detalhes:

- **Bundling por página no Astro** ([Styling](https://docs.astro.build/en/guides/styling/)): CSS importado entra no grafo da página que importa; o aviso da doc é que "imported CSS can 'leak'. Importing a component applies any CSS it imports, even if the component is never used". Tradução prática: o vazamento só acontece se algum componente **usado pelas docs** importar o CSS da landing. Regra do projeto: `src/styles/landing.css` é importado somente por `src/pages/index.astro`, `src/pages/pt/index.astro` e componentes exclusivos da landing; nunca por nada registrado no Starlight (`customCss`, overrides).
- **Estrutura do Tailwind v4** ([Preflight](https://tailwindcss.com/docs/preflight)): "When you import `tailwindcss` into your project, Preflight is automatically injected into the `base` layer". O `@import "tailwindcss"` equivale a:

  ```css
  @layer theme, base, components, utilities;
  @import "tailwindcss/theme.css" layer(theme);
  @import "tailwindcss/preflight.css" layer(base);
  @import "tailwindcss/utilities.css" layer(utilities);
  ```

  Para desabilitar o preflight, basta omitir a linha do `preflight.css`. Se a landing for 100% estilizada com utilities/shadcn, essa é a opção de risco zero (shadcn traz seus próprios estilos base via tokens; testar visualmente sem preflight antes de decidir).
- **Cascade layers do Starlight** ([CSS & Tailwind](https://starlight.astro.build/guides/css-and-tailwind/)): "Starlight uses cascade layers internally to manage the order of its styles" — confirmado no código: `node_modules/@astrojs/starlight/style/layers.css` declara `@layer starlight.base, starlight.reset, starlight.core, ...`. Se um dia o CSS do Tailwind acabar numa página de docs, a ordem declarada primeiro perde; a doc oficial do Starlight recomenda `@layer base, starlight, theme, components, utilities;` para pôr o Starlight acima do preflight (`base`) e abaixo das utilities.
- **Se quiser Tailwind DENTRO das docs no futuro** (retheme): o caminho oficial é o plugin Vite do Tailwind + `@astrojs/starlight-tailwind`, que fornece "complementary CSS to help configure Tailwind for compatibility with Starlight's styles" ([CSS & Tailwind](https://starlight.astro.build/guides/css-and-tailwind/)). **Não** é necessário para a landing isolada.
- Setup do build: instalar `tailwindcss` + `@tailwindcss/vite` e registrar o plugin em `vite.plugins` no `astro.config.mjs` (forma recomendada pela doc do Tailwind para Vite/Astro). Isso é global no build, mas inofensivo: sem `@import "tailwindcss"` num CSS alcançável pelas docs, nada é emitido para elas.

## 3. O que `shadcn init` gera num projeto Astro em monorepo bun, e o que ajustar

**Resposta: o guia oficial de Astro do shadcn funciona; o modo monorepo do shadcn NÃO se aplica.** Rodar o init **dentro de `apps/docs`** tratando-o como app standalone do workspace. Pré-requisitos manuais: integração React e paths no tsconfig.

Detalhes:

- **Guia oficial Astro** ([shadcn → Installation → Astro](https://ui.shadcn.com/docs/installation/astro)): projeto Astro com Tailwind + React; editar `tsconfig.json` com `"baseUrl": "."` e `"paths": { "@/*": ["./src/*"] }`; rodar `shadcn@latest init`; `shadcn@latest add button`; importar `@/components/ui/button` nas páginas `.astro`. Com bun: `bun x astro add react` (instala `@astrojs/react` + `react`/`react-dom`) e `bun x shadcn@latest init` / `add`.
- **components.json** ([components.json](https://ui.shadcn.com/docs/components-json)): com Tailwind v4, "For Tailwind CSS v4, leave this blank" no campo `tailwind.config`; `tailwind.css` deve apontar para o CSS que importa o Tailwind — aqui, `src/styles/landing.css`; `cssVariables: true` (recomendado); aliases `components`/`ui`/`lib`/`utils`/`hooks`. Ajustes manuais para Astro: `"rsc": false` (Astro não tem React Server Components), `"tsx": true`.
- **O que o init gera:** `components.json`, `src/lib/utils.ts` (helper `cn`), deps (`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`) e injeta no CSS apontado os tokens do shadcn (`:root { --background: ... }` + `.dark { ... }` + `@theme inline`). Como esse CSS é o `landing.css` (escopado por página, item 2), os tokens `--background`/`--foreground` etc. **não tocam** as docs; e mesmo que tocassem, não colidem com os nomes `--sl-*` / `--gambi-*` do `custom.css` atual. Como o mapa #58 decidiu dark-only, mover os valores do `.dark` para `:root` (ou aplicar `class="dark"` no `<html>` da landing).
- **Monorepo** ([shadcn → Monorepo](https://ui.shadcn.com/docs/monorepo)): o `shadcn init --monorepo` cria um template próprio (`apps/web` + `packages/ui`, com Next.js/Vite/TanStack Start/React Router) e usa `components.json` por workspace para rotear imports `@workspace/ui/...`. Não há template Astro nesse fluxo e não precisamos dele: os componentes vivem só em `apps/docs`. Num workspace bun, rodar o CLI a partir de `apps/docs` para os pacotes caírem no `package.json` do app (bun hoisteia em `node_modules` da raiz normalmente; o guia do shadcn não exige nada além disso).
- **React islands:** componentes shadcn usados de forma estática (ex.: `Button` como link) renderizam no servidor sem JS — sem diretiva `client:*`. Interatividade (tabs, copy-to-clipboard do hero) exige `client:load` ou `client:visible` no ponto de uso ([Astro islands / client directives](https://docs.astro.build/en/reference/directives-reference/#client-directives)). Menos ilhas = menos JS; o Lander atual usa `<script>` vanilla para copy — pode continuar assim ou virar uma ilha pequena.

## 4. i18n: `/` (EN) + `/pt` (PT-BR) sem ativar o i18n das docs

**Resposta: NÃO configurar `i18n` no `astro.config.mjs`. Criar as rotas manualmente:** `src/pages/index.astro` (EN) + `src/pages/pt/index.astro` (PT-BR).

Detalhes:

- **Por que não usar a config `i18n` do Astro:** fonte primária no código instalado — `node_modules/@astrojs/starlight/utils/i18n.ts`, função `processI18nConfig`: "If only an Astro i18n configuration is provided, an equivalent Starlight i18n configuration is used". Ou seja, setar `i18n: { defaultLocale: "en", locales: ["en", "pt"] }` no Astro faz o Starlight **adotar** essa config e virar multilíngue (`isMultilingual = locales.length > 1`), ativando language picker e rotas `/pt/...` para docs que não existem. E se setar `i18n` do Astro **e** `locales` do Starlight, o Starlight lança erro: "Cannot provide both an Astro `i18n` configuration and a Starlight `locales` configuration." (mesmo arquivo, linhas 33–37; comportamento também descrito em [Starlight → i18n](https://starlight.astro.build/guides/i18n/), que diz que o Starlight "also supports configuring internationalization using the Astro's `i18n` config option").
- **A config é opcional no Astro:** a doc de i18n ([Internationalization](https://docs.astro.build/en/guides/internationalization/)) descreve exatamente o layout desejado com `prefixDefaultLocale: false` — default na raiz (`src/pages/index.astro`) e demais locales em subpastas (`src/pages/pt/index.astro`) — mas nada impede criar essas pastas **sem** a config; ela só adiciona helpers (`getRelativeLocaleUrl()`, `Astro.preferredLocale`, redirects). Para duas páginas, os helpers não pagam o custo de contaminar o Starlight.
- **O que fazer manualmente por ser sem config:** `<html lang="en">` / `<html lang="pt-BR">` no layout de cada página; `<link rel="alternate" hreflang="en" href="https://gambi.sh/">` + `hreflang="pt-BR"` → `/pt/` (+ `x-default`) no `<head>` das duas; link de troca de idioma na própria landing. As docs continuam monolíngues EN, intocadas.

## Recomendação (passo a passo integrado)

1. `bun x astro add react` em `apps/docs`; instalar `tailwindcss` + `@tailwindcss/vite` e adicionar o plugin em `vite.plugins` do `astro.config.mjs`.
2. `tsconfig.json` do app: adicionar `baseUrl: "."` e `paths: { "@/*": ["./src/*"] }`.
3. Remover `src/content/docs/index.mdx`, o override `Hero` no `astro.config.mjs` e `src/components/{Hero,Lander}.astro` (migrando a copy/mecânica do Lander para a landing nova).
4. Criar `src/styles/landing.css` com `@import "tailwindcss";` (ou a forma granular sem `preflight.css` se o teste visual dispensar o reset) — importado **apenas** pelo layout da landing.
5. `bun x shadcn@latest init` dentro de `apps/docs`; conferir `components.json` (`tailwind.config` vazio, `css: "src/styles/landing.css"`, `rsc: false`); `bun x shadcn@latest add <componentes>`.
6. Criar `src/pages/index.astro` (EN) e `src/pages/pt/index.astro` (PT-BR) compartilhando um layout `LandingLayout.astro` (que importa `landing.css`, seta `lang` e `hreflang`); dark-only via `class="dark"` ou tokens direto em `:root`.
7. **Não** adicionar `i18n` ao `astro.config.mjs` e **não** adicionar `locales` ao config do Starlight.
8. Validar: `bun run build` em `apps/docs` e conferir que as páginas de docs não referenciam o chunk CSS da landing (grep no `dist/` por classes do preflight/tokens shadcn nos HTML das docs).

## Fontes

- Código instalado (fonte primária): `apps/docs/node_modules/@astrojs/starlight/index.ts` (injectRoute `[...slug]`), `utils/i18n.ts` (processI18nConfig), `style/layers.css` (cascade layers).
- Starlight: <https://starlight.astro.build/guides/pages/> · <https://starlight.astro.build/guides/css-and-tailwind/> · <https://starlight.astro.build/guides/i18n/>
- Astro: <https://docs.astro.build/en/guides/routing/#route-priority-order> · <https://docs.astro.build/en/guides/styling/> · <https://docs.astro.build/en/guides/internationalization/>
- Tailwind v4: <https://tailwindcss.com/docs/preflight>
- shadcn: <https://ui.shadcn.com/docs/installation/astro> · <https://ui.shadcn.com/docs/components-json> · <https://ui.shadcn.com/docs/monorepo>
