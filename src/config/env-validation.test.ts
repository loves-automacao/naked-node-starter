import { describe, expect, it } from "vitest";
import { requireEnvironment, requireHttpUrl } from "./env-validation";
import {
  getEncryptionSecretCandidates,
  getServerSupabaseAdminConfig,
  getZernioApiBase,
} from "./env.server";

describe("configuração de ambiente", () => {
  it("lista todas as variáveis obrigatórias ausentes", () => {
    expect(() => requireEnvironment({}, ["FIRST", "SECOND"])).toThrow(
      "Variáveis de ambiente ausentes: FIRST, SECOND",
    );
  });

  it("valida e normaliza URLs HTTP", () => {
    expect(requireHttpUrl("https://example.com/", "API_URL")).toBe("https://example.com");
    expect(() => requireHttpUrl("ftp://example.com", "API_URL")).toThrow("deve usar http");
  });

  it("retorna configuração administrativa tipada", () => {
    expect(
      getServerSupabaseAdminConfig({
        SUPABASE_URL: "https://project.supabase.co/",
        SUPABASE_SERVICE_ROLE_KEY: "secret",
      }),
    ).toEqual({ url: "https://project.supabase.co", key: "secret" });
  });

  it("usa a URL padrão da Zernio", () => {
    expect(getZernioApiBase({})).toBe("https://zernio.com/api/v1");
  });

  it("ordena, limpa e remove segredos duplicados", () => {
    expect(
      getEncryptionSecretCandidates({
        INSTAREPLY_ENCRYPTION_KEY: " dedicated ",
        SUPABASE_URL: "same",
        VITE_SUPABASE_URL: "same",
      }),
    ).toEqual(["dedicated", "same"]);
  });
});
