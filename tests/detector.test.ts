import { describe, expect, it } from "vitest";
import { detectStatus, previewLines } from "../src/terminal/detector";

describe("detector de status", () => {
  it("reconhece pedido de permissão do Claude Code", () => {
    const screen = ["● Bash(npm test)", " Do you want to proceed?", " ❯ 1. Yes", "   2. No"];
    expect(detectStatus("claude", screen, 5000, 5000)).toBe("waiting");
  });

  it("reconhece trabalho em andamento pelo 'esc to interrupt'", () => {
    expect(detectStatus("codex", ["• Working (12s • esc to interrupt)"], 5000, 5000)).toBe("working");
  });

  it("saída recente que não é eco conta como trabalhando", () => {
    expect(detectStatus("shell", ["PS C:\\> build"], 200, 5000)).toBe("working");
    expect(detectStatus("shell", ["PS C:\\> build"], 200, 100)).toBe("idle");
  });

  it("tela parada é ocioso", () => {
    expect(detectStatus("opencode", ["> "], 9000, 9000)).toBe("idle");
  });

  it("prévia ignora molduras, caixa de prompt vazia e linhas vazias", () => {
    const lines = previewLines(["╭──────╮", "│ > │", "", "● Read(src/app.ts)", "  ⎿ 120 lines", "────"]);
    expect(lines).toEqual(["● Read(src/app.ts)", "  ⎿ 120 lines"]);
  });
});
