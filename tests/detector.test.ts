import { describe, expect, it } from "vitest";
import { contextFromScreen, detectStatus, previewLines, StatusDebouncer } from "../src/terminal/detector";

describe("detector de status", () => {
  it("reconhece pedido de permissão do Claude Code", () => {
    const screen = ["● Bash(npm test)", " Do you want to proceed?", " ❯ 1. Yes", "   2. No"];
    expect(detectStatus("claude", screen, 5000)).toEqual({ status: "waiting", certain: true });
  });

  it("reconhece trabalho em andamento pelo 'esc to interrupt'", () => {
    expect(detectStatus("codex", ["• Working (12s • esc to interrupt)"], 5000)).toEqual({ status: "working", certain: true });
  });

  it("só saída espontânea conta como trabalhando (sem certeza)", () => {
    expect(detectStatus("shell", ["PS C:> build"], 200)).toEqual({ status: "working", certain: false });
  });

  it("um redesenho isolado (clique, resize) não pisca para trabalhando", () => {
    const d = new StatusDebouncer(2);
    expect(d.next("a", { status: "idle", certain: false })).toBe("idle");
    expect(d.next("a", { status: "working", certain: false })).toBe("idle");
    expect(d.next("a", { status: "idle", certain: false })).toBe("idle");
    // trabalho real: confirmado em duas leituras seguidas
    expect(d.next("a", { status: "working", certain: false })).toBe("idle");
    expect(d.next("a", { status: "working", certain: false })).toBe("working");
    // sinal claro do CLI muda na hora
    expect(d.next("a", { status: "waiting", certain: true })).toBe("waiting");
  });

  it("tela parada é ocioso", () => {
    expect(detectStatus("opencode", ["> "], 9000)).toEqual({ status: "idle", certain: false });
  });

  it("prévia ignora molduras, caixa de prompt vazia e linhas vazias", () => {
    const lines = previewLines(["╭──────╮", "│ > │", "", "● Read(src/app.ts)", "  ⎿ 120 lines", "────"]);
    expect(lines).toEqual(["● Read(src/app.ts)", "  ⎿ 120 lines"]);
  });

  it("lê o contexto mostrado na tela", () => {
    expect(contextFromScreen(["  gpt-5 · 72% context left"])).toBe(28);
    expect(contextFromScreen(["tokens 12k · 34% context used"])).toBe(34);
    expect(contextFromScreen(["Context: 81%"])).toBe(81);
    expect(contextFromScreen(["nada aqui"])).toBeNull();
  });
});
