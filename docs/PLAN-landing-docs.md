# Plano: Landing Page & Documentação Gambiarra

## Gerenciamento com BEADS

### Epic Principal
```bash
bd create --title="Landing Page & Docs Gambiarra" --type=epic --priority=1
```

### Issues Estruturadas (criar após aprovação)

**Fase 1 - Infraestrutura:**
```bash
bd create --title="Setup custom components structure in Starlight" --type=task --priority=1
bd create --title="Create design system CSS with variables" --type=task --priority=1
bd create --title="Create copy/check SVG icons" --type=task --priority=2
```

**Fase 2 - Landing Page Core:**
```bash
bd create --title="Implement Lander.astro hero section" --type=task --priority=1
bd create --title="Implement install commands with copy-to-clipboard" --type=task --priority=1
bd create --title="Implement features section" --type=task --priority=2
bd create --title="Create Hero.astro Starlight override" --type=task --priority=1
```

**Fase 3 - Landing Page Polish:**
```bash
bd create --title="Implement screenshots grid section" --type=task --priority=2
bd create --title="Implement How It Works section" --type=task --priority=2
bd create --title="Implement Use Cases section" --type=task --priority=2
bd create --title="Complete responsive design for all breakpoints" --type=task --priority=1
```

**Fase 4 - Documentação (paralelo):**
```bash
bd create --title="Create architecture/overview.md" --type=task --priority=1
bd create --title="Create troubleshooting/common-issues.md" --type=task --priority=2
bd create --title="Create guides/hackathon.md tutorial" --type=task --priority=2
bd create --title="Create guides/homelab.md tutorial" --type=task --priority=2
bd create --title="Expand quickstart.md with more detail" --type=task --priority=2
```

**Fase 5 - Assets:**
```bash
bd create --title="Create logo SVGs for light/dark mode" --type=task --priority=2
bd create --title="Capture TUI screenshots" --type=task --priority=2
bd create --title="Create architecture diagram SVG" --type=task --priority=3
```

### Dependências
```bash
# Hero depende de CSS setup
bd dep add <hero-id> <css-setup-id>

# Screenshots depende de Hero (estrutura base)
bd dep add <screenshots-id> <hero-id>

# Responsive depende de todas as sections
bd dep add <responsive-id> <screenshots-id>
```

---

## Visão Geral

Criar uma landing page elaborada e documentação completa para o Gambiarra, inspirado no opencode.ai mas com identidade visual própria que reflete o conceito de "gambiarra" - algo improvisado, criativo, e surpreendentemente funcional.

---

## 1. Direção Estética (Frontend Design)

### Conceito: "Improvised Excellence"

O nome **Gambiarra** (gíria brasileira para solução improvisada/hack criativo) inspira uma estética que é:

- **Industrial/Raw**: Bordas expostas, grades visíveis, estrutura aparente
- **Playful**: Cores vibrantes de destaque, elementos inesperados
- **Resourceful**: Sensação de "feito com o que tinha", mas funcional
- **Terminal-native**: Honra a origem CLI do projeto

### Paleta de Cores

```css
/* Light mode - tons quentes, papel envelhecido */
--color-bg: hsl(40, 30%, 97%);           /* Papel creme */
--color-text: hsl(20, 10%, 25%);          /* Marrom escuro */
--color-accent: hsl(25, 95%, 55%);        /* Laranja "gambiarra" */
--color-accent-alt: hsl(160, 70%, 40%);   /* Verde terminal */
--color-border: hsl(30, 15%, 75%);        /* Borda sutil */

/* Dark mode - terminal vintage */
--color-bg: hsl(200, 15%, 8%);            /* Azul escuro */
--color-text: hsl(45, 20%, 75%);          /* Âmbar suave */
--color-accent: hsl(25, 95%, 60%);        /* Laranja vibrante */
--color-accent-alt: hsl(120, 60%, 50%);   /* Verde CRT */
```

### Tipografia

- **Display**: `"JetBrains Mono"` ou `"IBM Plex Mono"` - monospace com personalidade
- **Body**: `"Inter"` ou `"Source Sans Pro"` - legibilidade
- **Code**: `"Fira Code"` com ligatures

### Elementos de Design

1. **Bordas Duplas** - Estilo "blueprint" ou "schematic"
2. **ASCII Art Sutil** - Decorações em caracteres
3. **Grid Assimétrico** - Layout que "quebra" levemente a simetria
4. **Scanlines/Noise** - Textura sutil de CRT/terminal vintage
5. **Glow Effects** - Em elementos interativos (hover states)

---

## 2. Estrutura de Arquivos

