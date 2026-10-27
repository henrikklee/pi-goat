import { describe, expect, test } from "bun:test";
import { parseDuckDuckGoResults, validateUrl, WebSearchClient } from "../src/web-search-client.ts";

describe("web-search package dependencies", () => {
  test("parses results and preserves percent-encoded URLs", () => {
    const url = "https://example.com/a%20b?q=x%2Fy";
    const html = `<div class="result"><a class="result__a" href="/l/?uddg=${encodeURIComponent(url)}">Example</a><span class="result__snippet">A snippet</span></div>`;
    expect(parseDuckDuckGoResults(html, 1)).toEqual([
      { title: "Example", url, abstract: "A snippet" },
    ]);
  });

  test("rejects private network and non-http URLs", () => {
    for (const url of ["http://localhost", "http://127.0.0.1", "http://10.0.0.1", "http://169.254.169.254", "http://[::1]", "file:///tmp/example"]) {
      expect(() => validateUrl(url)).toThrow();
    }
    expect(validateUrl("https://example.com").hostname).toBe("example.com");
  });

  test("extracts article content with installed Readability and linkedom", async () => {
    const originalFetch = globalThis.fetch;
    const paragraph = "A useful article explains a concrete subject with enough detail for readers to understand its context and practical consequences. ".repeat(12);
    globalThis.fetch = (async () => new Response(`<html><head><title>Fixture article</title></head><body><article><h1>Fixture article</h1><p>${paragraph}</p><p>${paragraph}</p></article></body></html>`)) as typeof fetch;
    try {
      // A public IP avoids DNS/network calls; fetch itself is a fixture.
      const result = await new WebSearchClient().readPage("https://93.184.216.34/article", 10000);
      expect(result.title).toBe("Fixture article");
      expect(result.content).toContain("A useful article");
      expect(result.content).not.toContain("<article>");
      expect(result.truncated).toBe(false);
      const short = await new WebSearchClient().readPage("https://93.184.216.34/article", 100);
      expect(short.truncated).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
