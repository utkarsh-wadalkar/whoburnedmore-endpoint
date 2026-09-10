import { createHash, randomUUID } from "node:crypto";

import { del, put } from "@vercel/blob";
import { revalidateTag, unstable_cache } from "next/cache";

import {
  CARD_DATA_CACHE_SECONDS,
  CARD_REFRESH_MS,
  RENDERER_VERSION,
  isPersistentCacheConfigured,
} from "./cache-config";
import type { CardStyle } from "./card";
import {
  type RenderedCard,
  CardRenderError,
  renderCachedOfficialCardImage,
  renderOfficialCard,
} from "./render-official-card";
import {
  claimRenderLock,
  commitRenderedCard,
  getFreshProfileSnapshot,
  getStoredCard,
  invalidateProfileCards,
  listExpiredAssets,
  markAssetDeleted,
  markCardCheckedUnchanged,
  recordRenderFailure,
  type StoredCard,
  upsertProfileSnapshot,
} from "./persistent-card-store";
import { fetchProfileSnapshot, ProfileSnapshotError } from "./profile-snapshot";

const MAX_CARD_BYTES = 12 * 1024 * 1024;
const BLOB_TIMEOUT_MS = 10_000;

export type CardDelivery = RenderedCard & {
  etag: string;
  renderedAt: Date;
  needsRefresh: boolean;
  persistent: boolean;
};

export type PrepareCardResult =
  | {
      status: "ready";
      card: StoredCard;
      fresh: boolean;
      rendered: boolean;
      bytes?: Uint8Array;
    }
  | {
      status: "preparing";
      retryAfterSeconds: number;
    };

type CachedPersistentCard = {
  bytes: string;
  etag: string;
  renderedAt: string;
  sourceCheckedAt: string | null;
  rendererVersion: number;
};

