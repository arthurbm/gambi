# Landing custom em `apps/docs`: Tailwind v4 + React islands + shadcn sem afetar o Starlight, com `/` (EN) e `/pt` (PT-BR)

> Pesquisa para a issue #61. Fontes primárias: docs oficiais (Astro, Starlight, Tailwind v4, shadcn) e o código-fonte instalado em `apps/docs/node_modules/@astrojs/starlight` (que é fonte primária do comportamento real). Data: 2026-08-16.

## Contexto: estado atual de `apps/docs`

Versões instaladas (verificadas em `node_modules`, não só no `package.json`):

- `astro` **5.16.6** (`apps/docs/node_modules/astro/package.json`; range declarado `^5.6.1`)
- `@astrojs/starlight` **0.37.1** (`apps/docs/node_modules/@astrojs/starlight/package.json`)
- `starlight-llms-txt` ^0.8.0; **sem** React, Tailwind ou shadcn hoje.

Estrutura relevante:

- Splash atual: `apps/docs/src/content/docs/index.mdx` (`template: splash`) — o corpo é vazio; o conteúdo real vem do override de Hero.
- Override: `apps/docs/src/components/Hero.astro`, registrado em `apps/docs/astro.config.mjs` via `components: { Hero: ... }`. Quando `slug === ""` renderiza `apps/docs/src/components/Lander.astro`; senão, o Hero default.
- `apps/docs/src/styles/custom.css` (via `customCss` do Starlight) contém, além do tema das docs, hacks específicos da landing (`:root[data-has-hero] header.header { display: none }` etc.).
- `apps/docs/tsconfig.json` estende `astro/tsconfigs/strict`, **sem** `baseUrl`/`paths`.
- Monorepo: bun workspaces (`apps/*`, `packages/*`) + turbo (`turbo.json` com tasks `build`/`dev`/`check-types`), `packageManager: bun@1.3.13`. As dependências do `apps/docs` ficam em `apps/docs/node_modules` (não hoisted na raiz).
- Existem diretórios vazios `src/components/ui` e `src/lib` (aparentemente preparados para shadcn).

---

## 1. Rota `/`: o Starlight cede a rota para `src/pages/index.astro`?

**Resposta direta: sim.** O Starlight registra todas as suas páginas por uma única rota injetada com rest parameter (`[...slug]`). Pela ordem de prioridade de rotas do Astro, uma rota estática de arquivo (`src/pages/index.astro`) vence um rest parameter. Basta criar `src/pages/index.astro` e **remover `src/content/docs/index.mdx`** (senão ambas as rotas geram `/`, criando uma colisão que o Astro resolve por prioridade, mas deixa conteúdo morto e warning no build).

### Evidência no código-fonte (fonte primária)

`apps/docs/node_modules/@astrojs/starlight/index.ts` (linhas 87–93):

```ts
injectRoute({
  pattern: '[...slug]',
  entrypoint: starlightConfig.prerender
    ? '@astrojs/starlight/routes/static/index.astro'
    : '@astrojs/starlight/routes/ssr/index.astro',
  prerender: starlightConfig.prerender,
});
```

A rota estática (`routes/static/index.astro`) usa `getStaticPaths()` sobre a content collection `docs`; o `index.mdx` raiz vira slug `""` → param `undefined` → gera o path `/` (`utils/routing/index.ts`, `normalizeIndexSlug` + `slugToParam`). Ou seja: **quem hoje gera `/` é a rota `[...slug]` do Starlight alimentada pelo `index.mdx`** — remova o `index.mdx` e o Starlight simplesmente deixa de gerar `/`.

### Prioridade de rotas do Astro

