// Mantém uma fronteira única para chamadas autenticadas feitas pela UI.
// O header é anexado pelo middleware global registrado em src/start.ts.
import { supabase } from "@/integrations/supabase/client";

export async function withAuthFetch<T>(fn: () => Promise<T>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Não autenticado");
  return fn();
}