```
apps/docs/
├── astro.config.mjs              # Configurar componentes custom
├── src/
│   ├── assets/
│   │   ├── logo-light.svg        # Logo para tema claro
│   │   ├── logo-dark.svg         # Logo para tema escuro
│   │   ├── lander/
│   │   │   ├── copy.svg          # Ícone copiar
│   │   │   ├── check.svg         # Ícone sucesso
│   │   │   ├── screenshot-tui.png
│   │   │   ├── screenshot-sdk.png
│   │   │   └── diagram-arch.svg  # Diagrama de arquitetura
│   │   └── houston.webp          # (manter como fallback)
│   ├── components/
│   │   ├── Lander.astro          # Landing page customizada (~500 linhas)
│   │   ├── Hero.astro            # Override do Hero do Starlight
│   │   ├── CopyButton.astro      # Botão copy-to-clipboard reutilizável
│   │   └── FeatureCard.astro     # Card de feature customizado
│   ├── styles/
│   │   └── custom.css            # CSS customizado global
│   └── content/docs/
│       ├── index.mdx             # Landing page (usa Lander component)
│       ├── guides/
│       │   ├── quickstart.md     # (existente, melhorar)
│       │   ├── hackathon.md      # Tutorial: uso em hackathons
│       │   ├── homelab.md        # Tutorial: home lab setup
│       │   └── team.md           # Tutorial: times de dev
│       ├── reference/
│       │   ├── cli.md            # (existente, expandir)
│       │   └── sdk.md            # (existente, expandir)
│       ├── architecture/
│       │   ├── overview.md       # Como funciona (HTTP + SSE)
│       │   ├── components.md     # Hub, Room, Participant
│       │   └── flow.md           # Fluxos de comunicação
│       └── troubleshooting/
│           ├── common-issues.md  # Problemas comuns
│           └── faq.md            # Perguntas frequentes
```

---

## 3. Implementação da Landing Page

### 3.1 Seções da Landing

1. **Hero Section**
   - Logo animado (ASCII art estilizado do README)
   - Tagline: "Share local LLMs across your network, effortlessly."
   - CTA: "Get Started" + "View on GitHub"
   - Comando de instalação com copy-to-clipboard

2. **Install Methods Grid** (2x2)
   - curl (recomendado)
   - npm
   - bun
   - (futuro: homebrew)

3. **Features Section**
   - Cards com ícones customizados
   - Local-First / Resource Sharing / Universal Compat / AI SDK

4. **How It Works** (Diagrama interativo)
   - Visualização simplificada da arquitetura
   - Hub → Participants → SDK flow

5. **Use Cases** (Cards clicáveis)
   - Dev Teams / Hackathons / Research Labs / Home Labs / Education

6. **Screenshots Grid**
   - TUI em ação (grande, à esquerda)
   - SDK code example (direita, topo)
   - CLI output (direita, baixo)

7. **Footer**
   - Links: GitHub, Docs
   - Copyright

### 3.2 Componente Lander.astro

Estrutura similar ao opencode, mas com estética própria:

```astro
---
import { Image } from 'astro:assets';
import CopyIcon from "../assets/lander/copy.svg";
import CheckIcon from "../assets/lander/check.svg";
// ... imports

const commands = {
  curl: 'curl -fsSL https://raw.githubusercontent.com/arthurbm/gambiarra/main/scripts/install.sh | bash',
  npm: 'npm install -g gambiarra',
  bun: 'bun add -g gambiarra',
};
---

<div class="lander">
  <section class="hero">...</section>
  <section class="install">...</section>
  <section class="features">...</section>
  <section class="how-it-works">...</section>
  <section class="use-cases">...</section>
  <section class="screenshots">...</section>
  <section class="footer">...</section>
</div>

<style>
  /* ~400-500 linhas de CSS customizado */
</style>

<script>
  // Copy-to-clipboard functionality
</script>
```

### 3.3 Configuração Astro

```javascript
// astro.config.mjs
export default defineConfig({
  integrations: [
    starlight({
      title: "Gambiarra",
      customCss: ["./src/styles/custom.css"],
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: true,
      },
      components: {
        Hero: "./src/components/Hero.astro",
      },
      sidebar: [
        { label: "Home", slug: "" },
        {
          label: "Guides",
          items: [
            { label: "Quick Start", slug: "guides/quickstart" },
            { label: "For Hackathons", slug: "guides/hackathon" },
            { label: "For Home Labs", slug: "guides/homelab" },
            { label: "For Dev Teams", slug: "guides/team" },
          ],
        },
        {
          label: "Architecture",
          autogenerate: { directory: "architecture" },
        },
        {
          label: "Reference",
          autogenerate: { directory: "reference" },
        },
        {
          label: "Troubleshooting",
          autogenerate: { directory: "troubleshooting" },
        },
      ],
    }),
  ],
});
```

---

## 4. Conteúdo da Documentação

### 4.1 Guias (Tutorials/Use Cases)

