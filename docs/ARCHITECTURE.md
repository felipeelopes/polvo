# Arquitetura do Polvo

```
┌──────────────────────── Janela (WebView2) ─────────────────────────┐
│  Titlebar · Rail · TilesView (árvore de divisões) · BoardView      │
│  Terminals ─► SessionTerminal (xterm.js) ─► detector de status     │
└───────────────▲──────────────────────────────┬─────────────────────┘
       eventos  │ sessions-changed             │ comandos (invoke)
                │ session-runtime              │ pty_attach (Channel binário)
┌───────────────┴──────────────────────────────▼─────────────────────┐
│ Backend Rust (Tauri 2)                                             │
│  Registry ── workspace.json   PtyManager ── ConPTY (portable-pty)  │
│  tools (planos de início)     discovery (ids de sessão dos CLIs)   │
│  usage + bridge (limites)     windows (várias)   context, settings │
└────────────────────────────────────────────────────────────────────┘
```

## Fonte da verdade

- **Backend (`registry.rs`)** guarda as sessões: ferramenta, pasta, título, id da sessão do CLI, janela dona e se está recolhida. Tudo vai para `%APPDATA%\Polvo\workspace.json` a cada mudança (gravação atômica).
- **Janelas**: dá para abrir várias (`windows.rs`). A lista fica no workspace e todas reabrem ao iniciar; posição, tamanho e monitor vêm do `tauri-plugin-window-state`. Abrir o Polvo de novo (single-instance) cria outra janela. Fechar a principal encerra o app; fechar uma extra pelo X a esquece e manda as sessões dela para o trilho da principal.
- **Cada janela** guarda o próprio layout (árvore de divisões) e a visão (Painéis/Quadro), também persistidos no workspace por rótulo de janela.
- O backend emite `sessions-changed` (lista completa) e `session-runtime` (status/prévia de uma sessão). Todas as janelas escutam.

## Ciclo de vida de uma sessão

1. `session_create` registra a sessão e chama `Registry::start`.
2. `tools::plan` decide a linha de comando:
   - Claude Code: `--session-id <uuid novo>` (id conhecido de antemão) ou `--resume <id>`.
   - Codex: `codex` e depois `discovery::codex_discover` lê `~/.codex/sessions/**/rollout-*.jsonl` até achar a sessão criada naquela pasta.
   - OpenCode: `opencode` e depois `opencode session list --format json` na pasta.
3. `PtyManager::spawn` abre um ConPTY, inicia o processo e guarda até 768 KB de saída recente.
4. A janela dona chama `pty_attach` com um `Channel`: recebe o histórico (para reconstruir a tela) e depois os bytes ao vivo.
5. A cada ~1 s a janela lê a tela do xterm, detecta o status (`detector.ts`) e envia `session_report` com status e prévia.
6. Quando o processo termina, o backend marca `exited` com o código de saída; o painel oferece **Retomar**.

Ao abrir o app com *retomar automaticamente*, `Registry::boot` inicia todas as sessões com `StartMode::Resume`.

## Layout (frontend)

`src/core/layout.ts` é um conjunto de funções puras sobre `LayoutNode` (folhas e divisões `row`/`col` com proporções):

- `insertAt`, `removeLeaf`, `swapLeaves`, `normalize`: edição da árvore.
- `fit`: garante o tamanho mínimo de cada painel tirando espaço de quem tem sobra.
- `geometry`: transforma a árvore em retângulos e divisórias.
- `setBoundary`: move uma divisória respeitando mínimos.
- `preset`, `smartInsert`, `neighbor`: facilitadores.

`TilesView.reconcile()` mantém a árvore igual ao conjunto de sessões visíveis da janela.

## Limites de uso

| Provedor | Fonte |
|---|---|
| Claude Code | O Polvo inicia o Claude com `--settings` apontando a statusline para `polvo.exe --statusline-bridge`. A ponte grava `rate_limits` em `%APPDATA%\Polvo\usage\claude.json` e repassa o JSON para a statusline original do usuário (variável `POLVO_USER_STATUSLINE`). |
| Codex | Último evento `token_count` com `rate_limits` nos arquivos de sessão. |
| OpenCode | `opencode stats --days 1` e `--days 30` (custo). |

## Atualizações

`tauri-plugin-updater` consulta `https://github.com/felipeelopes/polvo/releases/latest/download/latest.json`. O workflow `release.yml` gera e assina os instaladores e o `latest.json`. Veja [RELEASING.md](RELEASING.md).

## Git

O painel lateral (o mesmo dos documentos Markdown) tem uma aba **Git** fixa (`Ctrl+Shift+G`), que segue o repositório da sessão em foco.

- **Backend (`gitops.rs`)**: tudo pelo git da linha de comando, para valer a configuração, os hooks e as credenciais do usuário. Leituras usam `--no-optional-locks` (os agentes podem estar usando o git ao mesmo tempo); escritas passam por um lock por repositório. `GIT_EDITOR=true` e `GIT_TERMINAL_PROMPT=0` evitam travar esperando editor ou senha. Fetch/pull/push mandam o progresso por um `Channel`. PRs vêm do `gh`; a mensagem de commit com IA usa `claude -p`.
- **Frontend (`src/git/`)**: `view.ts` (repositório, branch, sincronizar, faixas), `changes.ts` (arquivos, diff, stash, commit), `history.ts`, `branches.ts`, `prs.ts`. Carregado só quando o painel abre.
- **Linhas e trechos**: `diff.ts` lê o diff unificado e monta patches parciais aplicados com `git apply --cached` (incluir/tirar) ou `git apply --reverse` (descartar). Os testes em `tests/diff-git.test.ts` conferem com o git de verdade, inclusive arquivos CRLF.
- **Selos**: a cada 6 s o app pede `git_summaries` dos worktrees desta janela (alterados, à frente, atrás, conflitos) para a barra lateral e o chip de branch da barra de título.
- **Agentes**: "Revisar", "Resolver conflito" e "Explicar commit" abrem uma sessão do agente na pasta e digitam o pedido quando ele fica pronto. "Nova branch numa worktree" cria a pasta ao lado do repositório e inicia um agente nela.

## Decisões

- **Sem framework de UI**: TypeScript puro com módulos pequenos. O app é imperativo (terminais, arrastar), e isso mantém o bundle mínimo.
- **Comandos que criam janelas são `async`**: criar uma janela num comando síncrono trava a thread principal no Windows.
- **Variáveis de ambiente de agentes são removidas** dos processos filhos, para o Polvo funcionar mesmo quando aberto de dentro de outro agente.
