import { attachDatabasePool } from "@vercel/functions";
import mysql, {
  type Pool,
  type PoolConnection,
  type QueryResult,
} from "mysql2/promise";

import { getDatabaseSettings } from "./cache-config";

let databasePool: Pool | undefined;

export class DatabaseUnavailableError extends Error {
  constructor(message = "TiDB persistence is not configured.") {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

export function getDatabasePool(): Pool {
  if (databasePool) return databasePool;

  const settings = getDatabaseSettings();
  if (!settings) {
    throw new DatabaseUnavailableError();
  }

  databasePool = mysql.createPool({
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    database: settings.database,
    connectionLimit: 3,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    queueLimit: 20,
    ssl: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    },
    supportBigNumbers: true,
    bigNumberStrings: true,
    timezone: "Z",
  });

  attachDatabasePool(databasePool.pool);
  return databasePool;
}

export async function execute<T extends QueryResult>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<T> {
  const [result] = await getDatabasePool().execute<T>(sql, [...values] as never[]);
  return result;
}

export async function withTransaction<T>(
  work: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await getDatabasePool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}
