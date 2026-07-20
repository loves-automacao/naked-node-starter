import { afterEach, describe, expect, it, vi } from "vitest";
import { zernioSendConversationMessage } from "./zernio.server";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("zernioSendConversationMessage", () => {
  it("envia botões no campo buttons e não mistura quickReplies ou template", async () => {
    vi.stubEnv("ZERNIO_API_BASE", "https://zernio.example/v1");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: "message-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await zernioSendConversationMessage({
      apiKey: "secret",
      accountId: "account-1",
      conversationId: "conversation-1",
      message: "Escolha uma opção",
      quickReplies: [{ title: "Resposta rápida", payload: "QUICK" }],
      buttons: [{ type: "url", title: "Abrir", url: "https://example.com" }],
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      accountId: "account-1",
      message: "Escolha uma opção",
      buttons: [{ type: "url", title: "Abrir", url: "https://example.com" }],
    });
    expect(body).not.toHaveProperty("quickReplies");
    expect(body).not.toHaveProperty("template");
  });

  it("repete o envio quando a Zernio recusa temporariamente a resposta", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ZERNIO_API_BASE", "https://zernio.example/v1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("only one response at a time", { status: 409 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messageId: "message-2" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const request = zernioSendConversationMessage({
      apiKey: "secret",
      accountId: "account-1",
      conversationId: "conversation-1",
      message: "Olá",
    });
    await vi.advanceTimersByTimeAsync(750);

    await expect(request).resolves.toEqual({ messageId: "message-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
