// Server-only: criptografia da API Key da Zernio usando AES-256-GCM
// Usa SUPABASE_SERVICE_ROLE_KEY como base do segredo (já existe no ambiente).
import crypto from "crypto";
import { getEncryptionSecretCandidates } from "@/config/env.server";

// IMPORTANTE: o segredo PRECISA ser estável entre contextos (server function autenticada
// e route handler do webhook público). Como cada contexto pode ter env vars diferentes,
// fazemos o seguinte:
//
// - encryptString usa a PRIMEIRA env disponível em ordem de preferência
// - decryptString TENTA com cada uma delas até uma conseguir descriptografar
//
// Isso garante compatibilidade entre saves antigos e novos, mesmo se as envs mudarem.
// Pra produção, configure INSTAREPLY_ENCRYPTION_KEY (chave dedicada e estável).
function getCandidateSecrets(): string[] {
  return getEncryptionSecretCandidates();
}

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function getEncryptKey(): Buffer {
  const candidates = getCandidateSecrets();
  if (candidates.length === 0) {
    throw new Error(
      "Missing encryption secret: configure INSTAREPLY_ENCRYPTION_KEY or SUPABASE_URL",
    );
  }
  return deriveKey(candidates[0]);
}

export function encryptString(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptString(payload: string): string {
  const [ivB64, tagB64, encB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("Invalid encrypted payload");

  const ivBuf = Buffer.from(ivB64, "base64");
  const tagBuf = Buffer.from(tagB64, "base64");
  const encBuf = Buffer.from(encB64, "base64");

  const candidates = getCandidateSecrets();
  if (candidates.length === 0) {
    throw new Error("Missing encryption secret");
  }

  const errors: string[] = [];
  for (const secret of candidates) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(secret), ivBuf);
      decipher.setAuthTag(tagBuf);
      const dec = Buffer.concat([decipher.update(encBuf), decipher.final()]);
      return dec.toString("utf8");
    } catch (e) {
      const name = e instanceof Error ? e.message : String(e);
      errors.push(name);
    }
  }
  // Nenhuma chave funcionou
  throw new Error(
    `Authentication failed (tried ${candidates.length} secret candidates). Last error: ${errors[errors.length - 1]}`,
  );
}