**guides/hackathon.md**
- Setup rápido para evento de 24-48h
- Como compartilhar com equipe via mDNS
- Dicas de performance

**guides/homelab.md**
- Configurar servidor permanente
- Acessar de múltiplos dispositivos
- Segurança em rede local

**guides/team.md**
- Configuração para equipe de desenvolvimento
- Melhores práticas de compartilhamento
- Integração com workflows existentes

### 4.2 Arquitetura

**architecture/overview.md**
- Diagrama geral do sistema
- Por que HTTP + SSE (não WebSocket)
- Componentes principais

**architecture/components.md**
- Hub: O que faz, endpoints
- Room: Gerenciamento de participantes
- Participant: Registro, heartbeat

**architecture/flow.md**
- Fluxo de registro
- Fluxo de request SDK → Hub → Participant
- SSE para TUI

### 4.3 Troubleshooting

**troubleshooting/common-issues.md**
- Participant não aparece online
- Timeout de conexão
- Erros de CORS
- mDNS não funciona

**troubleshooting/faq.md**
- Posso usar em produção?
- Funciona com cloud LLMs?
- Como adicionar autenticação?

---

## 5. Assets a Criar

### 5.1 Logos
- [ ] Logo SVG light mode
- [ ] Logo SVG dark mode
- [ ] Favicon atualizado

### 5.2 Ícones
- [ ] copy.svg (ícone clipboard)
- [ ] check.svg (ícone sucesso)

### 5.3 Screenshots
- [ ] TUI rodando (captura real)
- [ ] Código SDK em editor
- [ ] Output CLI join/create

### 5.4 Diagramas
- [ ] Arquitetura geral (SVG)
- [ ] Fluxo de comunicação (SVG)

---

## 6. Fases de Implementação

### Fase 1: Infraestrutura (Foundation)
1. Criar estrutura de pastas (`components/`, `styles/`, `assets/lander/`)
2. Configurar `astro.config.mjs` com customCss e components
3. Criar `custom.css` com variáveis de design system
4. Criar ícones básicos (copy.svg, check.svg)

### Fase 2: Landing Page (Core)
1. Criar `Lander.astro` com estrutura básica
2. Implementar Hero section com ASCII logo
3. Implementar Install section com copy-to-clipboard
4. Implementar Features section
5. Criar `Hero.astro` override para usar Lander

### Fase 3: Landing Page (Polish)
1. Implementar Screenshots grid (com placeholders)
2. Implementar How It Works section
3. Implementar Use Cases section
4. Implementar Footer
5. Responsividade completa

### Fase 4: Documentação
1. Expandir `guides/quickstart.md`
2. Criar `architecture/overview.md`
3. Criar `troubleshooting/common-issues.md`
4. Criar guias de use cases

### Fase 5: Assets & Polish
1. Capturar screenshots reais
2. Criar diagramas de arquitetura
3. Criar logos finais
4. Testar todos os breakpoints
5. Verificar dark/light mode

---

## 7. Verificação

### Testes Manuais
```bash
# Rodar dev server
cd apps/docs
bun run dev

# Verificar:
# - Landing page carrega
# - Copy-to-clipboard funciona
# - Dark/light mode funcionam
# - Responsivo em mobile (DevTools)
# - Todos os links funcionam
# - Sidebar correta
```

### Build Test
```bash
bun run build
bun run preview
```

### Checklist Final
- [ ] Landing page visualmente distinta (não "AI slop")
- [ ] Copy-to-clipboard funciona em todos os comandos
- [ ] Screenshots/placeholders presentes
- [ ] Documentação navegável
- [ ] Mobile responsive
- [ ] Dark mode funcional
- [ ] Sem erros no console
- [ ] Links externos com rel="noopener"

---

## 8. Arquivos Críticos a Modificar

| Arquivo | Ação |
|---------|------|
| `apps/docs/astro.config.mjs` | Adicionar customCss, components, sidebar expandida |
| `apps/docs/src/content/docs/index.mdx` | Integrar com Lander component |
| `apps/docs/src/styles/custom.css` | **CRIAR** - Design system |
| `apps/docs/src/components/Lander.astro` | **CRIAR** - Landing page |
| `apps/docs/src/components/Hero.astro` | **CRIAR** - Override Starlight Hero |
| `apps/docs/src/content/docs/architecture/overview.md` | **CRIAR** - Arquitetura |
| `apps/docs/src/content/docs/troubleshooting/common-issues.md` | **CRIAR** - Problemas comuns |

---

## Notas

- Priorizar landing page funcional antes de polish
- Screenshots podem ser placeholders inicialmente
- Documentação de arquitetura pode referenciar `docs/architecture.md` existente
- Manter compatibilidade com Starlight para facilitar manutenção
