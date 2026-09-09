import { expect, it } from "vitest";

import { type CardStyle } from "../lib/card";
import { renderOfficialCard } from "../lib/render-official-card";

const liveIt = process.env.WBM_LIVE === "1" ? it : it.skip;
const cardStyles: CardStyle[] = ["landscape", "hero", "report"];

liveIt.each(cardStyles)(
  "renders the official public %s card",
  async (style) => {
    const card = await renderOfficialCard("utkarsh-wadalkar", style);

    expect(card.contentType).toBe("image/png");
    expect(Array.from(card.bytes.subarray(0, 4))).toEqual([137, 80, 78, 71]);
    expect(card.bytes.byteLength).toBeGreaterThan(10_000);
  },
  60_000,
);
