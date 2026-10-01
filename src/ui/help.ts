// Popover de dicas e atalhos.
import { popover } from "./feedback";

export function openHelp(anchor: HTMLElement): void {
  popover(
    "help",
    anchor,
    (el) => {
      el.innerHTML = `<h4>Organizando as sessões</h4><ul>
        <li><span>✥</span><span>Arraste pelo <b>cabeçalho</b>. Solte na borda de outro painel para dividir; no centro, para trocar de lugar.</span></li>
        <li><span>▥</span><span>Solte na <b>borda da área</b> para criar uma coluna ou linha inteira.</span></li>
        <li><span>⇤</span><span>Arraste para o <b>trilho</b> para recolher. Do trilho, arraste para onde quiser abrir.</span></li>
        <li><span>↔</span><span>As divisórias têm <b>ímã</b> em ⅓, ½ e ⅔ e se alinham às outras. Divisórias alinhadas se movem juntas (Alt move só uma).</span></li>
        <li><span>⇔</span><span><b>Duplo clique</b> numa divisória iguala os tamanhos. No cabeçalho, maximiza.</span></li>
        <li><span>⧉</span><span><b>Várias janelas</b>: abra quantas quiser e leve cada uma para um monitor. O botão de mover passa a sessão para outra janela. Todas reabrem no mesmo lugar.</span></li>
        <li><span>⎘</span><span>No terminal: selecione e use Ctrl+C para copiar; Ctrl+V cola; o botão direito copia ou cola.</span></li></ul>
        <div class="keys">
          <kbd>Ctrl Shift N</kbd><span>Nova sessão</span>
          <kbd>Ctrl Shift T</kbd><span>Terminal na pasta da sessão ativa</span>
          <kbd>Ctrl Shift 1 / 2</kbd><span>Painéis / Quadro</span>
          <kbd>Ctrl Alt ←↑→↓</kbd><span>Mover o foco entre painéis</span>
          <kbd>Ctrl Alt Shift ←↑→↓</kbd><span>Trocar o painel de lugar</span>
          <kbd>Ctrl Shift M</kbd><span>Maximizar / restaurar o painel</span>
          <kbd>Ctrl Shift Z</kbd><span>Desfazer layout</span>
          <kbd>Ctrl + / Ctrl − / Ctrl 0</kbd><span>Zoom da interface</span>
        </div>`;
    },
    "help",
  );
}
