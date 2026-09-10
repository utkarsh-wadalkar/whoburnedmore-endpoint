import { afterEach, describe, expect, test, vi } from "vitest";

describe("database pool integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("attaches the mysql2 promise pool without rejecting its wrapper type", async () => {
    vi.stubEnv("TIDB_HOST", "gateway.example.tidbcloud.com");
    vi.stubEnv("TIDB_PORT", "4000");
    vi.stubEnv("TIDB_USER", "test-user");
    vi.stubEnv("TIDB_PASSWORD", "test-password");
    vi.stubEnv("TIDB_DATABASE", "whoburnedmore_card");

    const { getDatabasePool } = await import("../lib/db");
    const pool = getDatabasePool();

    expect(pool).toBeDefined();
    await pool.end();
  });
});
