// Verifies the Supabase connection used by /api/spin, without writing anything.
// Usage: npm run db:check   (reads .env.local / .env like Next.js does)

import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

// Vitest / CI often set NODE_ENV=test, which makes @next/env skip .env.local.
const savedNodeEnv = process.env.NODE_ENV;
if (savedNodeEnv === "test") delete process.env.NODE_ENV;
nextEnv.loadEnvConfig(process.cwd(), true);
if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!url && !key) fail("No Supabase settings found. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local (and save the file).");
if (!url) fail("SUPABASE_URL is missing.");
if (!key) fail("SUPABASE_SERVICE_ROLE_KEY is missing. Use the service_role / secret key from Project Settings → API.");
// The anon key reads an RLS-locked table as empty instead of erroring, so catch it up front.
function isPublicKey(k) {
  if (k.startsWith("sb_publishable_")) return true;
  try {
    return JSON.parse(Buffer.from(k.split(".")[1] ?? "", "base64url").toString("utf8"))?.role === "anon";
  } catch {
    return false;
  }
}
if (isPublicKey(key)) fail("That's the anon/publishable key. Use the service_role / secret key from Project Settings → API.");
if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/.test(url)) {
  console.warn(`! SUPABASE_URL doesn't look like https://<project-ref>.supabase.co — continuing anyway.`);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const columns = "id,name,phone,outcome,outcome_label,discount_pct,code,source,ip_hash,created_at,expires_at,redeemed_at";
const { error, count } = await supabase.from("coupons").select(columns, { count: "exact", head: true });

if (error) {
  const msg = `${error.code ?? ""} ${error.message ?? ""}`.trim();
  if (/42P01|PGRST205|does not exist|Could not find the table/i.test(msg)) {
    fail(`Connected, but the coupons table doesn't exist. Run supabase/schema.sql in the Supabase SQL Editor. (${msg})`);
  }
  if (/42703|column/i.test(msg)) {
    fail(`Connected, but the coupons table is missing a column. Re-run supabase/schema.sql. (${msg})`);
  }
  if (/Invalid API key|JWT|401|permission denied/i.test(msg)) {
    fail(`Supabase rejected the key. Make sure it's the service_role / secret key, not the anon/publishable one. (${msg})`);
  }
  fail(`Supabase error: ${msg}`);
}

console.log(`✓ Connected to ${new URL(url).host}`);
console.log(`✓ coupons table has all ${columns.split(",").length} columns the app uses`);
console.log(`✓ ${count ?? 0} coupon row(s) stored`);
console.log("The app will use Supabase now. Restart `npm run dev` if it was already running.");
