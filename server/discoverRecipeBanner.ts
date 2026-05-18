import { URL } from "node:url";
import { fetchPublicHtml, isUnsafeFetchUrl } from "./pageFetch.js";

function decodeBasicEntities(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** Read a double- or single-quoted HTML attribute value (handles `?` and `&` inside URLs). */
function parseQuotedAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  const m = re.exec(tag);
  const v = m?.[2]?.trim();
  return v && v.length > 0 ? v : null;
}

function resolveUrl(raw: string | undefined | null, baseHref: string): string | null {
  if (!raw) return null;
  const cleaned = decodeBasicEntities(raw);
  if (!cleaned || cleaned.startsWith("data:") || cleaned.startsWith("javascript:")) return null;
  try {
    const u = new URL(cleaned, baseHref);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (isUnsafeFetchUrl(u.href)) return null;
    return u.href;
  } catch {
    return null;
  }
}

function scoreImageHost(imageUrl: URL, pageUrl: URL): number {
  const ih = imageUrl.hostname.toLowerCase();
  const ph = pageUrl.hostname.toLowerCase();
  if (ih === ph) return 100;
  if (ih.endsWith("." + ph)) return 80;
  if (ph.endsWith("." + ih)) return 40;
  return 10;
}

function collectMetaImageRefs(html: string, pageUrl: URL, push: (raw: string) => void) {
  const metaRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html))) {
    const tag = m[0];
    const prop = parseQuotedAttr(tag, "property")?.toLowerCase();
    const name = parseQuotedAttr(tag, "name")?.toLowerCase();
    const content = parseQuotedAttr(tag, "content");
    if (!content) continue;
    const key = prop || name || "";
    if (
      key === "og:image" ||
      key === "og:image:url" ||
      key === "og:image:secure_url" ||
      key === "twitter:image" ||
      key === "twitter:image:src"
    ) {
      const abs = resolveUrl(content, pageUrl.href);
      if (abs && !isUnsafeFetchUrl(abs)) push(abs);
    }
  }

  const linkRe = /<link\b[^>]*>/gi;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    if (!/\brel=["']image_src["']/i.test(tag) && !/\brel=["']preload["']/i.test(tag)) continue;
    if (/\brel=["']preload["']/i.test(tag) && !/\bas=["']image["']/i.test(tag)) continue;
    const href = parseQuotedAttr(tag, "href");
    const abs = resolveUrl(href, pageUrl.href);
    if (abs && !isUnsafeFetchUrl(abs)) push(abs);
  }
}

/** Fallback: first reasonable <img> sources (lazy-loaded sites, microdata). Lower priority than OG/Twitter. */
function collectArticleImgSrcs(html: string, pageUrl: URL, push: (raw: string) => void) {
  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = imgRe.exec(html)) && count < 80) {
    count++;
    const tag = m[0];
    if (/\bwidth=["']?1["']?\b/i.test(tag) && /\bheight=["']?1["']?\b/i.test(tag)) continue;
    if (/pixel|tracker|spacer|blank\.gif|1x1|doubleclick|googletagmanager|facebook\.com\/tr/i.test(tag)) continue;
    const src =
      parseQuotedAttr(tag, "src") ||
      parseQuotedAttr(tag, "data-src") ||
      parseQuotedAttr(tag, "data-lazy-src") ||
      parseQuotedAttr(tag, "data-original");
    if (!src || src.startsWith("data:")) continue;
    const abs = resolveUrl(decodeBasicEntities(src), pageUrl.href);
    if (abs && !isUnsafeFetchUrl(abs)) push(abs);
  }
}

function walkJsonLdForRecipeImages(node: unknown, pageUrl: URL, push: (raw: string) => void) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const x of node) walkJsonLdForRecipeImages(x, pageUrl, push);
    return;
  }
  if (typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (Array.isArray(o["@graph"])) {
    walkJsonLdForRecipeImages(o["@graph"], pageUrl, push);
  }
  const types = ([] as string[]).concat(o["@type"] as string | string[]).flat().filter(Boolean);
  const isRecipe = types.some((t) => /recipe/i.test(String(t)));
  if (isRecipe) {
    const img = o.image;
    if (typeof img === "string") {
      const abs = resolveUrl(img, pageUrl.href);
      if (abs && !isUnsafeFetchUrl(abs)) push(abs);
    } else if (Array.isArray(img)) {
      for (const it of img) {
        if (typeof it === "string") {
          const abs = resolveUrl(it, pageUrl.href);
          if (abs && !isUnsafeFetchUrl(abs)) push(abs);
        } else if (it && typeof it === "object") {
          const u = (it as { url?: string }).url;
          if (typeof u === "string") {
            const abs = resolveUrl(u, pageUrl.href);
            if (abs && !isUnsafeFetchUrl(abs)) push(abs);
          }
        }
      }
    } else if (img && typeof img === "object") {
      const u = (img as { url?: string }).url;
      if (typeof u === "string") {
        const abs = resolveUrl(u, pageUrl.href);
        if (abs && !isUnsafeFetchUrl(abs)) push(abs);
      }
    }
  }
}

function collectJsonLdImages(html: string, pageUrl: URL, push: (raw: string) => void) {
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as unknown;
      walkJsonLdForRecipeImages(data, pageUrl, push);
    } catch {
      // ignore invalid JSON-LD
    }
  }
}

function pickBestImage(candidates: string[], pageUrl: URL): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const href of candidates) {
    try {
      const iu = new URL(href);
      let s = scoreImageHost(iu, pageUrl);
      if (iu.protocol === "https:") s += 2;
      if (s > bestScore) {
        bestScore = s;
        best = href;
      }
    } catch {
      // skip
    }
  }
  return best;
}

/**
 * Picks hero image URL from already-fetched HTML (Open Graph / Twitter / JSON-LD / image_src).
 */
export function pickBannerImageFromHtml(html: string, finalUrl: string): string | null {
  let pageUrl: URL;
  try {
    pageUrl = new URL(finalUrl);
  } catch {
    return null;
  }
  const primary: string[] = [];
  const fallback: string[] = [];
  const seenPrimary = new Set<string>();
  const seenFallback = new Set<string>();

  const pushPrimary = (abs: string) => {
    if (seenPrimary.has(abs)) return;
    seenPrimary.add(abs);
    primary.push(abs);
  };
  const pushFallback = (abs: string) => {
    if (seenPrimary.has(abs) || seenFallback.has(abs)) return;
    seenFallback.add(abs);
    fallback.push(abs);
  };

  collectMetaImageRefs(html, pageUrl, pushPrimary);
  collectJsonLdImages(html, pageUrl, pushPrimary);
  collectArticleImgSrcs(html, pageUrl, pushFallback);

  const safePrimary = primary.filter((u) => !isUnsafeFetchUrl(u));
  const safeFallback = fallback.filter((u) => !isUnsafeFetchUrl(u));
  return pickBestImage(safePrimary, pageUrl) ?? pickBestImage(safeFallback, pageUrl);
}

/**
 * Fetches the recipe page HTML and picks the same hero image Pinterest would use.
 */
export async function discoverRecipeBannerImageUrl(pageUrlRaw: string): Promise<string | null> {
  if (isUnsafeFetchUrl(pageUrlRaw)) return null;
  const doc = await fetchPublicHtml(pageUrlRaw);
  if (!doc) return null;
  return pickBannerImageFromHtml(doc.html, doc.finalUrl);
}
