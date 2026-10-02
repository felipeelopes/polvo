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

## Meu trabalho: GitHub e Azure DevOps

A tela "Meu trabalho" (`src/work/`, `src-tauri/src/work/`) junta commits locais, issues e PRs do GitHub e work items, sprint e PRs do Azure DevOps. Os tokens ficam só no Gerenciador de Credenciais do Windows, e o webview nunca vê um token. As conexões funcionam assim, da mais simples à manual:

- **GitHub:**
  - Login do próprio Polvo pelo OAuth Device Flow: o app mostra um código e abre o navegador.
  - Sem isso, usa o login do GitHub CLI (`gh auth token`), sem nenhum clique.
  - As chamadas vão direto à API (GraphQL e REST).
- **Azure DevOps:**
  - Login com Microsoft Entra ID por device code, com refresh token.
  - Sem isso, usa o token do Azure CLI (`az login`).
  - PAT para organizações sem Entra.
  - O OAuth antigo do Azure DevOps não é usado, porque foi descontinuado.

O login próprio do Polvo precisa dos IDs públicos dos apps OAuth na hora do build. Esses IDs não são segredos. Sem eles, o login cai no `gh` e no `az`:

| Variável | Como obter |
| --- | --- |
| `POLVO_GITHUB_CLIENT_ID` | GitHub → Settings → Developer settings → OAuth Apps → *New OAuth App*. Marque **Enable Device Flow**; a callback URL pode ser a página do projeto. |
| `POLVO_ENTRA_CLIENT_ID` | Portal do Azure → Microsoft Entra ID → *App registrations* → *New registration*. Escolha contas de qualquer diretório organizacional. Em *Authentication*, ligue **Allow public client flows**. Em *API permissions*, adicione **Azure DevOps → user_impersonation** (delegada). |

Na release do GitHub Actions, cadastre os dois IDs como *variables* do repositório, não como *secrets*. No build local, basta definir as variáveis de ambiente antes de rodar `pnpm release`.

## Padrões

- `pnpm check` precisa passar (typecheck, testes, `cargo fmt`, `cargo clippy -D warnings`).
- Lógica pura ganha teste (veja `tests/layout.test.ts`).
- Textos da interface curtos e diretos, escritos primeiro em português do Brasil (veja [Traduções](#traduções)).
- Commits pequenos e com mensagem clara (ex.: `fix: divisória ignora mínimo ao arrastar rápido`).

## Traduções

A interface está em 10 idiomas. O português (pt-BR) é a origem:

- Textos da interface: `src/i18n/pt/<namespace>.ts`, usados no código com `t("ns.chave")` e, para plurais, `tn("ns.chave", n)` (chaves `one`/`other`; o russo usa também `few`/`many`).
- Traduções: `src/i18n/locales/<idioma>.ts`, com as mesmas chaves (o TypeScript reclama se faltar alguma).
- Mensagens do backend (erros, menu do Explorer): `src-tauri/i18n/<idioma>.json`, usadas com `crate::i18n::tr("ns.chave", &[...])`.
- Nunca chame `t()` no topo de um módulo: o idioma é definido depois que os módulos carregam.
- `pnpm test` confere se todos os idiomas têm as mesmas chaves, `{marcadores}` e tags HTML.

Para adicionar um idioma: crie `src/i18n/locales/<código>.ts` e `src-tauri/i18n/<código>.json`, registre o código em `LOCALES`/`LOCALE_TAGS` (`src/i18n/index.ts`) e em `CATALOGS` (`src-tauri/src/i18n.rs`), e adicione um `README.<código>.md`.

## Pull requests

1. Faça um fork e crie um branch a partir de `main`.
2. Descreva o que mudou e como testou; inclua prints para mudanças visuais.
3. Uma pessoa mantenedora revisa e faz o merge.

Quem tem commits entra na lista de colaboradores da tela **Sobre** e dos READMEs, gerada do histórico do git por `scripts/contributors.mjs`. Para aparecer uma vez só e com o link do seu perfil, o `.mailmap` liga os e-mails dos seus commits ao e-mail "noreply" do GitHub (`id+login@users.noreply.github.com`, em *Settings → Emails*). Se você usa outro e-mail, inclua uma linha para ele no `.mailmap` no seu PR.

Ao contribuir, você concorda em licenciar sua contribuição sob a [licença MIT](LICENSE).
