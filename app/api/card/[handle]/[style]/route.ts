import { createCardErrorResponse, createCardImageResponse } from "../../../../../lib/card-response";
import { parseCardStyle, validateHandle } from "../../../../../lib/card";
import { CardRenderError, renderOfficialCard } from "../../../../../lib/render-official-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{
    handle: string;
    style: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
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
    const card = await renderOfficialCard(handle, style);
    return createCardImageResponse(card.bytes, card.contentType);
  } catch (error) {
    if (error instanceof CardRenderError && error.kind === "not-found") {
      return createCardErrorResponse("This WhoBurnedMore profile is missing or private.", 404);
    }

    return createCardErrorResponse("WhoBurnedMore could not render this card. Try again shortly.", 502);
  }
}
