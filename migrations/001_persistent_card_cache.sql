CREATE TABLE IF NOT EXISTS profile_cache (
  handle VARCHAR(64) NOT NULL PRIMARY KEY,
  stats_json JSON NOT NULL,
  stats_hash CHAR(64) NOT NULL,
  fetched_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  first_seen_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  KEY idx_profile_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS card_cache (
  handle VARCHAR(64) NOT NULL,
  style ENUM('landscape', 'hero', 'report') NOT NULL,
  stats_hash CHAR(64) NULL,
  renderer_version INT NOT NULL DEFAULT 1,
  image_url VARCHAR(2048) NULL,
  image_etag VARCHAR(128) NULL,
  rendered_at DATETIME(3) NULL,
  source_checked_at DATETIME(3) NULL,
  last_requested_at DATETIME(3) NOT NULL,
  render_status ENUM('empty', 'ready', 'rendering', 'failed') NOT NULL DEFAULT 'empty',
  lock_token CHAR(36) NULL,
  lock_expires_at DATETIME(3) NULL,
  last_error VARCHAR(500) NULL,
  last_error_at DATETIME(3) NULL,
  PRIMARY KEY (handle, style),
  KEY idx_card_last_requested (last_requested_at),
  KEY idx_card_lock_expiry (lock_expires_at)
);

CREATE TABLE IF NOT EXISTS card_assets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  handle VARCHAR(64) NOT NULL,
  style ENUM('landscape', 'hero', 'report') NOT NULL,
  stats_hash CHAR(64) NOT NULL,
  renderer_version INT NOT NULL,
  image_url VARCHAR(2048) NOT NULL,
  image_etag VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  superseded_at DATETIME(3) NULL,
  delete_after DATETIME(3) NULL,
  deleted_at DATETIME(3) NULL,
  UNIQUE KEY uniq_asset_version (handle, style, stats_hash, renderer_version),
  KEY idx_assets_cleanup (delete_after, deleted_at),
  KEY idx_assets_card (handle, style, created_at)
);

CREATE TABLE IF NOT EXISTS service_metrics (
  id TINYINT NOT NULL PRIMARY KEY,
  total_unique_profiles BIGINT UNSIGNED NOT NULL DEFAULT 0,
  current_cards BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_cards_generated BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_origin_requests BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_prepares BIGINT UNSIGNED NOT NULL DEFAULT 0,
  successful_renders BIGINT UNSIGNED NOT NULL DEFAULT 0,
  failed_renders BIGINT UNSIGNED NOT NULL DEFAULT 0,
  render_ms_sum BIGINT UNSIGNED NOT NULL DEFAULT 0,
  origin_response_ms_sum BIGINT UNSIGNED NOT NULL DEFAULT 0,
  renders_landscape BIGINT UNSIGNED NOT NULL DEFAULT 0,
  renders_hero BIGINT UNSIGNED NOT NULL DEFAULT 0,
  renders_report BIGINT UNSIGNED NOT NULL DEFAULT 0,
  consecutive_render_failures INT UNSIGNED NOT NULL DEFAULT 0,
  last_successful_render_at DATETIME(3) NULL,
  last_render_failure_at DATETIME(3) NULL,
  maintenance_flag BOOLEAN NOT NULL DEFAULT FALSE,
  announcement VARCHAR(500) NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT chk_service_singleton CHECK (id = 1)
);

INSERT IGNORE INTO service_metrics (id, updated_at) VALUES (1, UTC_TIMESTAMP(3));

CREATE TABLE IF NOT EXISTS usage_hourly (
  bucket_hour DATETIME NOT NULL PRIMARY KEY,
  origin_requests BIGINT UNSIGNED NOT NULL DEFAULT 0,
  prepares BIGINT UNSIGNED NOT NULL DEFAULT 0,
  new_profiles BIGINT UNSIGNED NOT NULL DEFAULT 0,
  renders_succeeded BIGINT UNSIGNED NOT NULL DEFAULT 0,
  renders_failed BIGINT UNSIGNED NOT NULL DEFAULT 0,
  render_ms_sum BIGINT UNSIGNED NOT NULL DEFAULT 0,
  origin_response_ms_sum BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS render_rate_limits (
  bucket_minute DATETIME NOT NULL PRIMARY KEY,
  render_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL
);
