<p align="center">
  <img src="assets/polvo-logo.svg" width="140" alt="Polvo">
</p>

<h1 align="center">Polvo</h1>

<p align="center"><b>Seus agentes de IA, lado a lado.</b><br>
Claude Code, Codex, OpenCode e shells num organizador nativo, leve e bonito para Windows.<br>
Um braço para cada agente. 🐙</p>

<p align="center">
  <a href="https://github.com/felipeelopes/polvo/releases/latest">Baixar</a> ·
  <a href="#recursos">Recursos</a> ·
  <a href="docs/ARCHITECTURE.md">Arquitetura</a> ·
  <a href="CONTRIBUTING.md">Contribuir</a> ·
  <a href="#english">English</a>
</p>

---

## Por que o Polvo?

Rodar vários agentes ao mesmo tempo vira uma bagunça de abas e janelas. O Polvo junta tudo num só lugar:

- **Painéis que você arrasta e encaixa** em qualquer posição, com divisórias inteligentes.
- **Reabre exatamente como você deixou**: cada conversa é retomada pelo próprio CLI (`claude --resume`, `codex resume`, `opencode --session`).
- **Limites de uso à vista**: janela de 5h e semanal do Claude e do Codex, custo do OpenCode.
- **Quadro por status**: veja de relance quem está trabalhando e quem está **aguardando você**.

## Recursos

| | |
|---|---|
| 🧩 **Painéis** | Arraste pelo cabeçalho e solte na borda de outro painel para dividir, no centro para trocar, na borda da área para uma coluna/linha inteira. |
| 📐 **Resize inteligente** | Ímã em ⅓, ½ e ⅔, alinhamento com outras divisórias, divisórias alinhadas que se movem juntas, tamanho mínimo garantido e colunas × linhas do terminal ao vivo. |
| ⚡ **Facilitadores** | Grade, principal + pilha, colunas, linhas, igualar, desfazer, maximizar, atalhos de teclado. |
| 🗂️ **Quadro** | Kanban automático: *Aguardando você*, *Trabalhando*, *Ocioso*, com prévia ao vivo e gaveta para abrir a sessão. |
| 🖥️ **Várias janelas** | Abra quantas janelas quiser e leve cada uma para o monitor certo. Abrir o Polvo de novo cria outra janela. |
| 🔁 **Retomada automática** | Ao abrir, todas as janelas voltam no mesmo monitor e cada sessão continua a mesma conversa. |
| 📊 **Limites de uso** | Claude com dois anéis (semanal por fora, 5h por dentro), Codex (arquivos de sessão), OpenCode (`opencode stats`). |
| 🧠 **Contexto por sessão** | Cada painel mostra quanto da janela de contexto a conversa já usou. |
| 🎛️ **Fornecedores** | Desative Claude, Codex ou OpenCode mesmo que estejam instalados. |
| 🚀 **Inicia com o Windows** e **atualiza sozinho** a partir das releases do GitHub. |

## Instalação

1. Baixe o instalador `.exe` da [última release](https://github.com/felipeelopes/polvo/releases/latest).
2. Tenha pelo menos um dos CLIs no `PATH`: [Claude Code](https://docs.claude.com/claude-code), [Codex CLI](https://github.com/openai/codex) ou [OpenCode](https://opencode.ai). O PowerShell funciona sempre.
3. Abra o Polvo e responda às 3 perguntas do onboarding.

Requer Windows 10 ou 11 (o efeito Mica aparece no Windows 11).

## Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl+Shift+N` | Nova sessão |
| `Ctrl+Shift+T` | Terminal (PowerShell) na pasta da sessão ativa |
| `Ctrl+Shift+1` / `Ctrl+Shift+2` | Painéis / Quadro |
| `Ctrl+Alt+←↑→↓` | Mover o foco entre painéis |
| `Ctrl+Alt+Shift+←↑→↓` | Trocar o painel de lugar |
| `Ctrl+Shift+M` | Maximizar / restaurar o painel |
| `Ctrl+Shift+Z` | Desfazer layout |
| `Ctrl+C` com seleção · `Ctrl+V` · botão direito | Copiar · colar · copiar/colar |

## Como funciona

- **Tauri 2** (Rust + WebView2): instalador pequeno e pouca memória.
- **ConPTY** via [`portable-pty`](https://crates.io/crates/portable-pty): cada sessão é um terminal real.
- **xterm.js** (WebGL) renderiza o terminal, com o tema do app.
- O backend guarda as sessões em `%APPDATA%\Polvo\workspace.json` e descobre os ids de cada CLI para retomar depois.

Detalhes em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Desenvolvimento

Pré-requisitos: [Rust](https://rustup.rs) (toolchain MSVC), [Node 20+](https://nodejs.org), [pnpm](https://pnpm.io) e as Build Tools do Visual Studio (C++).

```powershell
pnpm install
pnpm app:dev      # abre o app com recarregamento automático
pnpm test         # testes do motor de layout
pnpm check        # typecheck + testes + rustfmt + clippy
pnpm app:build    # gera os instaladores em src-tauri/target/release/bundle
pnpm release      # compila, assina e publica a release no GitHub (veja docs/RELEASING.md)
```

Contribuições são muito bem-vindas: leia o [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- [ ] Arrastar uma sessão diretamente de uma janela para outra
- [ ] Temas (claro, alto contraste) e fonte configurável
- [ ] Notificações do Windows quando um agente pedir sua atenção
- [ ] Perfis personalizados (modelo, variáveis de ambiente, WSL)
- [ ] Enviar o mesmo prompt para várias sessões

## Licença

[MIT](LICENSE). Polvo é um projeto independente, sem vínculo com Anthropic, OpenAI ou OpenCode.

---

<a id="english"></a>

## English

**Polvo** (Portuguese for *octopus*) is a native Windows app that runs Claude Code, Codex, OpenCode and shells side by side in draggable, snapping panes. It reopens every session exactly where you left off (using each CLI's own resume), shows plan usage limits and per-session context usage at a glance, offers a status board (*waiting for you* / *working* / *idle*), supports as many windows as you want across monitors, starts with Windows and updates itself from GitHub releases. Built with Tauri 2, Rust, ConPTY and xterm.js. MIT licensed. Contributions welcome!
