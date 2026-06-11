import mysql from "mysql2/promise";
import { env } from "../config/env.js";

let pool: mysql.Pool | null = null;

export function isDatabaseEnabled(): boolean {
  return env.database.enabled;
}

export function getPool(): mysql.Pool {
  if (!env.database.enabled) {
    throw new Error("Base de datos no configurada");
  }
  if (!pool) {
    pool = mysql.createPool({
      host: env.database.host,
      port: env.database.port,
      user: env.database.user,
      password: env.database.password,
      database: env.database.name,
      waitForConnections: true,
      connectionLimit: 10,
      charset: "utf8mb4",
    });
  }
  return pool;
}

export async function pingDatabase(): Promise<boolean> {
  if (!env.database.enabled) return false;
  try {
    const p = getPool();
    await p.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
