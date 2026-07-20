import { describe, expect, it } from "vitest";
import { validateAutomationInput, type AutomationInput } from "./automation-rules";

function validInput(overrides: Partial<AutomationInput> = {}): AutomationInput {
  return {
    name: "Automação",
    instagram_post_id: "*",
    instagram_post_type: "post",
    custom_message: "Olá",
    followup_message: "Conteúdo",
    quick_replies: [],
    buttons: [],
    is_active: true,
    keyword_filter_enabled: false,
    keywords: [],
    delay_min_seconds: 30,
    delay_max_seconds: 60,
    ...overrides,
  };
}

describe("validateAutomationInput", () => {
  it("normaliza campos textuais, palavras-chave e limites", () => {
    const result = validateAutomationInput(
      validInput({
        name: "  Minha automação  ",
        instagram_post_id: "  1234567890  ",
        keywords: [" Quero ", "QUERO", "", " Sorteio "],
        delay_min_seconds: 10,
        delay_max_seconds: 500,
      }),
    );

    expect(result.name).toBe("Minha automação");
    expect(result.instagram_post_id).toBe("1234567890");
    expect(result.keywords).toEqual(["quero", "sorteio"]);
    expect(result.delay_min_seconds).toBe(30);
    expect(result.delay_max_seconds).toBe(120);
  });

  it("mantém o atraso máximo igual ou acima do mínimo", () => {
    const result = validateAutomationInput(
      validInput({ delay_min_seconds: 90, delay_max_seconds: 40 }),
    );
    expect(result.delay_min_seconds).toBe(90);
    expect(result.delay_max_seconds).toBe(90);
  });

  it("usa valores seguros para atrasos não finitos", () => {
    const result = validateAutomationInput(
      validInput({ delay_min_seconds: Number.NaN, delay_max_seconds: Number.POSITIVE_INFINITY }),
    );
    expect(result.delay_min_seconds).toBe(30);
    expect(result.delay_max_seconds).toBe(60);
  });

  it("limita quick replies e botões aos limites das APIs", () => {
    const result = validateAutomationInput(
      validInput({
        quick_replies: Array.from({ length: 15 }, (_, index) => ({
          title: `Opção ${index}`,
          payload: `OPTION_${index}`,
        })),
        buttons: Array.from({ length: 5 }, (_, index) => ({
          type: "postback",
          title: `Botão ${index}`,
        })),
      }),
    );
    expect(result.quick_replies).toHaveLength(13);
    expect(result.buttons).toHaveLength(3);
  });

  it.each(["", "   "])("rejeita nome inválido: %j", (name) => {
    expect(() => validateAutomationInput(validInput({ name }))).toThrow("Nome inválido");
  });

  it("rejeita post ID vazio", () => {
    expect(() => validateAutomationInput(validInput({ instagram_post_id: "  " }))).toThrow(
      "Post ID é obrigatório",
    );
  });
});
