import { randomInt } from "node:crypto";
import Database from "better-sqlite3";

/** Random valid Indian mobile (10 digits, starts 6–9). */
export function randomPhone(): string {
  let s = String(randomInt(6, 10));
  for (let i = 0; i < 9; i++) s += randomInt(0, 10);
  return s;
}

/** Random public-looking IPv4 so each test gets its own rate-limit bucket. */
export function randomIp(): string {
  return `100.${randomInt(64, 128)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}

export type DbRow = {
  name: string;
  phone: string;
  outcome: string;
  code: string;
  source: string | null;
  ip_hash: string | null;
  created_at: string;
  expires_at: string;
};

export function db() {
  return new Database(process.env.E2E_DB!, { readonly: true, fileMustExist: true });
}

export function rowsForPhone(phone: string): DbRow[] {
  const conn = db();
  try {
    return conn.prepare("SELECT * FROM coupons WHERE phone = ?").all(phone) as DbRow[];
  } finally {
    conn.close();
  }
}

export function query<T>(sql: string, ...params: unknown[]): T {
  const conn = db();
  try {
    return conn.prepare(sql).get(...params) as T;
  } finally {
    conn.close();
  }
}

export function insertRaw(row: DbRow & { outcome_label: string; discount_pct: number | null }) {
  const conn = new Database(process.env.E2E_DB!);
  try {
    conn.pragma("busy_timeout = 5000");
    conn
      .prepare(
        `INSERT INTO coupons (name, phone, outcome, outcome_label, discount_pct, code, source, ip_hash, created_at, expires_at)
         VALUES (@name, @phone, @outcome, @outcome_label, @discount_pct, @code, @source, @ip_hash, @created_at, @expires_at)`,
      )
      .run(row);
  } finally {
    conn.close();
  }
}
