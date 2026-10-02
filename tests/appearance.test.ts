import { describe, expect, it } from "vitest";
import { colorValue, resolveColor, SESSION_COLORS } from "../src/core/appearance";

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
