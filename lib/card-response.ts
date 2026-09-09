export const CARD_CACHE_CONTROL = "public, s-maxage=900, stale-while-revalidate=3600";

const ERROR_CACHE_CONTROL = "no-store";

export function createCardImageResponse(bytes: Uint8Array, contentType = "image/png"): Response {
  const body = new Uint8Array(bytes).buffer;

  return new Response(body, {
    headers: {
      "cache-control": CARD_CACHE_CONTROL,
      "content-type": contentType,
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
    },
  });
}

export function createCardErrorResponse(message: string, status: number): Response {
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
    },
  });
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
