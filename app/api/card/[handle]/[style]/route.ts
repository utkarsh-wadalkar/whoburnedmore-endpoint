import { after } from "next/server";

import { createCardErrorResponse, createCardImageResponse } from "../../../../../lib/card-response";
import { parseCardStyle, validateHandle } from "../../../../../lib/card";
import { isPersistentCacheConfigured } from "../../../../../lib/cache-config";
import { refreshCardInBackground, resolveCardDelivery } from "../../../../../lib/card-service";
import { recordOriginRequest, touchCardRequested } from "../../../../../lib/persistent-card-store";
import { CardRenderError } from "../../../../../lib/render-official-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{
    handle: string;
    style: string;
  }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const startedAt = performance.now();
  const { handle: rawHandle, style: rawStyle } = await context.params;
  const handle = validateHandle(rawHandle);
  const style = parseCardStyle(rawStyle);

  if (!handle || !style) {
    return createCardErrorResponse(
      "Use a public handle and one of: landscape.png, hero.png, report.png.",
      400,
    );
  }

  try {
    const card = await resolveCardDelivery(handle, style);
    if (card.persistent && isPersistentCacheConfigured()) {
      after(async () => {
        await Promise.allSettled([
          recordOriginRequest(performance.now() - startedAt),
          touchCardRequested(handle, style),
          ...(card.needsRefresh ? [refreshCardInBackground(handle, style)] : []),
        ]);
      });
    }
    return createCardImageResponse(card.bytes, card.contentType, {
      etag: card.etag,
      ifNoneMatch: request.headers.get("if-none-match"),
      lastModified: card.renderedAt,
    });
  } catch (error) {
    console.error("WhoBurnedMore card render failed", {
      handle,
      style,
      error: formatError(error),
    });

    if (error instanceof CardRenderError && error.kind === "not-found") {
      return createCardErrorResponse("This WhoBurnedMore profile is missing or private.", 404);
    }

    const preparing = error instanceof CardRenderError && /being prepared/i.test(error.message);
    return createCardErrorResponse(
      preparing
        ? "This WhoBurnedMore card is being prepared. Try again shortly."
        : "WhoBurnedMore could not render this card. Try again shortly.",
      preparing ? 503 : 502,
      preparing ? { "retry-after": "2" } : undefined,
    );
  }
}

function formatError(error: unknown): Record<string, string | undefined> {
  if (!(error instanceof Error)) return { message: String(error) };

  return {
    cause: error.cause instanceof Error ? error.cause.message : undefined,
    message: error.message,
    name: error.name,
    stack: error.stack,
  };
}
