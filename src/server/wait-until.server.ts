// Acessa o `ctx.waitUntil` do Cloudflare Worker via H3Event do TanStack Start.
//
// CF Workers cancelam Promises não-awaitadas depois que o Response é retornado.
// Pra rodar trabalho em background (ex: chamar Zernio API depois de já termos
// respondido 200 ao webhook), precisamos garantir que o Worker mantenha o
// processo vivo até a Promise terminar — é exatamente isso que `waitUntil` faz.
//
// O TanStack Start guarda o H3Event num AsyncLocalStorage indexado por um
// Symbol global. Esse storage não é exposto pela API pública, mas o symbol
// é estável (Symbol.for), então conseguimos acessar pelo globalThis.
//
// Se rodar fora do CF Worker (ex: dev local), waitUntil pode não existir —
// nesse caso fazemos fallback pra Promise.catch (best-effort).
import type { AsyncLocalStorage } from "node:async_hooks";

const STORAGE_KEY = Symbol.for("tanstack-start:event-storage");

interface MinimalH3Event {
  waitUntil?: (promise: Promise<unknown>) => void;
}

interface StartEvent {
  h3Event: MinimalH3Event;
}

function getH3Event(): MinimalH3Event | null {
  try {
    const g = globalThis as typeof globalThis & {
      [STORAGE_KEY]?: AsyncLocalStorage<StartEvent>;
    };
    const storage = g[STORAGE_KEY];
    if (!storage) return null;
    const ctx = storage.getStore();
    return ctx?.h3Event ?? null;
  } catch {
    return null;
  }
}

// Roda `promise` em background mantendo o Cloudflare Worker vivo até completar.
// Se waitUntil não estiver disponível (dev/Node), faz fallback pra fire-and-forget
// com .catch — vai funcionar em ambientes que não matam promises.
// Retorna info sobre qual mecanismo foi usado (útil pra debug em response).
export interface BackgroundDispatchInfo {
  mechanism: "waitUntil" | "fire-and-forget";
  hasH3Event: boolean;
  hasWaitUntil: boolean;
  storageFound: boolean;
}

export function runInBackground(
  promise: Promise<unknown>,
  errorTag = "[bg]",
): BackgroundDispatchInfo {
  const safe = promise.catch((e) => {
    console.error(errorTag, e instanceof Error ? e.message : e);
  });

  const g = globalThis as typeof globalThis & {
    [STORAGE_KEY_REF]?: unknown;
  };
  const storageFound = !!g[STORAGE_KEY_REF];
  const event = getH3Event();
  const hasH3Event = !!event;
  const hasWaitUntil = !!event?.waitUntil;

  if (event?.waitUntil) {
    event.waitUntil(safe);
    return { mechanism: "waitUntil", hasH3Event, hasWaitUntil, storageFound };
  }
  return { mechanism: "fire-and-forget", hasH3Event, hasWaitUntil, storageFound };
}

const STORAGE_KEY_REF = STORAGE_KEY;
