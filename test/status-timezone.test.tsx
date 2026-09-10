import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

const activity = Array.from({ length: 24 }, (_value, index) => ({
  hour: new Date(Date.UTC(2026, 8, 10, index)).toISOString(),
  originRequests: index + 1,
  prepares: 0,
  newProfiles: 0,
  rendersSucceeded: 0,
  rendersFailed: 0,
}));

vi.mock("../lib/service-status", () => ({
  getPublicServiceStatus: vi.fn(async () => ({
    status: "operational",
    persistenceConfigured: true,
    announcement: null,
    updatedAt: "2026-09-10T23:00:00.000Z",
    rendererVersion: 2,
    lastSuccessfulRenderAt: "2026-09-10T23:00:00.000Z",
    totals: {
      uniqueProfiles: 4,
      currentCards: 10,
      cardsGenerated: 25,
      originRequests: 300,
      prepares: 0,
      successfulRenders: 25,
      failedRenders: 0,
    },
    last24Hours: {
      originRequests: 300,
      prepares: 0,
      newProfiles: 4,
      cardsGenerated: 25,
      renderFailures: 0,
    },
    performance: {
      averageRenderMs: 1_000,
      averageOriginResponseMs: 20,
      renderSuccessPercent: 100,
    },
    styles: { landscape: 9, hero: 8, report: 8 },
    activity,
  })),
}));

import StatusPage from "../app/status/page";

describe("status activity timeline", () => {
  test("renders graph times in Indian Standard Time with the half-hour offset", async () => {
    const page = await StatusPage();
    const markup = renderToStaticMarkup(createElement(() => page));

    expect(markup).toContain("IST · UTC+5:30");
    expect(markup).toContain("title=\"5:30 AM IST: 1 origin requests\"");
    expect(markup).toContain(">5:30 AM<");
    expect(markup).toContain(">11:30 AM<");
    expect(markup).toContain(">5:30 PM<");
    expect(markup).toContain(">11:30 PM<");
    expect(markup).toContain(">4:30 AM<");
  });
});
