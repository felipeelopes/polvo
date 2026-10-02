// O Polvo da marca reage ao app: acorda ao abrir, mexe os braços quando algum agente
// trabalha, levanta um braço quando alguém espera você e acompanha o ponteiro com o olhar.
import { store } from "../core/store";
import { type LogoMood, MOODS } from "./logo";

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function setMood(svg: Element, mood: LogoMood): void {
  if (svg.classList.contains(mood)) return;
  svg.classList.remove(...MOODS);
  svg.classList.add(mood);
}

/** Humor do Polvo da barra de título conforme as sessões desta janela. */
function moodFor(): LogoMood {
  const st = store.mine.map((s) => s.runtime.status);
  if (st.includes("waiting")) return "alert";
  if (st.includes("working") || st.includes("starting")) return "busy";
  return "still";
}

/** Liga o mascote da barra de título: abertura animada e humor ao vivo. */
export function mountBrand(brand: HTMLElement): void {
  const svg = brand.querySelector(".polvo");
  if (!svg) return;
  if (!calm()) {
    svg.classList.add("intro");
    svg.addEventListener("animationend", (e) => {
      if ((e as AnimationEvent).animationName === "polvo-pop") setTimeout(() => svg.classList.remove("intro"), 1900);
    });
  }
  const sync = () => setMood(svg, moodFor());
  store.on((topic) => {
    if (topic === "runtime" || topic === "sessions" || topic === "project") sync();
  });
  sync();
  initGaze();
}

// ------------------------------------------------------------ olhar

let gazeOn = false;

/** Pupilas de todo `.polvo.look` visível seguem o ponteiro (um rAF por movimento). */
export function initGaze(): void {
  if (gazeOn) return;
  gazeOn = true;
  let x = 0;
  let y = 0;
  let queued = false;
  const frame = () => {
    queued = false;
    if (calm()) return;
    document.querySelectorAll<SVGSVGElement>(".polvo.look").forEach((svg) => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height * 0.45);
      const d = Math.hypot(dx, dy) || 1;
      // Até 3 unidades do viewBox (114), com aproximação suave para o ponteiro perto.
      const k = Math.min(1, d / 180) * 3;
      const g = svg.querySelector<SVGGElement>(".gaze");
      if (g) g.style.transform = `translate(${((dx / d) * k).toFixed(2)}px, ${((dy / d) * k).toFixed(2)}px)`;
    });
  };
  addEventListener(
    "pointermove",
    (e) => {
      x = e.clientX;
      y = e.clientY;
      if (!queued) {
        queued = true;
        requestAnimationFrame(frame);
      }
    },
    { passive: true },
  );
}
