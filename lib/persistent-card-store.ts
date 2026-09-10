import { randomUUID } from "node:crypto";

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

import { CARD_ASSET_GRACE_SECONDS, RENDERER_VERSION } from "./cache-config";
import type { CardStyle } from "./card";
import { execute, withTransaction } from "./db";
import type { CardSourceSnapshot, FetchedProfileSnapshot } from "./profile-snapshot";

const MAX_RENDER_STARTS_PER_MINUTE = 18;
const RENDER_LOCK_LEASE_SECONDS = renderLockLeaseSeconds(60);

export type StoredCard = {
  handle: string;
  style: CardStyle;
  statsHash: string | null;
  rendererVersion: number;
  imageUrl: string;
  imageEtag: string | null;
  renderedAt: Date;
  sourceCheckedAt: Date | null;
  lastRequestedAt: Date;
};

type CardRow = RowDataPacket & {
  handle: string;
  style: CardStyle;
  stats_hash: string | null;
  renderer_version: number;
  image_url: string | null;
  image_etag: string | null;
  rendered_at: Date | string | null;
  source_checked_at: Date | string | null;
  last_requested_at: Date | string;
};

type ProfileRow = RowDataPacket & {
  stats_json: string | CardSourceSnapshot;
  stats_hash: string;
  fetched_at: Date | string;
  expires_at: Date | string;
};

type RenderBudgetRow = RowDataPacket & {
  render_count: string | number;
};

export type PendingAssetDeletion = {
  id: string;
  imageUrl: string;
};

export function isRenderLockExpired(lockExpiresAt: Date | null, now = Date.now()): boolean {
  return lockExpiresAt === null || lockExpiresAt.getTime() < now;
}

export function isAssetCleanupEligible(
  deleteAfter: Date | null,
  deletedAt: Date | null,
  now = Date.now(),
): boolean {
  return deleteAfter !== null && deletedAt === null && deleteAfter.getTime() <= now;
}

export function renderLockLeaseSeconds(maxDurationSeconds: number): number {
  return maxDurationSeconds + 30;
}

export function renderBudgetAllows(currentStarts: number): boolean {
  return currentStarts < MAX_RENDER_STARTS_PER_MINUTE;
}

export async function getStoredCard(handle: string, style: CardStyle): Promise<StoredCard | null> {
  const rows = await execute<CardRow[]>(
    `SELECT handle, style, stats_hash, renderer_version, image_url, image_etag,
            rendered_at, source_checked_at, last_requested_at
       FROM card_cache
      WHERE handle = ? AND style = ? AND image_url IS NOT NULL
      LIMIT 1`,
    [handle, style],
  );
  return rows[0] ? mapCard(rows[0]) : null;
}

export async function touchCardRequested(handle: string, style: CardStyle): Promise<void> {
  await execute<ResultSetHeader>(
    `UPDATE card_cache
        SET last_requested_at = UTC_TIMESTAMP(3)
      WHERE handle = ? AND style = ?`,
    [handle, style],
  );
}

