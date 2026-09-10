import { describe, expect, test, vi } from "vitest";

vi.mock("../lib/service-status", () => ({
  getPublicServiceStatus: vi.fn(async () => ({
    status: "operational",
    persistenceConfigured: true,
    announcement: null,
    updatedAt: "2026-09-10T19:02:46.054Z",
    rendererVersion: 2,
    lastSuccessfulRenderAt: "2026-09-10T19:02:41.744Z",
    totals: {
      uniqueProfiles: 4,
      currentCards: 10,
      cardsGenerated: 25,
      originRequests: 154,
      prepares: 122,
      successfulRenders: 25,
      failedRenders: 4,
    },
    last24Hours: {
      originRequests: 154,
      prepares: 122,
      newProfiles: 4,
      cardsGenerated: 25,
      renderFailures: 4,
    },
    performance: {
      averageRenderMs: 16_495,
      averageOriginResponseMs: 1_599,
      renderSuccessPercent: 86.21,
    },
    styles: { landscape: 9, hero: 8, report: 8 },
    activity: [],
  })),
}));

describe("status API freshness", () => {
  test("limits public status caching to 30 seconds", async () => {
    const { GET } = await import("../app/api/status/route");

    const response = await GET();

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=30, must-revalidate",
    );
  });
});
