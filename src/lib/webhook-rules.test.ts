import { describe, expect, it } from "vitest";
import { getWebhookEventId, matchedKeyword } from "./webhook-rules";

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

describe("getWebhookEventId", () => {
  it("prioriza o ID estável do comentário em reentregas", () => {
    expect(
      getWebhookEventId("comment.received", {
        id: "delivery-attempt-2",
        comment: { id: "comment-123" },
      }),
    ).toBe("comment-123");
  });

  it("prioriza o ID da mensagem em eventos de DM", () => {
    expect(
      getWebhookEventId("message.received", {
        id: "envelope-456",
        message: { id: "message-123" },
      }),
    ).toBe("message-123");
  });

  it("usa o ID do envelope para outros eventos e aceita eventos sem ID", () => {
    expect(getWebhookEventId("account.updated", { id: "envelope-123" })).toBe("envelope-123");
    expect(getWebhookEventId("unknown", {})).toBeNull();
    expect(getWebhookEventId("unknown", { id: "   " })).toBeNull();
  });
});
