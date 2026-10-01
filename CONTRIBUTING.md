# Contribuindo com o Polvo

Obrigado por querer ajudar! 🐙 Toda contribuição conta: bugs, ideias, código, documentação e traduções.

## Antes de começar

- Bugs e ideias: abra uma [issue](https://github.com/felipeelopes/polvo/issues) usando os modelos.
- Mudanças grandes: comente na issue antes, para combinarmos a abordagem.

## Ambiente

1. Instale [Rust](https://rustup.rs) (toolchain `stable-msvc`), [Node 20+](https://nodejs.org), [pnpm](https://pnpm.io) e as Build Tools do Visual Studio com a carga "Desenvolvimento para desktop com C++".
2. `pnpm install`
3. `pnpm app:dev`

Para depurar a interface, abra o DevTools com `Ctrl+Shift+I` (somente em builds de desenvolvimento).

## Organização do código

```
src/                  Frontend (TypeScript, sem framework)
  core/               Estado, tipos, IPC e o motor de layout (funções puras)
  terminal/           xterm.js, conexão com o PTY e detecção de status
  ui/                 Componentes: barra de título, trilho, painéis, quadro, diálogos
  styles/             CSS por área
src-tauri/src/        Backend (Rust)
  pty.rs              Pseudo-terminais (ConPTY) e histórico para reconectar
  registry.rs         Sessões: criar, retomar, persistir, eventos
  tools.rs            Como iniciar/retomar cada CLI
  discovery.rs        Descoberta dos ids de sessão de cada CLI
  usage.rs, bridge.rs Limites de uso (Codex, OpenCode, ponte de statusline do Claude)
  windows.rs          Janelas e segunda tela
  settings.rs         Preferências e inicialização com o Windows
tests/                Testes do frontend (Vitest)
docs/                 Arquitetura, releases e protótipos de design
```

Leia [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para entender o fluxo completo.

## Adicionando um novo agente/CLI

1. `src-tauri/src/tools.rs`: novo `ToolKind` e como iniciar/retomar.
2. `src-tauri/src/discovery.rs`: como encontrar o id da sessão criada.
3. `src/ui/icons.ts`: nome, cor e ícone.
4. `src/terminal/detector.ts`: textos que indicam "aguardando você".

## Padrões

- `pnpm check` precisa passar (typecheck, testes, `cargo fmt`, `cargo clippy -D warnings`).
- Lógica pura ganha teste (veja `tests/layout.test.ts`).
- Textos da interface em português do Brasil, curtos e diretos.
- Commits pequenos e com mensagem clara (ex.: `fix: divisória ignora mínimo ao arrastar rápido`).

## Pull requests

1. Faça um fork e crie um branch a partir de `main`.
2. Descreva o que mudou e como testou; inclua prints para mudanças visuais.
3. Uma pessoa mantenedora revisa e faz o merge.

Ao contribuir, você concorda em licenciar sua contribuição sob a [licença MIT](LICENSE).
