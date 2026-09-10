import { describe, expect, it } from "vitest";

import * as playground from "../components/card-playground";

describe("card preview preparation", () => {
  it("prepares and verifies all three card styles concurrently", async () => {
    const prepareStyles: string[] = [];
    const verifiedStyles: string[] = [];
    const decodedStyles: string[] = [];
    let activePrepares = 0;
    let maximumActivePrepares = 0;
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);

    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input) === "/api/card/prepare") {
        const body = JSON.parse(String(init?.body)) as { handle: string; style: string };
        prepareStyles.push(body.style);
        expect(body.handle).toBe("sample-user");
        activePrepares += 1;
        maximumActivePrepares = Math.max(maximumActivePrepares, activePrepares);
        await new Promise((resolve) => setTimeout(resolve, 0));
        activePrepares -= 1;
        return Response.json({
          status: "ready",
          imageUrl: `https://cards.example/${body.style}.png`,
        });
      }

      const style = String(input).match(/\/(landscape|hero|report)\.png/)?.[1];
      if (style) verifiedStyles.push(style);
      return new Response(png, { headers: { "content-type": "image/png" } });
    };

    const previews = await playground.prepareCardPreviews({
      handle: "sample-user",
      signal: new AbortController().signal,
      fetcher,
      cacheBuster: () => 42,
      createObjectUrl: (blob) => `blob:${blob.size}`,
      decodeImage: async (url) => {
        decodedStyles.push(url);
      },
    });

    expect(maximumActivePrepares).toBe(3);
    expect(prepareStyles).toEqual(["landscape", "hero", "report"]);
    expect(verifiedStyles).toEqual(["landscape", "hero", "report"]);
    expect(decodedStyles).toEqual(["blob:9", "blob:9", "blob:9"]);
    expect(Object.keys(previews)).toEqual(["landscape", "hero", "report"]);
    expect(previews.hero).toBe("blob:9");
  });
});