export async function resolveCardDelivery(
  handle: string,
  style: CardStyle,
): Promise<CardDelivery> {
  if (!isPersistentCacheConfigured()) {
    const card = await renderCachedOfficialCardImage(handle, style);
    return {
      ...card,
      etag: quoteEtag(hashBytes(card.bytes)),
      renderedAt: new Date(),
      needsRefresh: false,
      persistent: false,
    };
  }

  let forceRepair = false;
  try {
    const cached = await getCachedPersistentCard(handle, style);
    if (cached) return mapCachedDelivery(cached);
  } catch (error) {
    forceRepair = true;
    console.error("Persistent card lookup failed; attempting a repair render", {
      handle,
      style,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const prepared = await preparePersistentCard(handle, style, { forceRender: forceRepair });
  if (prepared.status === "preparing") {
    throw new CardRenderError("unavailable", "This card is being prepared. Try again shortly.");
  }

  const bytes = prepared.bytes ?? (await fetchBlobImage(prepared.card.imageUrl));
  return {
    bytes,
    contentType: "image/png",
    etag: normalizeEtag(prepared.card.imageEtag || hashBytes(bytes)),
    renderedAt: prepared.card.renderedAt,
    needsRefresh: !isFresh(prepared.card),
    persistent: true,
  };
}

export async function preparePersistentCard(
  handle: string,
  style: CardStyle,
  options: { forceRender?: boolean } = {},
): Promise<PrepareCardResult> {
  if (!isPersistentCacheConfigured()) {
    const card = await renderCachedOfficialCardImage(handle, style);
    const now = new Date();
    return {
      status: "ready",
      fresh: true,
      rendered: true,
      bytes: card.bytes,
      card: {
        handle,
        style,
        statsHash: hashBytes(card.bytes),
        rendererVersion: RENDERER_VERSION,
        imageUrl: "",
        imageEtag: quoteEtag(hashBytes(card.bytes)),
        renderedAt: now,
        sourceCheckedAt: now,
        lastRequestedAt: now,
      },
    };
  }

  const beforeLock = await getStoredCard(handle, style);
  if (beforeLock && isFresh(beforeLock) && !options.forceRender) {
    return { status: "ready", card: beforeLock, fresh: true, rendered: false };
  }

  const lockToken = randomUUID();
  const claimed = await claimRenderLock(handle, style, lockToken);
  if (!claimed) {
    if (options.forceRender) return { status: "preparing", retryAfterSeconds: 2 };
    const existing = await getStoredCard(handle, style);
    if (existing) {
      return { status: "ready", card: existing, fresh: isFresh(existing), rendered: false };
    }
    return { status: "preparing", retryAfterSeconds: 2 };
  }

  try {
    const existing = await getStoredCard(handle, style);
    let statsHash: string | null = null;

    try {
      const cachedProfile = options.forceRender ? null : await getFreshProfileSnapshot(handle);
      const fetched = cachedProfile ?? (await fetchProfileSnapshot(handle));
      statsHash = fetched.statsHash;
      if (!cachedProfile) await upsertProfileSnapshot(handle, fetched);
    } catch (error) {
      if (error instanceof ProfileSnapshotError && error.kind === "not-found") {
        await invalidateProfileCards(handle);
        expireProfileCardDataCaches(handle);
        throw new CardRenderError("not-found", "The public profile is missing or private.", {
          cause: error,
        });
      }
      console.warn("Profile fingerprint unavailable; using conservative regeneration", {
        handle,
        style,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (
      existing &&
      !options.forceRender &&
      statsHash &&
      existing.statsHash === statsHash &&
      existing.rendererVersion === RENDERER_VERSION
    ) {
      await markCardCheckedUnchanged(handle, style, lockToken, statsHash);
      expireCardDataCache(handle, style);
      const checked = (await getStoredCard(handle, style)) ?? existing;
      return { status: "ready", card: checked, fresh: true, rendered: false };
    }

    const renderStartedAt = performance.now();
    const rendered = await renderOfficialCard(handle, style);
    validatePng(rendered.bytes);
    const renderDurationMs = performance.now() - renderStartedAt;
    statsHash ??= hashBytes(rendered.bytes);

    const blob = await uploadCardImage(handle, style, statsHash, rendered.bytes);
    const renderedAt = new Date();
    await commitRenderedCard({
      handle,
      style,
      statsHash,
      imageUrl: blob.url,
      imageEtag: normalizeEtag(blob.etag),
      renderedAt,
      renderDurationMs,
      lockToken,
    });
    expireCardDataCache(handle, style);

    const stored = await getStoredCard(handle, style);
    if (!stored) throw new Error("The rendered card pointer was not persisted.");
    return {
      status: "ready",
      card: stored,
      fresh: true,
      rendered: true,
      bytes: rendered.bytes,
    };
  } catch (error) {
    await recordRenderFailure(handle, style, lockToken, error).catch((metricsError) => {
      console.error("Could not record render failure", metricsError);
    });
    if (error instanceof CardRenderError) throw error;
    throw new CardRenderError("unavailable", "The persistent card refresh did not complete.", {
      cause: error,
    });
  }
}

export async function refreshCardInBackground(handle: string, style: CardStyle): Promise<void> {
  try {
    const result = await preparePersistentCard(handle, style);
    if (result.status === "ready" && result.rendered) {
      await cleanupExpiredCardAssets();
    }
  } catch (error) {
    console.error("Background card refresh failed", {
      handle,
      style,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function isFresh(card: StoredCard, now = Date.now()): boolean {
  return (
    card.rendererVersion === RENDERER_VERSION &&
    card.sourceCheckedAt !== null &&
    now - card.sourceCheckedAt.getTime() < CARD_REFRESH_MS
  );
}

export function cardDataCacheTag(handle: string, style: CardStyle): string {
  return `card:${handle.toLowerCase()}:${style}`;
}

async function getCachedPersistentCard(
  handle: string,
  style: CardStyle,
): Promise<CachedPersistentCard | null> {
  const cachedLoader = unstable_cache(
    async () => {
      const stored = await getStoredCard(handle, style);
      if (!stored) return null;
      const bytes = await fetchBlobImage(stored.imageUrl);
      return {
        bytes: Buffer.from(bytes).toString("base64"),
        etag: normalizeEtag(stored.imageEtag || hashBytes(bytes)),
        renderedAt: stored.renderedAt.toISOString(),
        sourceCheckedAt: stored.sourceCheckedAt?.toISOString() ?? null,
        rendererVersion: stored.rendererVersion,
      } satisfies CachedPersistentCard;
    },
    ["persistent-card-image", handle.toLowerCase(), style],
    {
      revalidate: CARD_DATA_CACHE_SECONDS,
      tags: [cardDataCacheTag(handle, style)],
    },
  );
  return cachedLoader();
}

function mapCachedDelivery(cached: CachedPersistentCard): CardDelivery {
  const sourceCheckedAt = cached.sourceCheckedAt ? new Date(cached.sourceCheckedAt) : null;
  const needsRefresh =
    cached.rendererVersion !== RENDERER_VERSION ||
    !sourceCheckedAt ||
    Date.now() - sourceCheckedAt.getTime() >= CARD_REFRESH_MS;
  return {
    bytes: new Uint8Array(Buffer.from(cached.bytes, "base64")),
    contentType: "image/png",
    etag: cached.etag,
    renderedAt: new Date(cached.renderedAt),
    needsRefresh,
    persistent: true,
  };
}

async function uploadCardImage(
  handle: string,
  style: CardStyle,
  statsHash: string,
  bytes: Uint8Array,
) {
  const pathname = `cards/v${RENDERER_VERSION}/${handle.toLowerCase()}/${style}/${statsHash}.png`;
  return put(pathname, Buffer.from(bytes), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 365 * 24 * 60 * 60,
    contentType: "image/png",
  });
}

async function fetchBlobImage(imageUrl: string): Promise<Uint8Array> {
  const url = new URL(imageUrl);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".public.blob.vercel-storage.com")
  ) {
    throw new Error("The stored card URL is not a trusted public Vercel Blob URL.");
  }

  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(BLOB_TIMEOUT_MS),
  });
  const length = Number(response.headers.get("content-length") || 0);
  if (!response.ok || length > MAX_CARD_BYTES) {
    throw new Error("The stored card image could not be loaded.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  validatePng(bytes);
  return bytes;
}

export async function cleanupExpiredCardAssets(): Promise<void> {
  const assets = await listExpiredAssets();
  for (const asset of assets) {
    await del(asset.imageUrl);
    await markAssetDeleted(asset.id);
  }
}

function expireCardDataCache(handle: string, style: CardStyle): void {
  revalidateTag(cardDataCacheTag(handle, style), { expire: 0 });
}

function expireProfileCardDataCaches(handle: string): void {
  for (const style of ["landscape", "hero", "report"] as const) {
    expireCardDataCache(handle, style);
  }
}

function validatePng(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 8 ||
    bytes.byteLength > MAX_CARD_BYTES ||
    bytes[0] !== 137 ||
    bytes[1] !== 80 ||
    bytes[2] !== 78 ||
    bytes[3] !== 71
  ) {
    throw new Error("The rendered card was not a valid PNG image.");
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeEtag(etag: string): string {
  const normalized = etag.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  return quoteEtag(normalized);
}

function quoteEtag(value: string): string {
  return `"${value.replace(/["\\]/g, "")}"`;
}