A doc oficial de routing ([docs.astro.build/en/guides/routing/#route-priority-order](https://docs.astro.build/en/guides/routing/#route-priority-order)) define, entre outras regras: "Static routes without path parameters will take precedence over dynamic routes" e "Dynamic routes using named parameters take precedence over rest parameters". `src/pages/index.astro` é estática; `[...slug]` é rest — a página custom vence sempre. Rotas injetadas por integrações são ordenadas pelas mesmas regras que rotas de arquivo. Quando duas rotas geram a mesma URL, a de maior prioridade produz o HTML (uma só saída por path), mas manter as duas é desnecessário e confuso.

### O Starlight suporta isso oficialmente

O guia "Pages" do Starlight ([starlight.astro.build/guides/pages/](https://starlight.astro.build/guides/pages/)) documenta "Custom pages": "For advanced use cases, you can add custom pages by creating a `src/pages/` directory", usando o file-based routing do Astro. O mesmo guia documenta o componente `<StarlightPage>` ("Use Starlight's design in custom pages") — útil se quiséssemos o layout das docs na página custom, o que **não** é o caso aqui (landing 100% custom). Observação prática do código: `vitePluginStarlightCssLayerOrder` (em `integrations/vite-layer-order.ts`) só atua em arquivos que importam `StarlightPage.astro`; uma página custom que não importa nada do Starlight não recebe nenhum CSS do Starlight.

### Consequências no repo

- `src/content/docs/index.mdx` **sai**.
- O override `Hero.astro` perde a função para a landing (o branch `slug === ""` nunca mais executa). Pode-se remover o override (e a entrada `components:` no `astro.config.mjs`) e mover o conteúdo de `Lander.astro` para a nova página; os demais docs voltam ao Hero default (nenhum outro doc usa `hero` no frontmatter hoje).
- Os hacks `:root[data-has-hero] { ... }` em `custom.css` (linhas 245–262) ficam obsoletos e devem ser removidos.

---

## 2. Preflight do Tailwind v4: como não vazar no Starlight

**Resposta direta: o isolamento vem de graça se o CSS do Tailwind for importado apenas no grafo de módulos das páginas da landing.** O Astro só entrega um CSS importado nas páginas que o alcançam via imports; as páginas Starlight nunca importam o `landing.css`, então o Preflight não chega a elas. Não é preciso prefixo, `important`, nem escopar o Preflight num seletor. Como segunda linha de defesa, o Starlight 0.37 coloca todos os seus estilos em cascade layers `starlight.*`, e há receita oficial de coexistência com Tailwind v4 caso um dia os dois CSS se encontrem na mesma página.

### 2.1 Como o Astro escopa CSS importado

Doc oficial de styling ([docs.astro.build/en/guides/styling/](https://docs.astro.build/en/guides/styling/)): "Importing a component applies any CSS it imports, even if the component is never used" — ou seja, o CSS "vaza" **dentro do grafo de imports de uma página**, não para o site inteiro. Em produção: "Each page on your site gets its own chunk, and additionally, CSS that is shared between multiple pages is further split off into their own chunks for reuse." O `<link>`/`<style>` do bundle só é injetado nas páginas cujo grafo contém aquele CSS. Conclusão prática: importar `src/styles/landing.css` **somente** em `src/pages/index.astro` e `src/pages/pt/index.astro` (ou num `LandingLayout.astro` usado só por elas) garante que nenhuma página `/guides/...` recebe Tailwind. O cuidado é disciplina: nunca importar `landing.css` (nem componentes que o importem) em nada compartilhado com docs.

### 2.2 O que `@import "tailwindcss"` expande

Doc do Preflight ([tailwindcss.com/docs/preflight](https://tailwindcss.com/docs/preflight)):

```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/preflight.css" layer(base);
@import "tailwindcss/utilities.css" layer(utilities);
```

O Preflight vive na layer `base`. Para desativá-lo, importa-se seletivamente só `theme.css` + `utilities.css` (mesma página da doc). Para a landing queremos o Preflight completo — e podemos tê-lo, porque o CSS não alcança as docs.

### 2.3 Mitos e modificadores verificados

- **`source(...)` existe, mas não é escopo de CSS.** Doc oficial ([tailwindcss.com/docs/detecting-classes-in-source-files](https://tailwindcss.com/docs/detecting-classes-in-source-files)): `@import "tailwindcss" source("../src")` define o diretório-base do **scanning de classes nos templates**; `source(none)` desliga a detecção automática (combinado com `@source`). Útil aqui para o CSS da landing não gerar utilities a partir de classes que aparecem em `src/content/docs/**` — ex.: `@import "tailwindcss" source(none);` + `@source "../pages"; @source "../components/landing";`. Não tem nenhum efeito sobre onde o Preflight se aplica.
- **`prefix(tw)`** existe como modificador de import ([tailwindcss.com/docs/upgrade-guide](https://tailwindcss.com/docs/upgrade-guide)): `@import "tailwindcss" prefix(tw);` — desnecessário aqui, e incompatível com componentes shadcn sem retrabalho (as classes viram `tw:flex`).
- **`important`**: na v4 o mecanismo documentado no upgrade guide é o sufixo `!` por classe (`flex!`); não é necessário para este caso.
- **`@reference`** ([tailwindcss.com/docs/functions-and-directives](https://tailwindcss.com/docs/functions-and-directives)): permite usar `@apply`/variants num `<style>` de componente sem duplicar CSS — útil se algum componente Astro da landing quiser `@apply`.

### 2.4 O que o Starlight oficialmente recomenda para Tailwind — e por que não precisamos

O guia "CSS & Styling" ([starlight.astro.build/guides/css-and-tailwind/](https://starlight.astro.build/guides/css-and-tailwind/)) documenta o pacote `@astrojs/starlight-tailwind` com este CSS:

```css
@layer base, starlight, theme, components, utilities;
@import '@astrojs/starlight-tailwind';
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
```

Repare que essa receita **omite o Preflight** e reordena as layers para que as do Starlight fiquem entre `base` e `theme`. Ela existe para quem quer usar utilities do Tailwind **dentro das páginas de docs**. Não é o nosso caso: não queremos tocar o CSS das docs, então **não** instalamos `@astrojs/starlight-tailwind` e não alteramos `custom.css`. O fato relevante que ela evidencia: o Starlight 0.37 encapsula tudo em cascade layers — confirmado no código instalado, `apps/docs/node_modules/@astrojs/starlight/style/layers.css`:

```css
@layer starlight.base, starlight.reset, starlight.core, starlight.content, starlight.components, starlight.utils;
```

Estilos em layer perdem para estilos sem layer; por isso o `custom.css` do projeto (sem layer) já sobrepõe o Starlight hoje, e por isso, mesmo num cenário hipotético de CSS compartilhado, o conflito seria administrável por ordem de layers. Mas com o escopo por página (2.1), esse cenário nem ocorre.

### 2.5 Plugin oficial

Astro ≥ 5.2 usa o plugin Vite oficial: "use the `astro add tailwind` command ... to install the official Vite Tailwind plugin" (`@tailwindcss/vite`) e importar `@import "tailwindcss";` num arquivo CSS ([docs.astro.build/en/guides/styling/](https://docs.astro.build/en/guides/styling/#add-tailwind-4); também [tailwindcss.com/docs/upgrade-guide](https://tailwindcss.com/docs/upgrade-guide) recomenda o plugin Vite sobre PostCSS). O plugin entra em `vite.plugins` no `astro.config.mjs` e só transforma o CSS que usa Tailwind — o `custom.css` do Starlight não é afetado.

---

## 3. shadcn em Astro + monorepo bun

**Resposta direta: usar o guia oficial "Astro" do shadcn rodando o CLI dentro de `apps/docs` (tratando-o como projeto standalone), não o setup "Monorepo" — este assume Turborepo com um package `ui` compartilhado (`@workspace/ui`), overhead injustificado para uma landing.** Pré-requisitos: Tailwind configurado, `@astrojs/react`, e alias `@/*` no tsconfig. `bunx shadcn@latest init` gera `components.json`, `src/lib/utils.ts` (`cn`) e injeta os tokens CSS no arquivo apontado em `tailwind.css`.

### 3.1 O que o guia Astro do shadcn pede ([ui.shadcn.com/docs/installation/astro](https://ui.shadcn.com/docs/installation/astro))

Para projeto Astro existente:

1. Tailwind CSS configurado (v4 via `@tailwindcss/vite`, seção 2.5) e um CSS global importado pelo layout — no nosso caso, `src/styles/landing.css` importado só pelo layout da landing.
2. React habilitado (`bunx astro add react` → instala `@astrojs/react`, `react`, `react-dom` e adiciona a integração).
3. Alias no `apps/docs/tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

4. `bunx shadcn@latest init` (o guia usa `pnpm dlx`; `bunx` é o equivalente bun). Há também `init -t astro` e a flag `--monorepo` para os templates novos, mas para projeto existente o `init` simples com respostas interativas basta.
5. `bunx shadcn@latest add button` etc. Os componentes caem em `src/components/ui/` (os diretórios `ui/` e `lib/` já existem vazios no repo).

### 3.2 `components.json` para Tailwind v4 ([ui.shadcn.com/docs/components-json](https://ui.shadcn.com/docs/components-json))

A doc é explícita: para Tailwind v4, `tailwind.config` fica **vazio** ("For Tailwind CSS v4, leave this blank."). Alvo esperado:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "tailwind": {
    "config": "",
    "css": "src/styles/landing.css",
    "cssVariables": true
  },
  "rsc": false,
  "tsx": true,
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "utils": "@/lib/utils"
  }
}
```

(`rsc: false` — Astro não tem React Server Components; o init detecta isso no template Astro.)

### 3.3 O que o guia de monorepo assume ([ui.shadcn.com/docs/monorepo](https://ui.shadcn.com/docs/monorepo))

Estrutura Turborepo com `apps/web` + `packages/ui`, dois `components.json` com aliases `"ui": "@workspace/ui/components"` e a exigência de "same `style`, `iconLibrary` and `baseColor` in both `components.json` files"; o CLI roda "in the path of your app" e resolve para onde vai cada arquivo. Os templates cobrem "Next.js, Vite, TanStack Start, React Router, Astro". **Avaliação para o gambi**: só faria sentido se outra app do monorepo fosse consumir os mesmos componentes React; hoje não há (a TUI é terminal). Rodar o CLI com cwd em `apps/docs` ignora o resto do monorepo — o bun instala as deps no workspace correto normalmente (declarar `react`/`react-dom`/`tailwindcss` etc. no `apps/docs/package.json`).

### 3.4 React islands

Com `@astrojs/react`, componentes React usados num `.astro` são estáticos por padrão; interatividade exige diretiva de cliente: `client:load`, `client:visible`, `client:idle` etc. ([docs.astro.build/en/guides/framework-components/](https://docs.astro.build/en/guides/framework-components/), seção "Hydrating interactive components"). Para uma landing, `client:visible` nos blocos interativos abaixo da dobra e `client:load` só no que precisa ser interativo de imediato. Componentes shadcn puramente visuais (Card, Badge, Button como link) podem ficar sem diretiva — zero JS.

### 3.5 Tokens do shadcn (`--background`, `--primary`, ...) vs Starlight

O `init` injeta variáveis em `:root` e `.dark` **no CSS apontado pelo `components.json`** — ou seja, dentro de `landing.css`, que só carrega nas páginas da landing (seção 2.1). Não há colisão com as docs: os nomes nem se sobrepõem (`--sl-*` no Starlight, `--gambi-*` no custom.css). Não é preciso escopar sob um wrapper. Dois cuidados:

- **Dark mode**: shadcn usa a classe `.dark`; o Starlight usa `[data-theme="dark"]` + `localStorage`. A landing é standalone e pode adotar a estratégia que quiser; para consistência com quem navega entre landing e docs, uma opção simples é um script inline que replica a lógica do Starlight (ler `starlight-theme` do localStorage / `prefers-color-scheme`) e aplicar `.dark` no `<html>` da landing, ou definir `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));` no CSS da landing e usar o mesmo atributo.
- **Fontes/base**: a landing não recebe `custom.css`, então tipografia e cores do design system Gambi precisam ser redeclaradas (ou extraídas para um arquivo de tokens compartilhado importado pelos dois CSS — tokens são só variáveis, sem risco de Preflight).

---

## 4. i18n: `/` (EN) + `/pt` (PT-BR) sem localizar as docs

**Resposta direta: NÃO configurar `i18n` no `astro.config.mjs`.** O código instalado prova que o Starlight lê o `i18n` do Astro e o adota como sua própria configuração de i18n — com `locales: ["en", "pt"]` as docs virariam multilíngues (language picker + páginas `/pt/guides/...` de fallback com aviso de "não traduzido"). A abordagem correta aqui é a manual: `src/pages/index.astro` + `src/pages/pt/index.astro`, sem nenhuma config.

### 4.1 Evidência no código-fonte (fonte primária)

`apps/docs/node_modules/@astrojs/starlight/utils/i18n.ts`, `processI18nConfig` (chamada em `index.ts` linha 67 com o `config.i18n` do Astro):

```ts
// We don't know what to do if both an Astro and Starlight i18n configuration are provided.
if (astroI18nConfig && !starlightConfig.isUsingBuiltInDefaultLocale) {
  throw new AstroError(
    'Cannot provide both an Astro `i18n` configuration and a Starlight `locales` configuration.', ...);
} else if (astroI18nConfig) {
  // If a Starlight compatible Astro i18n configuration is provided, we generate the matching
  // Starlight configuration.
  return { astroI18nConfig, starlightConfig: { ...starlightConfig, ...getStarlightI18nConfig(astroI18nConfig) } };
}
```

E em `getStarlightI18nConfig`: `const isMultilingual = astroI18nConfig.locales.length > 1;` — com `["en", "pt"]` e `prefixDefaultLocale: false`, o `en` vira locale `root` e `pt` vira um locale do Starlight. Consequências documentadas no guia i18n do Starlight ([starlight.astro.build/guides/i18n/](https://starlight.astro.build/guides/i18n/)): language picker na UI e fallback — "If a translation is not yet available for a language, Starlight will show readers the content for that page in the default language ... with a notice that this page has not yet been translated" ("This content is not available in your language yet."). Ou seja, o build passaria a gerar `/pt/guides/quickstart/` etc. para **todas** as docs, em inglês com banner — exatamente o que não queremos. O mesmo guia confirma: "Starlight also supports configuring internationalization using the Astro's `i18n` config option" — configurar o Astro i18n **é** ativar o i18n do Starlight, não um caminho paralelo. (`routing: "manual"` do Astro tampouco escapa: o mesmo arquivo lança `Starlight is not compatible with the 'manual' routing option`.)

### 4.2 Abordagem manual (recomendada)

A doc de i18n do Astro ([docs.astro.build/en/guides/internationalization/](https://docs.astro.build/en/guides/internationalization/)) confirma que a config não é obrigatória para ter pastas por idioma: pode-se simplesmente criar `src/pages/pt/index.astro` — file-based routing puro. O que se perde sem a config: helpers (`getRelativeLocaleUrl`, `Astro.currentLocale`, `Astro.preferredLocale`), redirects automáticos e fallback entre locais. Para exatamente duas páginas estáticas isso é irrelevante: links hardcoded `/` ↔ `/pt/`, e SEO resolvido com `<link rel="alternate" hreflang="en" href="https://gambi.sh/">` / `hreflang="pt-BR"` + `hreflang="x-default"` e `lang` correto no `<html>` de cada página.

### 4.3 Comparação

| | `i18n` no astro.config | Manual (`src/pages/pt/`) |
|---|---|---|
| Docs Starlight | **Viram multilíngues** (picker, fallback `/pt/...` para todas as docs) | Intactas, só EN |
| Helpers/redirects | Sim | Não (desnecessário p/ 2 páginas) |
| Risco | Alto — muda contrato de URLs das docs, sitemap, pagefind | Nenhum |
| Veredito | Descartar | **Recomendado** |

Se um dia as docs forem traduzidas de verdade, aí sim ativa-se o i18n (via Starlight `locales` OU Astro `i18n`, nunca ambos) e a landing `pt` já estará no lugar que o Astro espera (`src/pages/pt/`).

---

## Recomendação: passo-a-passo integrado

1. **Dependências** (em `apps/docs`): `bun add tailwindcss @tailwindcss/vite react react-dom` e `bun add -d @types/react @types/react-dom`; `bunx astro add react` (ou adicionar `@astrojs/react` manualmente à lista `integrations`). Adicionar `tailwindcss()` a `vite.plugins` no `astro.config.mjs` (ao lado do `ssr.noExternal` existente). **Não** instalar `@astrojs/starlight-tailwind`.
2. **tsconfig**: adicionar `baseUrl: "."` e `paths: { "@/*": ["./src/*"] }` em `apps/docs/tsconfig.json`.
3. **CSS da landing**: criar `apps/docs/src/styles/landing.css` com `@import "tailwindcss" source(none);` + `@source` apontando só para os diretórios da landing (páginas + componentes da landing), para as classes das docs não inflarem o bundle. Não tocar em `src/styles/custom.css` (exceto limpeza do passo 6).
4. **shadcn**: `cd apps/docs && bunx shadcn@latest init` → `tailwind.css: src/styles/landing.css`, `tailwind.config` vazio (v4), `cssVariables: true`, aliases `@/components` / `@/lib/utils`. Depois `bunx shadcn@latest add <componentes>`. Ignorar o setup de monorepo do shadcn (Turborepo/`@workspace/ui`) — sem consumidor compartilhado, é overhead.
5. **Páginas**: criar `src/layouts/LandingLayout.astro` (documento HTML completo, importa `landing.css`, define `<html lang>`, hreflang alternates, aplica estratégia de dark mode compatível com o localStorage do Starlight) e `src/pages/index.astro` (EN) + `src/pages/pt/index.astro` (PT-BR) usando esse layout. Migrar o conteúdo de `src/components/Lander.astro` para cá, agora com Tailwind/shadcn e React islands (`client:visible` por padrão, `client:load` só quando necessário). **Nenhuma config `i18n` no astro.config.**
6. **Limpeza do splash antigo**: remover `src/content/docs/index.mdx`, `src/components/Hero.astro`, `src/components/Lander.astro` e a entrada `components: { Hero: ... }` do `astro.config.mjs`; apagar o bloco `:root[data-has-hero] { ... }` de `custom.css`.
7. **Validação**: `bun run --cwd apps/docs build` (roda dentro do turbo também via `turbo -F docs build`) e conferir em `dist/`: `index.html` e `pt/index.html` são a landing (com o CSS do Tailwind linkado só nelas), `guides/...`/`reference/...` intactos sem nenhum chunk do Tailwind; navegação landing → docs pelo header/links. O Pagefind (busca das docs) indexa apenas páginas com `data-pagefind-body` (que o Starlight põe nas docs), então a landing fica fora da busca automaticamente. Conferir também o `llms.txt` gerado pelo `starlight-llms-txt` (ele opera sobre a collection de docs; a remoção do `index.mdx` tira o splash vazio do índice, sem perda real).

## Fontes

**Código-fonte instalado (fonte primária do comportamento real):**

- `/home/arthur/Documents/PESSOAL/GAMBIARRA-CLUB/gambi/apps/docs/node_modules/@astrojs/starlight/index.ts` — `injectRoute('[...slug]')`, chamada de `processI18nConfig`, `vitePluginStarlightCssLayerOrder`.
- `.../@astrojs/starlight/utils/i18n.ts` — erro ao combinar Astro i18n + Starlight locales; geração de config Starlight a partir do Astro i18n (`isMultilingual`).
- `.../@astrojs/starlight/utils/routing/index.ts` e `routes/static/index.astro` — geração do path `/` a partir do `index.mdx`.
- `.../@astrojs/starlight/style/layers.css` — cascade layers `starlight.*`.

**Docs oficiais:**

- Astro routing (prioridade de rotas): https://docs.astro.build/en/guides/routing/#route-priority-order
- Astro styling (bundling/escopo de CSS importado, Tailwind 4): https://docs.astro.build/en/guides/styling/
- Astro i18n: https://docs.astro.build/en/guides/internationalization/
- Astro framework components (client directives): https://docs.astro.build/en/guides/framework-components/
- Starlight pages (custom pages, `<StarlightPage>`): https://starlight.astro.build/guides/pages/
- Starlight CSS & Tailwind: https://starlight.astro.build/guides/css-and-tailwind/
- Starlight i18n: https://starlight.astro.build/guides/i18n/
- Tailwind v4 Preflight: https://tailwindcss.com/docs/preflight
- Tailwind v4 detecção de classes / `source()`: https://tailwindcss.com/docs/detecting-classes-in-source-files
- Tailwind v4 upgrade guide (`prefix()`, `!`, plugin Vite): https://tailwindcss.com/docs/upgrade-guide
- Tailwind v4 functions & directives (`@reference`, `@source`): https://tailwindcss.com/docs/functions-and-directives
- shadcn Astro: https://ui.shadcn.com/docs/installation/astro
- shadcn monorepo: https://ui.shadcn.com/docs/monorepo
- shadcn components.json (Tailwind v4): https://ui.shadcn.com/docs/components-json
