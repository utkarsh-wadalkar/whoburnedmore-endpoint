import { describe, expect, it } from "vitest";

import { getDatabaseSettings, RENDERER_VERSION } from "../lib/cache-config";
import {
  isFresh,
  normalizeEtag,
  retainedCardAfterRefreshFailure,
} from "../lib/card-service";
import {
  createOriginMetricsRecorder,
  isAssetCleanupEligible,
  isRenderLockExpired,
  renderBudgetAllows,
  renderLockLeaseSeconds,
  type StoredCard,
} from "../lib/persistent-card-store";
import {
  canonicalizeSnapshot,
  hashSnapshot,
  parseProfileSnapshot,
  type CardSourceSnapshot,
} from "../lib/profile-snapshot";
import { CardRenderError } from "../lib/render-official-card";
import { calculateServicePerformance, deriveServiceState } from "../lib/service-status";

const profileHtml = `<!doctype html>
<html><body>
  <main>
    <section class="unrelated"><span>TOKENS BURNED</span></section>
    <article class="share-card card-v4">
      <header><img src="https://avatars.githubusercontent.com/u/1?v=4" alt="Avatar"><b>@sample</b></header>
      <div><span>TOKENS BURNED</span><strong>804M</strong></div>
      <div><span>30-DAY BURN</span><i style="height: 20%; width: 2px"></i><i style="width:2px;height:80%"></i></div>
      <div class="tool-row"><span>codex</span><span style="width:61%">61%</span></div>
      <div class="tool-row"><span>claude</span><span style="width:31%">31%</span></div>
      <div class="tool-row"><span>gemini</span><span style="width:8%">8%</span></div>
      <footer>🔥 $ npx whoburnedmore</footer>
    </article>
  </main>
</body></html>`;

