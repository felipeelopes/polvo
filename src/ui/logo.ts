// Logo do Polvo em SVG, com animações leves (CSS em styles/logo.css).
//
// Variações:
//   - "idle":  flutua, pisca e balança os braços (onboarding, vazio, sobre)
//   - "wave":  acena com um braço (boas-vindas, "tudo pronto")
//   - "swim":  nada para cima, braços em ritmo rápido (retomando uma sessão)
//   - "still": parado, só pisca de vez em quando (barra de título em repouso)
//   - "busy":  braços em onda, um após o outro (algum agente trabalhando)
//   - "alert": levanta um braço e dá pulinhos (algum agente esperando você)
//
// Com `look`, as pupilas acompanham o ponteiro (ver ui/brand.ts).

export type LogoMood = "idle" | "wave" | "swim" | "still" | "busy" | "alert";
export const MOODS: LogoMood[] = ["idle", "wave", "swim", "still", "busy", "alert"];

const TENTACLES = [
  { x: 31, h: 34 },
  { x: 44, h: 40 },
  { x: 57, h: 43 },
  { x: 70, h: 40 },
  { x: 83, h: 34 },
];

export function logo(size = 40, mood: LogoMood = "idle", opts: { look?: boolean } = {}): string {
  const arms = TENTACLES.map(
    (t, i) => `<rect class="arm a${i}" x="${t.x - 6}" y="62" width="12" height="${t.h}" rx="6"/>`,
  ).join("");
  return `<svg class="polvo ${mood}${opts.look ? " look" : ""}" width="${size}" height="${size}" viewBox="0 0 114 114" role="img" aria-label="Polvo">
    <g class="body">
      <g class="arms" fill="#FF8A70">${arms}</g>
      <ellipse class="head" cx="57" cy="47" rx="31" ry="30" fill="#FF8A70"/>
      <ellipse cx="45" cy="28" rx="9" ry="6" fill="#FFBCA8"/>
      <g class="eyes">
        <ellipse cx="45" cy="50" rx="7" ry="8" fill="#fff"/>
        <ellipse cx="69" cy="50" rx="7" ry="8" fill="#fff"/>
        <g class="gaze">
          <circle class="pupil" cx="46" cy="51" r="4" fill="#281A3C"/>
          <circle class="pupil" cx="70" cy="51" r="4" fill="#281A3C"/>
          <circle cx="47.5" cy="48.5" r="1.4" fill="#fff"/>
          <circle cx="71.5" cy="48.5" r="1.4" fill="#fff"/>
        </g>
      </g>
      <ellipse cx="35" cy="61" rx="5" ry="3" fill="#FF6B7A" opacity=".85"/>
      <ellipse cx="79" cy="61" rx="5" ry="3" fill="#FF6B7A" opacity=".85"/>
      <path d="M51 62q6 5 12 0" stroke="#281A3C" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    </g>
  </svg>`;
}

/** Ícone completo do app (fundo em gradiente), usado no "Sobre". */
export function appIcon(size = 96, mood: LogoMood = "idle"): string {
  return `<span class="app-icon" style="width:${size}px;height:${size}px">${logo(Math.round(size * 0.82), mood, { look: true })}</span>`;
}