export async function claimRenderLock(
  handle: string,
  style: CardStyle,
  lockToken: string,
): Promise<boolean> {
  return withTransaction(async (connection) => {
    await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO card_cache
         (handle, style, renderer_version, last_requested_at, render_status)
       VALUES (?, ?, ?, UTC_TIMESTAMP(3), 'empty')`,
      [handle, style, RENDERER_VERSION],
    );

    const [claim] = await connection.execute<ResultSetHeader>(
      `UPDATE card_cache
          SET lock_token = ?,
              lock_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${RENDER_LOCK_LEASE_SECONDS} SECOND),
              render_status = 'rendering',
              last_requested_at = UTC_TIMESTAMP(3)
        WHERE handle = ? AND style = ?
          AND (lock_expires_at IS NULL OR lock_expires_at < UTC_TIMESTAMP(3))`,
      [lockToken, handle, style],
    );
    if (claim.affectedRows !== 1) return false;

    if (await consumeRenderBudget(connection)) return true;

    await connection.execute<ResultSetHeader>(
      `UPDATE card_cache
          SET lock_token = NULL, lock_expires_at = NULL,
              render_status = IF(image_url IS NULL, 'empty', 'ready')
        WHERE handle = ? AND style = ? AND lock_token = ?`,
      [handle, style, lockToken],
    );
    return false;
  });
}

async function consumeRenderBudget(connection: PoolConnection): Promise<boolean> {
  await connection.execute<ResultSetHeader>(
    `INSERT IGNORE INTO render_rate_limits (bucket_minute, render_count, updated_at)
     VALUES (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:00'), 0, UTC_TIMESTAMP(3))`,
  );
  const [rows] = await connection.execute<RenderBudgetRow[]>(
    `SELECT render_count
       FROM render_rate_limits
      WHERE bucket_minute = DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:00')
      FOR UPDATE`,
  );
  const currentStarts = Number(rows[0]?.render_count ?? MAX_RENDER_STARTS_PER_MINUTE);
  if (!renderBudgetAllows(currentStarts)) return false;

  await connection.execute<ResultSetHeader>(
    `UPDATE render_rate_limits
        SET render_count = render_count + 1, updated_at = UTC_TIMESTAMP(3)
      WHERE bucket_minute = DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:00')`,
  );
  return true;
}

export async function upsertProfileSnapshot(
  handle: string,
  fetched: FetchedProfileSnapshot,
): Promise<boolean> {
  const insert = await execute<ResultSetHeader>(
    `INSERT IGNORE INTO profile_cache
       (handle, stats_json, stats_hash, fetched_at, expires_at, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      handle,
      JSON.stringify(fetched.snapshot),
      fetched.statsHash,
      fetched.fetchedAt,
      fetched.expiresAt,
    ],
  );

  await execute<ResultSetHeader>(
    `UPDATE profile_cache
        SET stats_json = ?, stats_hash = ?, fetched_at = ?, expires_at = ?,
            last_seen_at = UTC_TIMESTAMP(3)
      WHERE handle = ?`,
    [
      JSON.stringify(fetched.snapshot),
      fetched.statsHash,
      fetched.fetchedAt,
      fetched.expiresAt,
      handle,
    ],
  );

  if (insert.affectedRows === 1) await recordNewProfile();
  return insert.affectedRows === 1;
}

export async function getFreshProfileSnapshot(handle: string): Promise<FetchedProfileSnapshot | null> {
  const rows = await execute<ProfileRow[]>(
    `SELECT stats_json, stats_hash, fetched_at, expires_at
       FROM profile_cache
      WHERE handle = ? AND expires_at > UTC_TIMESTAMP(3)
      LIMIT 1`,
    [handle],
  );
  const row = rows[0];
  if (!row) return null;

  const snapshot =
    typeof row.stats_json === "string"
      ? (JSON.parse(row.stats_json) as CardSourceSnapshot)
      : row.stats_json;
  return {
    snapshot,
    statsHash: row.stats_hash,
    fetchedAt: asDate(row.fetched_at),
    expiresAt: asDate(row.expires_at),
  };
}

export async function markCardCheckedUnchanged(
  handle: string,
  style: CardStyle,
  lockToken: string,
  statsHash: string,
): Promise<void> {
  await execute<ResultSetHeader>(
    `UPDATE card_cache
        SET stats_hash = ?, source_checked_at = UTC_TIMESTAMP(3), render_status = 'ready',
            lock_token = NULL, lock_expires_at = NULL, last_error = NULL, last_error_at = NULL
      WHERE handle = ? AND style = ? AND lock_token = ?`,
    [statsHash, handle, style, lockToken],
  );
}

export async function commitRenderedCard(input: {
  handle: string;
  style: CardStyle;
  statsHash: string;
  imageUrl: string;
  imageEtag: string;
  renderedAt: Date;
  renderDurationMs: number;
  lockToken: string;
}): Promise<void> {
  await withTransaction(async (connection) => {
    const [rows] = await connection.execute<CardRow[]>(
      `SELECT image_url
         FROM card_cache
        WHERE handle = ? AND style = ? AND lock_token = ?
        FOR UPDATE`,
      [input.handle, input.style, input.lockToken],
    );
    const existingUrl = rows[0]?.image_url ?? null;
    const isFirstCard = existingUrl === null;

    await connection.execute<ResultSetHeader>(
      `INSERT INTO card_assets
         (id, handle, style, stats_hash, renderer_version, image_url, image_etag, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         image_url = VALUES(image_url), image_etag = VALUES(image_etag),
         created_at = VALUES(created_at), superseded_at = NULL,
         delete_after = NULL, deleted_at = NULL`,
      [
        randomUUID(),
        input.handle,
        input.style,
        input.statsHash,
        RENDERER_VERSION,
        input.imageUrl,
        input.imageEtag,
        input.renderedAt,
      ],
    );

    if (existingUrl && existingUrl !== input.imageUrl) {
      await connection.execute<ResultSetHeader>(
        `UPDATE card_assets
            SET superseded_at = UTC_TIMESTAMP(3),
                delete_after = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${CARD_ASSET_GRACE_SECONDS} SECOND)
          WHERE image_url = ? AND deleted_at IS NULL`,
        [existingUrl],
      );
    }

    const [update] = await connection.execute<ResultSetHeader>(
      `UPDATE card_cache
          SET stats_hash = ?, renderer_version = ?, image_url = ?, image_etag = ?,
              rendered_at = ?, source_checked_at = UTC_TIMESTAMP(3), render_status = 'ready',
              lock_token = NULL, lock_expires_at = NULL, last_error = NULL, last_error_at = NULL
        WHERE handle = ? AND style = ? AND lock_token = ?`,
      [
        input.statsHash,
        RENDERER_VERSION,
        input.imageUrl,
        input.imageEtag,
        input.renderedAt,
        input.handle,
        input.style,
        input.lockToken,
      ],
    );
    if (update.affectedRows !== 1) {
      throw new Error("The render lock expired before the card pointer was updated.");
    }

    const styleColumn = styleMetricColumn(input.style);
    await connection.execute<ResultSetHeader>(
      `UPDATE service_metrics
          SET current_cards = current_cards + ?,
              total_cards_generated = total_cards_generated + 1,
              successful_renders = successful_renders + 1,
              render_ms_sum = render_ms_sum + ?,
              ${styleColumn} = ${styleColumn} + 1,
              consecutive_render_failures = 0,
              last_successful_render_at = UTC_TIMESTAMP(3),
              updated_at = UTC_TIMESTAMP(3)
        WHERE id = 1`,
      [isFirstCard ? 1 : 0, Math.max(0, Math.round(input.renderDurationMs))],
    );

    await connection.execute<ResultSetHeader>(
      `INSERT INTO usage_hourly
         (bucket_hour, renders_succeeded, render_ms_sum, updated_at)
       VALUES (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:00:00'), 1, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         renders_succeeded = renders_succeeded + 1,
         render_ms_sum = render_ms_sum + VALUES(render_ms_sum),
         updated_at = UTC_TIMESTAMP(3)`,
      [Math.max(0, Math.round(input.renderDurationMs))],
    );
  });
}

export async function recordRenderFailure(
  handle: string,
  style: CardStyle,
  lockToken: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await withTransaction(async (connection) => {
    await connection.execute<ResultSetHeader>(
      `UPDATE card_cache
          SET render_status = IF(image_url IS NULL, 'failed', 'ready'),
              lock_token = NULL, lock_expires_at = NULL,
              last_error = ?, last_error_at = UTC_TIMESTAMP(3)
        WHERE handle = ? AND style = ? AND lock_token = ?`,
      [message.slice(0, 500), handle, style, lockToken],
    );
    await connection.execute<ResultSetHeader>(
      `UPDATE service_metrics
          SET failed_renders = failed_renders + 1,
              consecutive_render_failures = consecutive_render_failures + 1,
              last_render_failure_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
        WHERE id = 1`,
    );
    await connection.execute<ResultSetHeader>(
      `INSERT INTO usage_hourly (bucket_hour, renders_failed, updated_at)
       VALUES (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:00:00'), 1, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE renders_failed = renders_failed + 1, updated_at = UTC_TIMESTAMP(3)`,
    );
  });
}

export async function invalidateProfileCards(handle: string): Promise<void> {
  await withTransaction(async (connection) => {
    const [rows] = await connection.execute<(RowDataPacket & { image_url: string })[]>(
      `SELECT image_url FROM card_cache WHERE handle = ? AND image_url IS NOT NULL FOR UPDATE`,
      [handle],
    );
    await connection.execute<ResultSetHeader>(
      `UPDATE profile_cache
          SET expires_at = UTC_TIMESTAMP(3), last_seen_at = UTC_TIMESTAMP(3)
        WHERE handle = ?`,
      [handle],
    );
    for (const row of rows) {
      await connection.execute<ResultSetHeader>(
        `UPDATE card_assets
            SET superseded_at = UTC_TIMESTAMP(3),
                delete_after = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${CARD_ASSET_GRACE_SECONDS} SECOND)
          WHERE image_url = ? AND deleted_at IS NULL`,
        [row.image_url],
      );
    }
    await connection.execute<ResultSetHeader>(
      `UPDATE card_cache
          SET image_url = NULL, image_etag = NULL, rendered_at = NULL,
              render_status = 'failed', lock_token = NULL, lock_expires_at = NULL,
              last_error = 'Profile missing or private', last_error_at = UTC_TIMESTAMP(3)
        WHERE handle = ?`,
      [handle],
    );
    if (rows.length > 0) {
      await connection.execute<ResultSetHeader>(
        `UPDATE service_metrics
            SET current_cards = GREATEST(0, current_cards - ?), updated_at = UTC_TIMESTAMP(3)
          WHERE id = 1`,
        [rows.length],
      );
    }
  });
}

export function createOriginMetricsRecorder(
  persist: (requests: number, responseMs: number) => Promise<void>,
): (durationMs: number) => Promise<void> {
  return async (durationMs) => persist(1, Math.max(0, Math.round(durationMs)));
}

export const recordOriginRequest = createOriginMetricsRecorder(persistOriginMetrics);

async function persistOriginMetrics(requests: number, responseMs: number): Promise<void> {
  await withTransaction(async (connection) => {
    await connection.execute<ResultSetHeader>(
      `UPDATE service_metrics
          SET total_origin_requests = total_origin_requests + ?,
              origin_response_ms_sum = origin_response_ms_sum + ?, updated_at = UTC_TIMESTAMP(3)
        WHERE id = 1`,
      [requests, responseMs],
    );
    await connection.execute<ResultSetHeader>(
      `INSERT INTO usage_hourly
         (bucket_hour, origin_requests, origin_response_ms_sum, updated_at)
       VALUES (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:00:00'), ?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         origin_requests = origin_requests + VALUES(origin_requests),
         origin_response_ms_sum = origin_response_ms_sum + VALUES(origin_response_ms_sum),
         updated_at = UTC_TIMESTAMP(3)`,
      [requests, responseMs],
    );
  });
}

export async function recordPrepareRequest(): Promise<void> {
  await withTransaction(async (connection) => {
    await connection.execute<ResultSetHeader>(
      `UPDATE service_metrics
          SET total_prepares = total_prepares + 1, updated_at = UTC_TIMESTAMP(3)
        WHERE id = 1`,
    );
    await connection.execute<ResultSetHeader>(
      `INSERT INTO usage_hourly (bucket_hour, prepares, updated_at)
       VALUES (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:00:00'), 1, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE prepares = prepares + 1, updated_at = UTC_TIMESTAMP(3)`,
    );
  });
}

export async function listExpiredAssets(limit = 8): Promise<PendingAssetDeletion[]> {
  const boundedLimit = Math.max(1, Math.min(20, Math.floor(limit)));
  const rows = await execute<(RowDataPacket & { id: string; image_url: string })[]>(
    `SELECT id, image_url
       FROM card_assets
      WHERE delete_after IS NOT NULL AND delete_after <= UTC_TIMESTAMP(3) AND deleted_at IS NULL
      ORDER BY delete_after ASC
      LIMIT ${boundedLimit}`,
  );
  return rows.map((row) => ({ id: row.id, imageUrl: row.image_url }));
}

export async function markAssetDeleted(id: string): Promise<void> {
  await execute<ResultSetHeader>(
    `UPDATE card_assets SET deleted_at = UTC_TIMESTAMP(3) WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
}

export async function cleanupRenderRateLimits(): Promise<void> {
  await execute<ResultSetHeader>(
    `DELETE FROM render_rate_limits
      WHERE bucket_minute < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY)
      LIMIT 64`,
  );
}

async function recordNewProfile(): Promise<void> {
  await withTransaction(async (connection) => {
    await connection.execute<ResultSetHeader>(
      `UPDATE service_metrics
          SET total_unique_profiles = total_unique_profiles + 1, updated_at = UTC_TIMESTAMP(3)
        WHERE id = 1`,
    );
    await connection.execute<ResultSetHeader>(
      `INSERT INTO usage_hourly (bucket_hour, new_profiles, updated_at)
       VALUES (DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:00:00'), 1, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE new_profiles = new_profiles + 1, updated_at = UTC_TIMESTAMP(3)`,
    );
  });
}

function mapCard(row: CardRow): StoredCard {
  if (!row.image_url || !row.rendered_at) throw new Error("Stored card row is incomplete.");
  return {
    handle: row.handle,
    style: row.style,
    statsHash: row.stats_hash,
    rendererVersion: Number(row.renderer_version),
    imageUrl: row.image_url,
    imageEtag: row.image_etag,
    renderedAt: asDate(row.rendered_at),
    sourceCheckedAt: row.source_checked_at ? asDate(row.source_checked_at) : null,
    lastRequestedAt: asDate(row.last_requested_at),
  };
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(`${value.replace(" ", "T")}Z`);
}

function styleMetricColumn(style: CardStyle): string {
  return {
    landscape: "renders_landscape",
    hero: "renders_hero",
    report: "renders_report",
  }[style];
}
