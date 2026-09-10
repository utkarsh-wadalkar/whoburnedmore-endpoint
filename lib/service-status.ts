import type { RowDataPacket } from "mysql2";

import { RENDERER_VERSION, isDatabaseConfigured, isPersistentCacheConfigured } from "./cache-config";
import { execute } from "./db";

export type ServiceState = "operational" | "degraded" | "maintenance";

export type StatusActivityBucket = {
  hour: string;
  originRequests: number;
  prepares: number;
  newProfiles: number;
  rendersSucceeded: number;
  rendersFailed: number;
};

export type PublicServiceStatus = {
  status: ServiceState;
  persistenceConfigured: boolean;
  announcement: string | null;
  updatedAt: string;
  rendererVersion: number;
  lastSuccessfulRenderAt: string | null;
  totals: {
    uniqueProfiles: number;
    currentCards: number;
    cardsGenerated: number;
    originRequests: number;
    prepares: number;
    successfulRenders: number;
    failedRenders: number;
  };
  last24Hours: {
    originRequests: number;
    prepares: number;
    newProfiles: number;
    cardsGenerated: number;
    renderFailures: number;
  };
  performance: {
    averageRenderMs: number | null;
    averageOriginResponseMs: number | null;
    renderSuccessPercent: number | null;
  };
  styles: {
    landscape: number;
    hero: number;
    report: number;
  };
  activity: StatusActivityBucket[];
};

type MetricsRow = RowDataPacket & {
  total_unique_profiles: string | number;
  current_cards: string | number;
  total_cards_generated: string | number;
  total_origin_requests: string | number;
  total_prepares: string | number;
  successful_renders: string | number;
  failed_renders: string | number;
  render_ms_sum: string | number;
  origin_response_ms_sum: string | number;
  renders_landscape: string | number;
  renders_hero: string | number;
  renders_report: string | number;
  consecutive_render_failures: string | number;
  last_successful_render_at: Date | string | null;
  last_render_failure_at: Date | string | null;
  maintenance_flag: boolean | number;
  announcement: string | null;
  updated_at: Date | string;
};

type HourlyRow = RowDataPacket & {
  bucket_hour: Date | string;
  origin_requests: string | number;
  prepares: string | number;
  new_profiles: string | number;
  renders_succeeded: string | number;
  renders_failed: string | number;
};

export async function getPublicServiceStatus(): Promise<PublicServiceStatus> {
  if (!isDatabaseConfigured()) return createUnconfiguredStatus();
  try {
    return await getServiceStatusUncached();
  } catch (error) {
    console.error("Status metrics query failed", error);
    return createUnconfiguredStatus();
  }
}

export function deriveServiceState(input: {
  maintenance: boolean;
  consecutiveFailures: number;
  lastSuccess: Date | null;
  lastFailure: Date | null;
  persistenceConfigured: boolean;
}): ServiceState {
  if (input.maintenance) return "maintenance";
  if (!input.persistenceConfigured) return "degraded";
  if (
    input.consecutiveFailures >= 3 &&
    input.lastFailure &&
    (!input.lastSuccess || input.lastFailure > input.lastSuccess)
  ) {
    return "degraded";
  }
  return "operational";
}

export function calculateServicePerformance(input: {
  successfulRenders: number;
  failedRenders: number;
  renderMsSum: number;
  originRequests: number;
  originResponseMsSum: number;
}): PublicServiceStatus["performance"] {
  const totalRenders = input.successfulRenders + input.failedRenders;
  return {
    averageRenderMs:
      input.successfulRenders > 0 ? Math.round(input.renderMsSum / input.successfulRenders) : null,
    averageOriginResponseMs:
      input.originRequests > 0 ? Math.round(input.originResponseMsSum / input.originRequests) : null,
    renderSuccessPercent:
      totalRenders > 0
        ? Math.round((input.successfulRenders / totalRenders) * 10_000) / 100
        : null,
  };
}

