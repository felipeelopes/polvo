# Changelog

## 0.2.2

- **Telas menores**: Ajustes e os demais diálogos (onboarding, Sobre, nova sessão, projetos, Git, novidades) rolam por dentro, com o rodapé de botões sempre à vista. Popovers não passam mais da borda da tela, e as grades viram uma ou duas colunas em janelas estreitas.

## 0.2.1

- **Cor e ícone por projeto**: clique com o botão direito num projeto da barra lateral (ou escolha ao criar e clonar). As sessões sem cor própria herdam a cor do projeto, e o `/color` da sessão continua valendo acima dela. ([#5](https://github.com/felipeelopes/polvo/pull/5))
- **Barra lateral recolhida mostra projetos** em vez de sessões: um item por projeto, com ícone ou iniciais na cor do projeto, quantidade de sessões e o status mais urgente; clique para ver as sessões e iniciar uma nova. ([#5](https://github.com/felipeelopes/polvo/pull/5))
- A caixa de commit do painel Git volta para o lugar quando o repositório não tem alterações. ([#2](https://github.com/felipeelopes/polvo/pull/2))
- Colaboradores na tela **Sobre** e nos READMEs, sem nomes repetidos e com link para o perfil no GitHub.
- Primeiras contribuições da comunidade. Obrigado, [@GabrielFranciscon](https://github.com/GabrielFranciscon)!

## 0.2.0

- **Gerenciador de Git** integrado, com tudo do GitHub Desktop: alterações, diff unificado ou lado a lado com seleção de linhas e trechos, commit (com coautores, corrigir o último commit, `--no-verify` e assinatura), branches (trocar, criar, renomear, apagar, merge, squash, rebase e comparar), histórico (reverter, cherry-pick, tag, reset, editar mensagem e juntar commits não enviados), stash, conflitos, pull requests com status do CI e configurações do repositório. Abra com `Ctrl+Shift+G` ou pelo ícone de branch na barra de título, em cada sessão e na barra lateral.
- **Os agentes ajudam no Git**: mensagem de commit gerada pelo Claude, revisão das alterações, resolução de conflitos e explicação de commits.
- **Nova branch numa worktree** com uma sessão do agente já aberta nela, para vários agentes trabalharem no mesmo repositório sem conflito.
- **Stash fácil**: guarde tudo ou um arquivo só, veja o conteúdo e restaure com um clique; ao trocar de branch, as alterações podem ficar guardadas e voltam quando você retorna.
- **Sincronizar** com um botão que mostra o que falta (buscar, puxar, enviar ou publicar), com progresso, busca automática e “Atualizar a partir de main”.
- **Selos de Git** na barra lateral e na barra de título: arquivos alterados, commits para enviar e para puxar.
- **Polvo animado** na marca e interface mais alinhada.
- **Novidades ao atualizar**: depois de cada atualização, o Polvo mostra o que mudou, no idioma do app.

## 0.1.6

- **Shift+Enter quebra a linha** nos terminais (Claude Code, Codex e outros CLIs), como no VS Code, em vez de enviar a mensagem.

## 0.1.5

- **10 idiomas**: English, Português, Español, Français, Deutsch, Italiano, 日本語, 简体中文, 한국어 e Русский. Segue o idioma do Windows ou o escolhido em Ajustes (também no onboarding).
- README em cada idioma, com seção de Markdown e Mermaid e diagramas Mermaid renderizados pelo GitHub.
- “Abrir no Polvo” no clique direito comum (sem Shift).
- Com um só agente configurado, cada projeto mostra apenas o “+”.
- Branches e worktrees sempre visíveis na barra lateral, mesmo com uma branch só.
- Ícone de Ajustes virou uma engrenagem (não parece mais o de tema claro/escuro).
- Menus se ajustam ao tamanho do texto.

## 0.1.4

- **Projetos**: botão “+ Projeto” para abrir uma pasta, criar um projeto novo (com `git init`) ou clonar um repositório. Projetos salvos aparecem na barra lateral mesmo sem sessões.
- **Ver só este projeto**: filtra Painéis e Quadro por projeto; cada projeto guarda a sua disposição de painéis.
- **Quadro mais flexível**: divisórias entre as colunas e o chat, colunas recolhíveis e chat maximizável (`Ctrl+Shift+M`).
- **Visualizador de Markdown** ao lado das sessões: abas, mermaid, fórmulas, código destacado, edição e modo dividido, com atualização ao vivo quando o agente muda o arquivo. `Ctrl` + clique num caminho `.md` do terminal abre o documento.
- **`/rename` e `/color` sincronizados** com o Polvo; a borda e a linha da sessão seguem a cor escolhida.
- **Versões dos CLIs** no popup de limites: atualize o Claude Code, Codex ou OpenCode e reinicie as sessões na versão nova com um clique.
- **Proteção ao fechar**: o Polvo pergunta antes de fechar com chats em andamento.
- Depois de `/resume` ou `/clear` no Claude, o Polvo retoma a conversa que está na tela (antes voltava a uma conversa nova).
- Menus abrem para cima quando não cabem abaixo (não ficam mais atrás da barra de tarefas).

## 0.1.3

- **Barra lateral por projeto**: sessões agrupadas por repositório, com os worktrees de cada um (como no Claude Code) e o percentual de contexto de cada chat. Recolhe para o trilho de ícones.
- **Nome do chat automático**: acompanha o título que o CLI define no terminal; renomear (ou dar nome ao criar) fixa o nome.
- **Nova sessão sem perguntas**: com um chat em foco, ou pelo “+” de um projeto ou worktree, abre direto ali. Shift+clique em “+ Nova sessão” abre o diálogo.
- **Claude Code em modo bypass de permissões** por padrão (pode desligar em Ajustes).
- **Aviso de atualização na barra de cima**, com verificação a cada 30 minutos.

## 0.1.2

- Percentual de contexto do Claude Code correto também em sessões retomadas (antes ficava em 0%).
- Zoom da interface com `Ctrl +`, `Ctrl −` e `Ctrl 0`, como no VS Code.
- Notas de atualização formatadas (sem marcação Markdown crua).
- Arquivos do projeto com finais de linha LF e `.gitignore` mais completo.

## 0.1.1

- **Abrir no Polvo**: Shift + clique direito numa pasta do Explorer abre a escolha de agente já com a pasta.
- **Terminal na pasta da sessão**: botão em cada painel e `Ctrl+Shift+T`.
- **Retomada com animação**: o polvo nada enquanto cada sessão volta; tudo é retomado ao abrir o app.
- Status mais confiável: cliques, foco e redimensionamentos não aparecem mais como "trabalhando"; telas que pedem Enter aparecem como "aguardando você"; sessões não ficam presas em "Retomando".
- Correção do retângulo translúcido entre os painéis e de soltar sessões no trilho.
- Barra de título e painéis se adaptam a janelas estreitas.
- Janelas extras não são esquecidas ao fechar o app.
- `POLVO_DATA_DIR` para usar outra pasta de dados.

## 0.1.0

Primeira versão pública do Polvo 🐙

- Painéis arrastáveis com encaixe, divisórias com ímã e alinhamento, tamanho mínimo garantido.
- Quadro por status: aguardando você, trabalhando e ocioso, com gaveta para abrir a sessão.
- Várias janelas: abra quantas quiser, cada uma no monitor certo; todas reabrem no mesmo lugar.
- Retomada automática das conversas (`claude --resume`, `codex resume`, `opencode --session`).
- Limites de uso: Claude com anéis de 5h e semanal, Codex e custo do OpenCode.
- Percentual de contexto usado em cada sessão.
- Onboarding: fornecedores ativos, iniciar com o Windows e retomada automática.
- Atualização automática assinada pelas releases do GitHub.
- Logo e mascote animado, tela Sobre com os colaboradores do projeto.
