export const CARD_STYLES = ["landscape", "hero", "report"] as const;

export type CardStyle = (typeof CARD_STYLES)[number];

export const UPSTREAM_ORIGIN = "https://whoburnedmore.com";

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function validateHandle(handle: string): string | null {
  return HANDLE_PATTERN.test(handle) ? handle : null;
}

export function parseCardStyle(style: string): CardStyle | null {
  const normalized = style.toLowerCase().replace(/\.png$/, "");
  return CARD_STYLES.includes(normalized as CardStyle) ? (normalized as CardStyle) : null;
}

export function profileUrl(handle: string): string {
  return `${UPSTREAM_ORIGIN}/u/${encodeURIComponent(handle)}`;
}
