import { describe, expect, it } from "vitest";
import { matchedKeyword } from "./webhook-rules";

describe("matchedKeyword", () => {
  it("encontra palavras sem diferenciar maiúsculas e minúsculas", () => {
    expect(matchedKeyword("EU QUERO participar", ["quero", "sorteio"])).toBe("quero");
  });

  it("preserva o valor original da palavra encontrada", () => {
    expect(matchedKeyword("quero o material", ["  Quero  "])).toBe("  Quero  ");
  });

  it("ignora palavras vazias e retorna null quando não há correspondência", () => {
    expect(matchedKeyword("mensagem", ["", "   ", "sorteio"])).toBeNull();
    expect(matchedKeyword("mensagem", [])).toBeNull();
  });
});
