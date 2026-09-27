import "server-only";
import path from "node:path";
import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { OutcomeId } from "./segments";

export type CouponRecord = {
  name: string;
  phone: string;
  outcome: OutcomeId;
  outcomeLabel: string;
  discountPct: number | null;
  code: string;
  source: string | null;
  ipHash: string | null;
  createdAt: string;
  expiresAt: string;
};

export type InsertResult = { ok: true } | { ok: false; conflict: "phone" | "code" };

export interface CouponStore {
  findByPhone(phone: string): Promise<CouponRecord | null>;
  insert(record: CouponRecord): Promise<InsertResult>;
  countSinceByIp(ipHash: string, sinceIso: string): Promise<number>;
}

type Row = {
  name: string;
  phone: string;
  outcome: OutcomeId;
  outcome_label: string;
  discount_pct: number | null;
  code: string;
  source: string | null;
  ip_hash: string | null;
  created_at: string;
  expires_at: string;
};

const COLUMNS = "name, phone, outcome, outcome_label, discount_pct, code, source, ip_hash, created_at, expires_at";

const toRecord = (r: Row): CouponRecord => ({
  name: r.name,
  phone: r.phone,
  outcome: r.outcome,
  outcomeLabel: r.outcome_label,
  discountPct: r.discount_pct,
  code: r.code,
  source: r.source,
  ipHash: r.ip_hash,
  createdAt: new Date(r.created_at).toISOString(),
  expiresAt: new Date(r.expires_at).toISOString(),
});

const toRow = (c: CouponRecord): Row => ({
  name: c.name,
  phone: c.phone,
  outcome: c.outcome,
  outcome_label: c.outcomeLabel,
  discount_pct: c.discountPct,
  code: c.code,
  source: c.source,
  ip_hash: c.ipHash,
  created_at: c.createdAt,
  expires_at: c.expiresAt,
});

function conflictFrom(message: string): "phone" | "code" {
  return /phone/i.test(message) ? "phone" : "code";
}

class SupabaseStore implements CouponStore {
  constructor(private client: SupabaseClient) {}

  async findByPhone(phone: string) {
    const { data, error } = await this.client.from("coupons").select(COLUMNS).eq("phone", phone).maybeSingle<Row>();
    if (error) throw new Error(`Supabase lookup failed: ${error.message}`);
    return data ? toRecord(data) : null;
  }

  async insert(record: CouponRecord): Promise<InsertResult> {
    const { error } = await this.client.from("coupons").insert(toRow(record));
    if (!error) return { ok: true };
    if (error.code === "23505") {
      return { ok: false, conflict: conflictFrom(`${error.message} ${error.details ?? ""}`) };
    }
    throw new Error(`Supabase insert failed: ${error.message}`);
  }

  async countSinceByIp(ipHash: string, sinceIso: string) {
    const { count, error } = await this.client
      .from("coupons")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", sinceIso);
    if (error) throw new Error(`Supabase count failed: ${error.message}`);
    return count ?? 0;
  }
}

const SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS coupons (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    phone         TEXT    NOT NULL UNIQUE,
    outcome       TEXT    NOT NULL,
    outcome_label TEXT    NOT NULL,
    discount_pct  INTEGER,
    code          TEXT    NOT NULL UNIQUE,
    source        TEXT,
    ip_hash       TEXT,
    created_at    TEXT    NOT NULL,
    expires_at    TEXT    NOT NULL,
    redeemed_at   TEXT
  );
  CREATE INDEX IF NOT EXISTS coupons_created_at_idx ON coupons (created_at DESC);
`;

type SqliteModule = typeof import("better-sqlite3");

class SqliteStore implements CouponStore {
  private db: import("better-sqlite3").Database;

  constructor(Database: SqliteModule, file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(SQLITE_SCHEMA);
    const cols = this.db.prepare("PRAGMA table_info(coupons)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "ip_hash")) this.db.exec("ALTER TABLE coupons ADD COLUMN ip_hash TEXT");
    this.db.exec("CREATE INDEX IF NOT EXISTS coupons_ip_hash_idx ON coupons (ip_hash, created_at)");
  }

  async findByPhone(phone: string) {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM coupons WHERE phone = ?`).get(phone) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  async insert(record: CouponRecord): Promise<InsertResult> {
    try {
      this.db
        .prepare(
          `INSERT INTO coupons (name, phone, outcome, outcome_label, discount_pct, code, source, ip_hash, created_at, expires_at)
           VALUES (@name, @phone, @outcome, @outcome_label, @discount_pct, @code, @source, @ip_hash, @created_at, @expires_at)`,
        )
        .run(toRow(record));
      return { ok: true };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return { ok: false, conflict: conflictFrom(e.message ?? "") };
      }
      throw err;
    }
  }

  async countSinceByIp(ipHash: string, sinceIso: string) {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM coupons WHERE ip_hash = ? AND created_at >= ?")
      .get(ipHash, sinceIso) as { n: number };
    return row.n;
  }
}

const globalForStore = globalThis as unknown as { __couponStore?: Promise<CouponStore> };

async function createStore(): Promise<CouponStore> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && key) {
    return new SupabaseStore(
      createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
    );
  }
  if (process.env.VERCEL) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on Vercel.");
  }
  // Imported lazily so Supabase deployments never load the native module.
  const { default: Database } = await import("better-sqlite3");
  return new SqliteStore(Database, process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "spin.db"));
}

export function getStore(): Promise<CouponStore> {
  globalForStore.__couponStore ??= createStore().catch((err) => {
    globalForStore.__couponStore = undefined;
    throw err;
  });
  return globalForStore.__couponStore;
}