async function getServiceStatusUncached(): Promise<PublicServiceStatus> {
  const metricsRows = await execute<MetricsRow[]>(
    `SELECT total_unique_profiles, current_cards, total_cards_generated,
            total_origin_requests, total_prepares, successful_renders, failed_renders,
            render_ms_sum, origin_response_ms_sum, renders_landscape, renders_hero,
            renders_report, consecutive_render_failures, last_successful_render_at,
            last_render_failure_at, maintenance_flag, announcement, updated_at
       FROM service_metrics WHERE id = 1 LIMIT 1`,
  );
  const hourlyRows = await execute<HourlyRow[]>(
    `SELECT bucket_hour, origin_requests, prepares, new_profiles, renders_succeeded, renders_failed
       FROM usage_hourly
      WHERE bucket_hour >= DATE_SUB(DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:00:00'), INTERVAL 23 HOUR)
      ORDER BY bucket_hour ASC`,
  );
  const row = metricsRows[0];
  if (!row) return createUnconfiguredStatus();

  const activity = fillActivity(hourlyRows);
  const successfulRenders = numberValue(row.successful_renders);
  const failedRenders = numberValue(row.failed_renders);
  const totalOriginRequests = numberValue(row.total_origin_requests);
  const lastSuccess = nullableDate(row.last_successful_render_at);
  const lastFailure = nullableDate(row.last_render_failure_at);
  const persistenceConfigured = isPersistentCacheConfigured();

  return {
    status: deriveServiceState({
      maintenance: Boolean(row.maintenance_flag),
      consecutiveFailures: numberValue(row.consecutive_render_failures),
      lastSuccess,
      lastFailure,
      persistenceConfigured,
    }),
    persistenceConfigured,
    announcement: row.announcement,
    updatedAt: asDate(row.updated_at).toISOString(),
    rendererVersion: RENDERER_VERSION,
    lastSuccessfulRenderAt: lastSuccess?.toISOString() ?? null,
    totals: {
      uniqueProfiles: numberValue(row.total_unique_profiles),
      currentCards: numberValue(row.current_cards),
      cardsGenerated: numberValue(row.total_cards_generated),
      originRequests: totalOriginRequests,
      prepares: numberValue(row.total_prepares),
      successfulRenders,
      failedRenders,
    },
    last24Hours: {
      originRequests: sum(activity, "originRequests"),
      prepares: sum(activity, "prepares"),
      newProfiles: sum(activity, "newProfiles"),
      cardsGenerated: sum(activity, "rendersSucceeded"),
      renderFailures: sum(activity, "rendersFailed"),
    },
    performance: calculateServicePerformance({
      successfulRenders,
      failedRenders,
      renderMsSum: numberValue(row.render_ms_sum),
      originRequests: totalOriginRequests,
      originResponseMsSum: numberValue(row.origin_response_ms_sum),
    }),
    styles: {
      landscape: numberValue(row.renders_landscape),
      hero: numberValue(row.renders_hero),
      report: numberValue(row.renders_report),
    },
    activity,
  };
}

function fillActivity(rows: HourlyRow[], now = new Date()): StatusActivityBucket[] {
  const byHour = new Map(
    rows.map((row) => [hourKey(asDate(row.bucket_hour)), row] as const),
  );
  const currentHour = new Date(now);
  currentHour.setUTCMinutes(0, 0, 0);

  return Array.from({ length: 24 }, (_value, index) => {
    const hour = new Date(currentHour.getTime() - (23 - index) * 60 * 60 * 1000);
    const row = byHour.get(hourKey(hour));
    return {
      hour: hour.toISOString(),
      originRequests: row ? numberValue(row.origin_requests) : 0,
      prepares: row ? numberValue(row.prepares) : 0,
      newProfiles: row ? numberValue(row.new_profiles) : 0,
      rendersSucceeded: row ? numberValue(row.renders_succeeded) : 0,
      rendersFailed: row ? numberValue(row.renders_failed) : 0,
    };
  });
}

function createUnconfiguredStatus(): PublicServiceStatus {
  const now = new Date();
  return {
    status: "degraded",
    persistenceConfigured: false,
    announcement: "Persistent TiDB and Blob storage are not configured for this deployment.",
    updatedAt: now.toISOString(),
    rendererVersion: RENDERER_VERSION,
    lastSuccessfulRenderAt: null,
    totals: {
      uniqueProfiles: 0,
      currentCards: 0,
      cardsGenerated: 0,
      originRequests: 0,
      prepares: 0,
      successfulRenders: 0,
      failedRenders: 0,
    },
    last24Hours: {
      originRequests: 0,
      prepares: 0,
      newProfiles: 0,
      cardsGenerated: 0,
      renderFailures: 0,
    },
    performance: {
      averageRenderMs: null,
      averageOriginResponseMs: null,
      renderSuccessPercent: null,
    },
    styles: { landscape: 0, hero: 0, report: 0 },
    activity: fillActivity([], now),
  };
}

function sum(
  activity: StatusActivityBucket[],
  key: keyof Omit<StatusActivityBucket, "hour">,
): number {
  return activity.reduce((total, bucket) => total + bucket[key], 0);
}

function numberValue(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableDate(value: Date | string | null): Date | null {
  return value ? asDate(value) : null;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(`${value.replace(" ", "T")}Z`);
}

function hourKey(date: Date): string {
  return date.toISOString().slice(0, 13);
}
