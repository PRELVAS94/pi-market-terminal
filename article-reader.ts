const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
// Source-specific public release reader. Never follows links to arbitrary hosts.
export function extractFedRelease(html: string): string {
  const article = html.split(/<div\s+id=["']article["'][^>]*>/i)[1];
  if (!article) throw new Error("Release body not found");
  const body = article.split(
    /<div\s+class=["']col-xs-12 col-sm-8 col-md-8["'][^>]*>/i,
  )[1];
  if (!body) throw new Error("Release body layout changed");
  const main = body.split(/<div\s+class=["']panel panel-attachments/i)[0];
  const text = main
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(?:p|li|h[1-6]|ul|ol)>/gi, "\n\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
      const c =
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : "";
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_match: string, n: string) => HTML_ENTITIES[n] ?? "",
    )
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < 80) throw new Error("Release body unavailable");
  return text;
}
export function isFedRelease(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname === "www.federalreserve.gov" &&
      /^\/newsevents\/pressreleases\/[a-z]+\d+[a-z]?\.htm$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}
export function createArticleReader() {
  const cache = new Map<string, string>();
  return async (url: string, signal: AbortSignal) => {
    if (!isFedRelease(url))
      throw new Error("Full-text reader supports Federal Reserve releases");
    if (cache.has(url)) return cache.get(url)!;
    const response = await fetch(url, {
      signal,
      redirect: "error",
      headers: { "User-Agent": "Pi-Market-Terminal/0.7", Accept: "text/html" },
    });
    if (!response.ok)
      throw new Error(`Source returned HTTP ${response.status}`);
    const html = await response.text();
    if (html.length > 2_000_000) throw new Error("Release too large");
    const text = extractFedRelease(html);
    if (cache.size >= 30) cache.delete(cache.keys().next().value!);
    cache.set(url, text);
    return text;
  };
}

export type ArticleDetails = {
  body: string;
  points: string[];
  attribution: string;
  coverage: string;
};
/** Extract only a balanced, visible HTML element, never execute publisher JavaScript. */
export function elementByClass(
  html: string,
  className: string,
): string | undefined {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `<div\\b[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>`,
    "i",
  ).exec(html);
  if (!match) return;
  const start = match.index + match[0].length;
  let depth = 1;
  for (const tag of html.slice(start).matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, start + tag.index!);
  }
}
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(?:p|li|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
      const c =
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : "";
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_match: string, n: string) => HTML_ENTITIES[n] ?? "",
    )
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export function isCnbcArticle(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname === "www.cnbc.com" &&
      /^\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.html$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}
export function extractCnbcArticle(html: string): ArticleDetails {
  // Only public rendered text is used. Never evaluate embedded state or unlock a subscription.
  if (
    /"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test(html) ||
    /"premium"\s*:\s*true/.test(
      html.slice(
        html.indexOf("window.__s_data="),
        html.indexOf("window.__s_data=") + 12000,
      ),
    )
  )
    throw new Error("CNBC subscription article; open source to sign in");
  const raw = elementByClass(html, "ArticleBody-articleBody");
  if (!raw) throw new Error("CNBC public article body unavailable");
  if (/class=["'][^"']*(?:paywall-lock|hardPaywall|paywall-locked)/i.test(raw))
    throw new Error("CNBC subscription article; open source to sign in");
  // Article paragraphs/lists exclude image captions, promos, recommendations and widgets.
  const body = [
    ...raw.matchAll(/<(p|li|h2|h3|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi),
  ]
    .map((m) => htmlText(m[2]))
    .filter(Boolean)
    .join("\n\n");
  if (body.length < 100)
    throw new Error("CNBC supplied no readable public article text");
  const keyPoints = elementByClass(html, "RenderKeyPoints-keyPoints") ?? "";
  const points = [...keyPoints.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => htmlText(m[1]))
    .filter(Boolean);
  return {
    body,
    points,
    attribution: "CNBC · publisher article and Key Points",
    coverage:
      "Public page text · may be an excerpt; subscription content requires source sign-in",
  };
}
export function canReadArticle(url: string) {
  return isFedRelease(url) || isCnbcArticle(url);
}
export function createDetailedArticleReader() {
  const cache = new Map<string, ArticleDetails>();
  return async (url: string, signal: AbortSignal): Promise<ArticleDetails> => {
    if (!canReadArticle(url))
      throw new Error("Source has no in-terminal article reader");
    if (cache.has(url)) return cache.get(url)!;
    const response = await fetch(url, {
      signal,
      redirect: "error",
      headers: { "User-Agent": "Pi-Market-Terminal/0.7", Accept: "text/html" },
    });
    if (!response.ok)
      throw new Error(`Source returned HTTP ${response.status}`);
    const length = Number(response.headers?.get("content-length"));
    if (length > 2_000_000) throw new Error("Article too large");
    const reader = response.body?.getReader();
    let html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 2_000_000) throw new Error("Article too large");
          html += decoder.decode(value, { stream: true });
        }
        html += decoder.decode();
      } finally {
        await reader.cancel();
      }
    } else {
      html = await response.text();
      if (html.length > 2_000_000) throw new Error("Article too large");
    }
    const details = isFedRelease(url)
      ? {
          body: extractFedRelease(html),
          points: [],
          attribution: "Federal Reserve",
          coverage: "Full release body · attachments remain at source",
        }
      : extractCnbcArticle(html);
    if (cache.size >= 30) cache.delete(cache.keys().next().value!);
    cache.set(url, details);
    return details;
  };
}
