import { describe, expect, it } from "vitest";

import { GET } from "../app/api/card/[handle]/[style]/route";
import { parseCardStyle, profileUrl, validateHandle } from "../lib/card";
import {
  CARD_CACHE_CONTROL,
  createCardErrorResponse,
  createCardImageResponse,
} from "../lib/card-response";

describe("card route helpers", () => {
  it("accepts public profile handles without hardcoding a user", () => {
    expect(validateHandle("utkarsh-wadalkar")).toBe("utkarsh-wadalkar");
    expect(validateHandle("another_user")).toBe("another_user");
    expect(profileUrl("another_user")).toBe("https://whoburnedmore.com/u/another_user");
  });

  it("rejects values that cannot be safe profile paths", () => {
    expect(validateHandle("../admin")).toBeNull();
    expect(validateHandle("a profile")).toBeNull();
    expect(validateHandle("")).toBeNull();
  });

  it("accepts every documented card style and its PNG URL form", () => {
    expect(parseCardStyle("landscape.png")).toBe("landscape");
    expect(parseCardStyle("hero.png")).toBe("hero");
    expect(parseCardStyle("report.png")).toBe("report");
    expect(parseCardStyle("square.png")).toBeNull();
  });

  it("serves card bytes with CDN-friendly image headers", async () => {
    const response = createCardImageResponse(new Uint8Array([137, 80, 78, 71]));

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(CARD_CACHE_CONTROL);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([137, 80, 78, 71]);
  });

  it("returns a non-cacheable image error", async () => {
    const response = createCardErrorResponse("Profile is private.", 404);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("Profile is private.");
  });

  it("returns a readable error image for malformed public route parameters", async () => {
    const response = await GET(new Request("https://example.test/api/card/nope/not-a-card.png"), {
      params: Promise.resolve({ handle: "nope", style: "not-a-card.png" }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
  });
});
