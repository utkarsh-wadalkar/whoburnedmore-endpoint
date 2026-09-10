import { createHash } from "node:crypto";

import { load } from "cheerio";

import { profileUrl } from "./card";

const MAX_PROFILE_HTML_BYTES = 3 * 1024 * 1024;
const MAX_ASSET_BYTES = 1024 * 1024;
const PROFILE_TIMEOUT_MS = 12_000;
const ASSET_TIMEOUT_MS = 5_000;

const ALLOWED_ASSET_HOSTS = new Set([
  "whoburnedmore.com",
  "api.whoburnedmore.com",
  "avatars.githubusercontent.com",
  "lh3.googleusercontent.com",
  "randomuser.me",
  "storage.googleapis.com",
  "api.producthunt.com",
]);

export type CardSourceSnapshot = {
  handle: string;
  visibleText: string;
  visualStyles: string[];
  imageSources: string[];
  imageValidators: string[];
  markupSignature: string;
};

export type FetchedProfileSnapshot = {
  snapshot: CardSourceSnapshot;
  statsHash: string;
  fetchedAt: Date;
  expiresAt: Date;
};

export class ProfileSnapshotError extends Error {
  constructor(
    public readonly kind: "not-found" | "unavailable" | "unparseable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProfileSnapshotError";
  }
}

export async function fetchProfileSnapshot(handle: string): Promise<FetchedProfileSnapshot> {
  let response: Response;
  try {
    response = await fetch(profileUrl(handle), {
      cache: "no-store",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      redirect: "error",
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProfileSnapshotError("unavailable", "The public profile could not be fetched.", {
      cause: error,
    });
  }

  if (response.status === 404) {
    throw new ProfileSnapshotError("not-found", "The public profile is missing or private.");
  }
  if (!response.ok) {
    throw new ProfileSnapshotError("unavailable", `The public profile returned HTTP ${response.status}.`);
  }

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_PROFILE_HTML_BYTES) {
    throw new ProfileSnapshotError("unavailable", "The public profile response was unexpectedly large.");
  }

  const html = await response.text();
  if (Buffer.byteLength(html) > MAX_PROFILE_HTML_BYTES) {
    throw new ProfileSnapshotError("unavailable", "The public profile response was unexpectedly large.");
  }

  const parsed = parseProfileSnapshot(html, handle);
  const imageValidators = await Promise.all(parsed.imageSources.map(fingerprintAsset));
  const snapshot: CardSourceSnapshot = { ...parsed, imageValidators };
  const fetchedAt = new Date();

  return {
    snapshot,
    statsHash: hashSnapshot(snapshot),
    fetchedAt,
    expiresAt: new Date(fetchedAt.getTime() + 15 * 60 * 1000),
  };
}

export function parseProfileSnapshot(
  html: string,
  handle: string,
): Omit<CardSourceSnapshot, "imageValidators"> {
  const $ = load(html);
  const candidates: ReturnType<typeof $>[] = [];

  $("body *").each((_index, element) => {
    const node = $(element);
    const ownText = normalizeText(
      node
        .clone()
        .children()
        .remove()
        .end()
        .text(),
    );
    if (ownText.toLowerCase() !== "tokens burned") return;

    let current = node.parent();
    for (let depth = 0; depth < 10 && current.length > 0; depth += 1) {
      const text = normalizeText(current.text()).toLowerCase();
      if (
        text.includes("30-day burn") &&
        text.includes("npx whoburnedmore") &&
        text.includes("tokens burned")
      ) {
        candidates.push(current);
        break;
      }
      if (current.is("body")) break;
      current = current.parent();
    }
  });

  candidates.sort((a, b) => $.html(a).length - $.html(b).length);
  const root = candidates[0];
  if (!root) {
    throw new ProfileSnapshotError(
      "unparseable",
      "The official share-card data was not present in the public profile HTML.",
    );
  }

  const visualStyles = root
    .find("[style]")
    .map((_index, element) => normalizeStyle($(element).attr("style") || ""))
    .get()
    .filter(Boolean);

  const imageSources = Array.from(
    new Set(
      root
        .find("img[src]")
        .map((_index, element) => normalizeAssetUrl($(element).attr("src") || ""))
        .get()
        .filter(Boolean),
    ),
  ).slice(0, 4);

  const markupShape = root
    .find("*")
    .map((_index, element) => {
      const tagName = element.type === "tag" ? element.name : "node";
      const classes = ($(element).attr("class") || "")
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(".");
      return `${tagName}:${classes}`;
    })
    .get()
    .join("|");

  return {
    handle: handle.toLowerCase(),
    visibleText: normalizeText(root.text()),
    visualStyles,
    imageSources,
    markupSignature: sha256(markupShape),
  };
}

export function canonicalizeSnapshot(snapshot: CardSourceSnapshot): string {
  return JSON.stringify({
    handle: snapshot.handle.toLowerCase(),
    imageSources: snapshot.imageSources,
    imageValidators: snapshot.imageValidators,
    markupSignature: snapshot.markupSignature,
    visibleText: normalizeText(snapshot.visibleText),
    visualStyles: snapshot.visualStyles.map(normalizeStyle),
  });
}

export function hashSnapshot(snapshot: CardSourceSnapshot): string {
  return sha256(canonicalizeSnapshot(snapshot));
}

async function fingerprintAsset(source: string): Promise<string> {
  if (source.startsWith("data:")) return `data:${sha256(source)}`;

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return `url:${sha256(source)}`;
  }

  const allowed =
    url.protocol === "https:" &&
    (ALLOWED_ASSET_HOSTS.has(url.hostname) ||
      url.hostname.endsWith(".public.blob.vercel-storage.com"));
  if (!allowed) return `url:${sha256(source)}`;

  try {
    const head = await fetch(url, {
      method: "HEAD",
      redirect: "error",
      signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
    });
    const validator = [
      head.headers.get("etag"),
      head.headers.get("last-modified"),
      head.headers.get("content-length"),
    ]
      .filter(Boolean)
      .join(":");
    if (head.ok && validator) return `head:${validator}`;
  } catch {
    // Fall through to a bounded body fingerprint.
  }

  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(ASSET_TIMEOUT_MS),
    });
    const length = Number(response.headers.get("content-length") || 0);
    if (!response.ok || length > MAX_ASSET_BYTES) return `url:${sha256(source)}`;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ASSET_BYTES) return `url:${sha256(source)}`;
    return `body:${sha256(bytes)}`;
  } catch {
    return `url:${sha256(source)}`;
  }
}

function normalizeAssetUrl(source: string): string {
  if (!source) return "";
  try {
    const url = new URL(source, "https://whoburnedmore.com");
    url.searchParams.delete("dpl");
    return url.toString();
  } catch {
    return source;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeStyle(value: string): string {
  return value
    .split(";")
    .map((declaration) => declaration.trim().replace(/\s*:\s*/g, ":"))
    .filter(Boolean)
    .sort()
    .join(";");
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
