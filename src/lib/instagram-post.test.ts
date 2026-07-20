import { describe, expect, it } from "vitest";
import { parsePostInput } from "./instagram-post";

describe("parsePostInput", () => {
  it("reconhece wildcard e media ID", () => {
    expect(parsePostInput(" * ")).toEqual({ kind: "wildcard" });
    expect(parsePostInput("17931201761893324")).toEqual({
      kind: "mediaId",
      value: "17931201761893324",
    });
  });

  it.each([
    "https://www.instagram.com/p/ABC_def-12/",
    "https://instagram.com/reel/ABC_def-12?utm_source=test",
    "https://instagram.com/tv/ABC_def-12#fragment",
  ])("extrai shortcode de %s", (input) => {
    expect(parsePostInput(input)).toEqual({ kind: "shortcode", value: "ABC_def-12" });
  });

  it("aceita shortcode isolado e rejeita entradas inválidas", () => {
    expect(parsePostInput("ABC_def-12")).toEqual({ kind: "shortcode", value: "ABC_def-12" });
    expect(parsePostInput(" ")).toBeNull();
    expect(parsePostInput("https://example.com/not-an-instagram-post")).toBeNull();
    expect(parsePostInput("1234")).toBeNull();
  });
});
