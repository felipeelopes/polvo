import { describe, expect, it } from "vitest";
import { colorValue, initials, resolveColor, SESSION_COLORS, urgentStatus } from "../src/core/appearance";

const TOOL = "#D97757";

describe("cor de destaque", () => {
  it("aceita os nomes do /color e #hex", () => {
    expect(colorValue("blue")).toBe(SESSION_COLORS.blue);
    expect(colorValue(" Purple ")).toBe(SESSION_COLORS.purple);
    expect(colorValue("#ABCDEF")).toBe("#abcdef");
  });

  it("ignora vazio e cores desconhecidas", () => {
    expect(colorValue(null)).toBeNull();
    expect(colorValue("")).toBeNull();
    expect(colorValue("default")).toBeNull();
    expect(colorValue("#xyz")).toBeNull();
  });

  it("a cor da sessão vence a do projeto", () => {
    expect(resolveColor("pink", "green", TOOL)).toBe(SESSION_COLORS.pink);
  });

  it("sem cor própria, a sessão herda a do projeto", () => {
    expect(resolveColor(null, "green", TOOL)).toBe(SESSION_COLORS.green);
  });

  it("sem cor de sessão nem de projeto, fica a da ferramenta", () => {
    expect(resolveColor(null, null, TOOL)).toBe(TOOL);
    expect(resolveColor(undefined, "inexistente", TOOL)).toBe(TOOL);
  });
});

describe("trilho de projetos", () => {
  it("iniciais: duas palavras viram duas letras", () => {
    expect(initials("API Cardápio")).toBe("AC");
    expect(initials("api-cardapio")).toBe("AC");
    expect(initials("minhaApi")).toBe("MA");
    expect(initials("ético_projeto")).toBe("ÉP");
  });

  it("iniciais: sigla curta fica inteira, palavra solta fica com duas letras", () => {
    expect(initials("PDV")).toBe("PDV");
    expect(initials("API")).toBe("API");
    expect(initials("Polvo")).toBe("Po");
    expect(initials("2024")).toBe("20");
    expect(initials("")).toBe("?");
  });

  it("status do projeto é o mais urgente das sessões", () => {
    expect(urgentStatus([])).toBeNull();
    expect(urgentStatus(["idle", "working", "waiting"])).toBe("waiting");
    expect(urgentStatus(["idle", "starting", "working"])).toBe("working");
    expect(urgentStatus(["idle", "exited", "paused"])).toBe("exited");
    expect(urgentStatus(["paused", "idle"])).toBe("idle");
  });
});
