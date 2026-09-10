export const CARD_REFRESH_SECONDS = 15 * 60;
export const CARD_REFRESH_MS = CARD_REFRESH_SECONDS * 1000;
export const CARD_ASSET_GRACE_SECONDS = 2 * 60 * 60;
export const CARD_DATA_CACHE_SECONDS = 15 * 60;
export const STATUS_CACHE_SECONDS = 5 * 60;
export const RENDERER_VERSION = 2;

export type DatabaseSettings = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

const SYSTEM_DATABASES = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

export function getDatabaseSettings(): DatabaseSettings | null {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    try {
      const url = new URL(connectionString);
      if (url.protocol !== "mysql:") return null;
      return normalizeDatabaseSettings({
        host: url.hostname,
        port: Number(url.port || 4000),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.replace(/^\//, "")),
      });
    } catch {
      return null;
    }
  }

  return normalizeDatabaseSettings({
    host: process.env.TIDB_HOST?.trim() || "",
    port: Number(process.env.TIDB_PORT?.trim() || 4000),
    user: process.env.TIDB_USER?.trim() || "",
    password: process.env.TIDB_PASSWORD || "",
    database: process.env.TIDB_DATABASE?.trim() || "",
  });
}

export function isDatabaseConfigured(): boolean {
  return getDatabaseSettings() !== null;
}

export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function isPersistentCacheConfigured(): boolean {
  return isDatabaseConfigured() && isBlobConfigured();
}

function normalizeDatabaseSettings(settings: DatabaseSettings): DatabaseSettings | null {
  if (
    !settings.host ||
    !settings.user ||
    !settings.password ||
    !settings.database ||
    !Number.isInteger(settings.port) ||
    settings.port < 1 ||
    settings.port > 65_535 ||
    SYSTEM_DATABASES.has(settings.database.toLowerCase())
  ) {
    return null;
  }
  return settings;
}
