import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

import mysql from "mysql2/promise";

try {
  loadEnvFile(resolve(".env.local"));
} catch {
  // Vercel and CI provide environment variables without a local file.
}

const settings = getDatabaseSettings();

const connection = await mysql.createConnection({
  ...settings,
  multipleStatements: true,
  ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
});

try {
  const sql = await readFile(resolve("migrations/001_persistent_card_cache.sql"), "utf8");
  await connection.query(sql);
  console.log("Persistent card cache schema is ready.");
} finally {
  await connection.end();
}

function getDatabaseSettings() {
  const connectionString = process.env.DATABASE_URL?.trim();
  let settings;

  if (connectionString) {
    const url = new URL(connectionString);
    if (url.protocol !== "mysql:") {
      throw new Error("DATABASE_URL must use the mysql:// protocol.");
    }
    settings = {
      host: url.hostname,
      port: Number(url.port || 4000),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    };
  } else {
    settings = {
      host: process.env.TIDB_HOST?.trim() || "",
      port: Number(process.env.TIDB_PORT?.trim() || 4000),
      user: process.env.TIDB_USER?.trim() || "",
      password: process.env.TIDB_PASSWORD || "",
      database: process.env.TIDB_DATABASE?.trim() || "",
    };
  }

  const systemDatabases = new Set(["information_schema", "mysql", "performance_schema", "sys"]);
  if (
    !settings.host ||
    !settings.user ||
    !settings.password ||
    !settings.database ||
    !Number.isInteger(settings.port) ||
    settings.port < 1 ||
    settings.port > 65_535 ||
    systemDatabases.has(settings.database.toLowerCase())
  ) {
    throw new Error(
      "Configure DATABASE_URL or all TIDB_* variables with a dedicated application database; system schemas such as sys are refused.",
    );
  }
  return settings;
}
