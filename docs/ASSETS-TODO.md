# Assets Pendentes

Assets que precisam ser criados/adicionados para a landing page e documentação.

## Localização

Todos os assets da landing page devem ir em:
```
apps/docs/src/assets/lander/
```

## Assets Necessários

### Screenshots (Prioridade Alta)

| Arquivo | Descrição | Uso |
|---------|-----------|-----|
| `screenshot-tui.png` | TUI rodando com participantes ativos | Landing page - seção screenshots |
| `screenshot-cli.png` | Output do CLI (join, create, list) | Landing page e docs |
| `screenshot-sdk.png` | Código SDK em editor com syntax highlight | Landing page - seção screenshots |

### Logos (Opcional)

| Arquivo | Descrição | Uso |
|---------|-----------|-----|
| `logo-light.svg` | Logo para tema claro | Header do site (se quiser substituir texto) |
| `logo-dark.svg` | Logo para tema escuro | Header do site (se quiser substituir texto) |

### Diagramas (Opcional)

| Arquivo | Descrição | Uso |
|---------|-----------|-----|
| `diagram-arch.svg` | Diagrama de arquitetura vetorial | Docs de arquitetura (já tem ASCII art) |

## Como Capturar Screenshots

### TUI
```bash
cd apps/tui
bun run dev <ROOM_CODE>
# Capturar com ferramenta de screenshot do sistema
```

### CLI
```bash
# Gravar output colorido
gambiarra serve --port 3000
gambiarra create
gambiarra join <CODE> --endpoint http://localhost:11434 --model llama3 --nickname demo
gambiarra list
```

## Depois de Adicionar

1. Atualizar `Lander.astro` para importar e usar os screenshots
2. A seção de screenshots já está preparada no código, só precisa descomentar/ativar

## Estrutura Atual

```
apps/docs/src/assets/
├── houston.webp          # Asset padrão do Starlight (pode remover depois)
└── lander/
    ├── check.svg         # ✓ Ícone de sucesso (já existe)
    └── copy.svg          # ✓ Ícone de copiar (já existe)
```
