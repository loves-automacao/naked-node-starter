export type EnvironmentSource = Record<string, string | undefined>;

export function requireEnvironment(
  source: EnvironmentSource,
  names: readonly string[],
): Record<string, string> {
  const missing = names.filter((name) => !source[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(", ")}`);
  }
  return Object.fromEntries(names.map((name) => [name, source[name]!.trim()]));
}

export function requireHttpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Variável de ambiente ${name} deve ser uma URL válida`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Variável de ambiente ${name} deve usar http ou https`);
  }
  return url.toString().replace(/\/$/, "");
}
