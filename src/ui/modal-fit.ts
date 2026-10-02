// Diálogos em janelas baixas: marca `.scrolls` na caixa quando há conteúdo rolando
// por baixo do rodapé fixo, para ele ganhar a linha e a sombra de separação.
function check(box: HTMLElement): void {
  box.classList.toggle("scrolls", box.scrollTop + box.clientHeight < box.scrollHeight - 1);
}

function watch(box: HTMLElement): void {
  if (box.dataset.fit) return;
  box.dataset.fit = "1";
  const run = () => check(box);
  box.addEventListener("scroll", run, { passive: true });
  new ResizeObserver(run).observe(box);
  // Várias telas redesenham o conteúdo inteiro (ex.: Ajustes ao trocar uma opção).
  new MutationObserver(run).observe(box, { childList: true });
  run();
}

export function installModalFit(): void {
  const scan = () => document.querySelectorAll<HTMLElement>(".modal > .mbox").forEach(watch);
  new MutationObserver(scan).observe(document.body, { childList: true });
  addEventListener("resize", () => document.querySelectorAll<HTMLElement>(".modal > .mbox").forEach(check));
  scan();
}
