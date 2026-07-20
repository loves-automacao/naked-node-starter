import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./http.server";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout", () => {
  it("retorna a resposta quando a chamada termina dentro do limite", async () => {
    const response = new Response("ok", { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(fetchWithTimeout("https://example.com", {}, 100)).resolves.toBe(response);
  });

  it("aborta chamadas que ultrapassam o limite", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }),
    );

    const request = fetchWithTimeout("https://example.com", {}, 100);
    const expectation = expect(request).rejects.toThrow("HTTP request timeout após 100ms");
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
  });
});