describe("persistent card helpers", () => {
  it("accepts Vercel TiDB integration variables and rejects system schemas", () => {
    const keys = [
      "DATABASE_URL",
      "TIDB_HOST",
      "TIDB_PORT",
      "TIDB_USER",
      "TIDB_PASSWORD",
      "TIDB_DATABASE",
    ] as const;
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

    try {
      delete process.env.DATABASE_URL;
      process.env.TIDB_HOST = "gateway.example.tidbcloud.com";
      process.env.TIDB_PORT = "4000";
      process.env.TIDB_USER = "app-user";
      process.env.TIDB_PASSWORD = "secret";
      process.env.TIDB_DATABASE = "whoburnedmore_card";

      expect(getDatabaseSettings()).toEqual({
        host: "gateway.example.tidbcloud.com",
        port: 4000,
        user: "app-user",
        password: "secret",
        database: "whoburnedmore_card",
      });

      process.env.TIDB_DATABASE = "sys";
      expect(getDatabaseSettings()).toBeNull();
    } finally {
      for (const key of keys) {
        if (original[key] === undefined) delete process.env[key];
        else process.env[key] = original[key];
      }
    }
  });

  it("extracts a stable share-card snapshot with every dynamic tool row", () => {
    const parsed = parseProfileSnapshot(profileHtml, "Sample");

    expect(parsed.handle).toBe("sample");
    expect(parsed.visibleText).toContain("codex");
    expect(parsed.visibleText).toContain("claude");
    expect(parsed.visibleText).toContain("gemini");
    expect(parsed.visualStyles).toContain("height:20%;width:2px");
    expect(parsed.imageSources).toEqual(["https://avatars.githubusercontent.com/u/1?v=4"]);
  });

  it("canonicalizes style declarations and changes hashes when visible data changes", () => {
    const base: CardSourceSnapshot = {
      ...parseProfileSnapshot(profileHtml, "sample"),
      imageValidators: ["head:avatar-v1"],
    };
    const reordered: CardSourceSnapshot = {
      ...base,
      visualStyles: base.visualStyles.map((style) => style.split(";").reverse().join(";")),
    };
    const changed: CardSourceSnapshot = { ...base, visibleText: base.visibleText.replace("804M", "805M") };

    expect(canonicalizeSnapshot(reordered)).toBe(canonicalizeSnapshot(base));
    expect(hashSnapshot(reordered)).toBe(hashSnapshot(base));
    expect(hashSnapshot(changed)).not.toBe(hashSnapshot(base));
  });

  it("requires both a recent source check and the current renderer version", () => {
    const card: StoredCard = {
      handle: "sample",
      style: "landscape",
      statsHash: "hash",
      rendererVersion: RENDERER_VERSION,
      imageUrl: "https://example.public.blob.vercel-storage.com/card.png",
      imageEtag: '"etag"',
      renderedAt: new Date("2026-09-10T09:00:00.000Z"),
      sourceCheckedAt: new Date("2026-09-10T09:50:00.000Z"),
      lastRequestedAt: new Date("2026-09-10T09:50:00.000Z"),
    };

    expect(isFresh(card, new Date("2026-09-10T10:00:00.000Z").getTime())).toBe(true);
    expect(isFresh(card, new Date("2026-09-10T10:06:00.000Z").getTime())).toBe(false);
    expect(isFresh({ ...card, rendererVersion: RENDERER_VERSION - 1 }, card.sourceCheckedAt!.getTime())).toBe(false);
  });

  it("normalizes Blob ETags for stable conditional responses", () => {
    expect(normalizeEtag("abc123")).toBe('"abc123"');
    expect(normalizeEtag('W/"abc123"')).toBe('"abc123"');
  });

  it("treats only expired locks and elapsed, undeleted assets as reclaimable", () => {
    const now = new Date("2026-09-10T10:00:00.000Z").getTime();

    expect(isRenderLockExpired(null, now)).toBe(true);
    expect(isRenderLockExpired(new Date("2026-09-10T09:59:59.999Z"), now)).toBe(true);
    expect(isRenderLockExpired(new Date("2026-09-10T10:00:01.000Z"), now)).toBe(false);
    expect(isAssetCleanupEligible(new Date("2026-09-10T10:00:00.000Z"), null, now)).toBe(true);
    expect(
      isAssetCleanupEligible(
        new Date("2026-09-10T09:00:00.000Z"),
        new Date("2026-09-10T09:30:00.000Z"),
        now,
      ),
    ).toBe(false);
  });

  it("keeps render leases beyond the function deadline and caps render starts", () => {
    expect(renderLockLeaseSeconds(60)).toBe(90);
    expect(renderBudgetAllows(17)).toBe(true);
    expect(renderBudgetAllows(18)).toBe(false);
  });

  it("retains a previous card when a background refresh fails transiently", () => {
    const card: StoredCard = {
      handle: "sample",
      style: "landscape",
      statsHash: "old-hash",
      rendererVersion: RENDERER_VERSION,
      imageUrl: "https://example.public.blob.vercel-storage.com/card.png",
      imageEtag: '"old-etag"',
      renderedAt: new Date("2026-09-10T09:00:00.000Z"),
      sourceCheckedAt: new Date("2026-09-10T09:00:00.000Z"),
      lastRequestedAt: new Date("2026-09-10T09:00:00.000Z"),
    };
    expect(
      retainedCardAfterRefreshFailure(
        new CardRenderError("unavailable", "Upstream timed out."),
        card,
        false,
      ),
    ).toMatchObject({ status: "ready", card, fresh: false, rendered: false });
    expect(
      retainedCardAfterRefreshFailure(
        new CardRenderError("not-found", "Profile is private."),
        card,
        false,
      ),
    ).toBeNull();
    expect(
      retainedCardAfterRefreshFailure(
        new CardRenderError("unavailable", "Blob repair failed."),
        card,
        true,
      ),
    ).toBeNull();
  });

  it("durably records every observed origin request without process-local buffering", async () => {
    const persisted: Array<[number, number]> = [];
    const recorder = createOriginMetricsRecorder(async (requests, responseMs) => {
      persisted.push([requests, responseMs]);
    });

    await recorder(12.6);
    await recorder(-5);
    expect(persisted).toEqual([
      [1, 13],
      [1, 0],
    ]);
  });

  it("derives public service state without exposing internal data", () => {
    const now = new Date("2026-09-10T10:00:00.000Z");
    expect(
      deriveServiceState({
        maintenance: false,
        consecutiveFailures: 0,
        lastSuccess: now,
        lastFailure: null,
        persistenceConfigured: true,
      }),
    ).toBe("operational");
    expect(
      deriveServiceState({
        maintenance: false,
        consecutiveFailures: 3,
        lastSuccess: new Date("2026-09-10T09:00:00.000Z"),
        lastFailure: now,
        persistenceConfigured: true,
      }),
    ).toBe("degraded");
    expect(
      deriveServiceState({
        maintenance: true,
        consecutiveFailures: 0,
        lastSuccess: now,
        lastFailure: null,
        persistenceConfigured: true,
      }),
    ).toBe("maintenance");

    expect(
      calculateServicePerformance({
        successfulRenders: 8,
        failedRenders: 2,
        renderMsSum: 12_000,
        originRequests: 4,
        originResponseMsSum: 168,
      }),
    ).toEqual({
      averageRenderMs: 1500,
      averageOriginResponseMs: 42,
      renderSuccessPercent: 80,
    });
  });
});
