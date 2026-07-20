export function matchedKeyword(text: string, keywords: string[]): string | null {
  const normalizedText = text.toLowerCase();

  for (const keyword of keywords) {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (normalizedKeyword && normalizedText.includes(normalizedKeyword)) return keyword;
  }

  return null;
}
