// Helper que injeta o Authorization header do Supabase nas chamadas a server functions.
// As createServerFn fazem fetch interno; usamos middleware do TanStack para attachar headers.
import { supabase } from "@/integrations/supabase/client";

export async function withAuthFetch<T>(fn: () => Promise<T>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Não autenticado");
  // Patch fetch global para anexar header somente desta requisição.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return originalFetch(input, { ...init, headers });
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
