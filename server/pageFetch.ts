import { isIPv4 } from "node:net";
import { URL } from "node:url";

export const MAX_HTML_BYTES = 900_000;
export const FETCH_TIMEOUT_MS = 12_000;

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return true;
  if (!isIPv4(h)) return false;
  const parts = h.split(".").map((x) => Number(x));
  const [a, b] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** True if the URL must not be fetched (SSRF guard). */
export function isUnsafeFetchUrl(href: string): boolean {
  try {
    const u = new URL(href);
    if (u.protocol !== "https:" && u.protocol !== "http:") return true;
    if (isBlockedHostname(u.hostname)) return true;
    return false;
  } catch {
    return true;
  }
}

export type FetchedHtml = { html: string; finalUrl: string };

/**
 * Fetches public HTML for a URL (same guardrails as recipe image discovery).
 */
export async function fetchPublicHtml(pageUrlRaw: string): Promise<FetchedHtml | null> {
  if (isUnsafeFetchUrl(pageUrlRaw)) return null;
  let pageUrl: URL;
  try {
    pageUrl = new URL(pageUrlRaw);
  } catch {
    return null;
  }

  const res = await fetch(pageUrl.href, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (compatible; BigBadMeals/1.0; +https://github.com/BigBadApps/BigBadMeals) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) return null;
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
    return null;
  }

  const buf = await res.arrayBuffer();
  const slice = buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf;
  const html = new TextDecoder("utf-8", { fatal: false }).decode(slice);
  return { html, finalUrl: res.url || pageUrl.href };
}
