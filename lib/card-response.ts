export const CARD_CACHE_CONTROL = "public, s-maxage=900, stale-while-revalidate=3600";

const ERROR_CACHE_CONTROL = "no-store";

type CardImageResponseOptions = {
  etag?: string;
  ifNoneMatch?: string | null;
  lastModified?: Date;
};

export function createCardImageResponse(
  bytes: Uint8Array,
  contentType = "image/png",
  options: CardImageResponseOptions = {},
): Response {
  const headers = new Headers({
    "cache-control": CARD_CACHE_CONTROL,
    "content-type": contentType,
    "content-disposition": "inline",
    "x-content-type-options": "nosniff",
  });
  if (options.etag) headers.set("etag", options.etag);
  if (options.lastModified) headers.set("last-modified", options.lastModified.toUTCString());

  if (options.etag && etagMatches(options.ifNoneMatch, options.etag)) {
    headers.delete("content-type");
    headers.delete("content-disposition");
    return new Response(null, { status: 304, headers });
  }

  const body = new Uint8Array(bytes).buffer;

  return new Response(body, {
    headers,
  });
}

export function createCardErrorResponse(
  message: string,
  status: number,
  extraHeaders?: HeadersInit,
): Response {
  const safeMessage = escapeXml(message);
  const image = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="WhoBurnedMore card unavailable">
  <rect width="1200" height="630" fill="#0c0c0c" rx="32"/>
  <rect x="64" y="64" width="8" height="176" rx="4" fill="#ff7900"/>
  <text x="104" y="134" fill="#f4f4f5" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="700">WhoBurnedMore card unavailable</text>
  <text x="104" y="206" fill="#a1a1aa" font-family="Arial, Helvetica, sans-serif" font-size="32">${safeMessage}</text>
</svg>`;

  return new Response(image, {
    status,
    headers: {
      "cache-control": ERROR_CACHE_CONTROL,
      "content-type": "image/svg+xml; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

export function etagMatches(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const target = normalizeEtag(etag);
  return ifNoneMatch
    .split(",")
    .map(normalizeEtag)
    .some((candidate) => candidate === "*" || candidate === target);
}

function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//i, "");
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '\"': "&quot;",
    };
    return entities[character] ?? character;
  });
}
