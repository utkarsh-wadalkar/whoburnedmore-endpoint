import { after } from "next/server";

import { isPersistentCacheConfigured } from "../../../../lib/cache-config";
import { cleanupExpiredCardAssets, preparePersistentCard } from "../../../../lib/card-service";
import { parseCardStyle, validateHandle } from "../../../../lib/card";
import { recordPrepareRequest } from "../../../../lib/persistent-card-store";
import { CardRenderError } from "../../../../lib/render-official-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PrepareBody = {
  handle?: unknown;
  style?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  let body: PrepareBody;
  try {
    const parsed: unknown = await request.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("Send a JSON body with handle and style.", 400);
    }
    body = parsed as PrepareBody;
  } catch {
    return jsonError("Send a JSON body with handle and style.", 400);
  }

  const handle = typeof body.handle === "string" ? validateHandle(body.handle.replace(/^@/, "")) : null;
  const style = typeof body.style === "string" ? parseCardStyle(body.style) : null;
  if (!handle || !style) {
    return jsonError("Use a public handle and one of: landscape, hero, report.", 400);
  }

  try {
    const result = await preparePersistentCard(handle, style);
    if (isPersistentCacheConfigured()) {
      after(async () => {
        const tasks: Promise<unknown>[] = [recordPrepareRequest()];
        if (result.status === "ready" && result.rendered) tasks.push(cleanupExpiredCardAssets());
        await Promise.allSettled(tasks);
      });
    }

    if (result.status === "preparing") {
      return Response.json(
        { status: "preparing", retryAfter: result.retryAfterSeconds },
        {
          status: 202,
          headers: { "cache-control": "no-store", "retry-after": String(result.retryAfterSeconds) },
        },
      );
    }

    const imageUrl = new URL(`/api/card/${handle}/${style}.png`, request.url).toString();
    return Response.json(
      {
        status: "ready",
        imageUrl,
        etag: result.card.imageEtag,
        renderedAt: result.card.renderedAt.toISOString(),
        fresh: result.fresh,
        rendered: result.rendered,
        persistence: isPersistentCacheConfigured() ? "tidb-blob" : "next-cache",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Card preparation failed", {
      handle,
      style,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof CardRenderError && error.kind === "not-found") {
      return jsonError("This WhoBurnedMore profile is missing or private.", 404);
    }
    return jsonError("WhoBurnedMore could not prepare this card. Try again shortly.", 502);
  }
}

function jsonError(message: string, status: number): Response {
  return Response.json({ status: "error", error: message }, { status, headers: { "cache-control": "no-store" } });
}
