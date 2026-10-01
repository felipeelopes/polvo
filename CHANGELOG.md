# Changelog

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
