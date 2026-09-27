import { spawn } from "node:child_process";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { SEGMENTS, segmentIndexOf, segmentUnderPointer, type SpinResponse } from "../../src/lib/segments";
import { insertRaw, query, randomIp, randomPhone, rowsForPhone } from "./helpers";
import { NO_SUPABASE } from "./noSupabase";

const TARGET_PCT: Record<string, number> = {
  pct_5: 30,
  pct_10: 25,
  pct_15: 20,
  pct_20: 12,
  pct_30: 7,
  pct_50: 4,
  free_consult: 1.5,
  pct_90: 0.5,
};

function post(request: APIRequestContext, data: unknown, ip = randomIp()) {
  return request.post("/api/spin", { data, headers: { "x-forwarded-for": ip }, failOnStatusCode: false });
}

test.describe.configure({ mode: "parallel" });

test("10,000 real spins: distribution within ±1.5 points, jackpot reachable, every angle on its wedge, codes unique", async ({ request }) => {
  test.setTimeout(600_000);
  const N = 10_000;
  const BATCH = 25;
  const counts: Record<string, number> = Object.fromEntries(SEGMENTS.map((s) => [s.id, 0]));
  const angleMismatches: string[] = [];
  const codes = new Set<string>();
  const phones: string[] = [];
  let networkRetries = 0;

  // Spins are idempotent per phone, so retrying a dropped connection with the same number is safe;
  // if the first attempt was recorded, the retry returns that same spin with alreadySpun=true.
  async function spinWithRetry(phone: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await post(request, { name: "Load Test", phone });
        expect(res.status(), await res.text()).toBe(200);
        return { body: (await res.json()) as SpinResponse, retried: attempt > 0 };
      } catch (err) {
        if (attempt >= 3 || !/ECONNRESET|socket hang up|ECONNREFUSED/.test(String(err))) throw err;
        networkRetries++;
      }
    }
  }

  for (let i = 0; i < N; i += BATCH) {
    const batch = await Promise.all(
      Array.from({ length: BATCH }, async () => {
        const phone = randomPhone();
        return { phone, ...(await spinWithRetry(phone)) };
      }),
    );
    for (const { phone, body, retried } of batch) {
      if (body.alreadySpun && !retried) continue; // random phone happened to repeat an earlier one
      phones.push(phone);
      counts[body.outcome.id]++;
      codes.add(body.code);
      if (segmentUnderPointer(body.angle) !== segmentIndexOf(body.outcome.id)) {
        angleMismatches.push(`${body.outcome.id} @ ${body.angle}`);
      }
    }
  }

  const n = phones.length;
  const rows = Object.entries(TARGET_PCT).map(([id, target]) => {
    const observed = (counts[id] / n) * 100;
    return { id, target, observed: +observed.toFixed(2), diff: +(observed - target).toFixed(2), hits: counts[id] };
  });
  console.table(rows);
  console.log(`[10k] ${n} spins, ${networkRetries} network retries`);

  for (const r of rows) expect(Math.abs(r.diff), r.id).toBeLessThanOrEqual(1.5);
  expect(counts.pct_90, "90% jackpot must be reachable").toBeGreaterThan(0);
  expect(angleMismatches).toEqual([]);
  expect(codes.size).toBe(n);

  const dbStats = query<{ total: number; distinct_codes: number; bad_codes: number }>(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT code) AS distinct_codes,
            SUM(CASE WHEN code NOT GLOB 'WEBAURA-[2-9A-HJKMNP-Z][2-9A-HJKMNP-Z][2-9A-HJKMNP-Z][2-9A-HJKMNP-Z][2-9A-HJKMNP-Z][2-9A-HJKMNP-Z]' THEN 1 ELSE 0 END) AS bad_codes
     FROM coupons WHERE name = 'Load Test'`,
  );
  expect(dbStats.total).toBe(n);
  expect(dbStats.distinct_codes).toBe(n);
  expect(dbStats.bad_codes).toBe(0);
});

test("repeat phone returns the stored result and never re-spins", async ({ request }) => {
  const phone = randomPhone();
  const first = (await (await post(request, { name: "Priya Sharma", phone })).json()) as SpinResponse;
  for (let i = 0; i < 10; i++) {
    const again = (await (await post(request, { name: "Priya Sharma", phone })).json()) as SpinResponse;
    expect(again.alreadySpun).toBe(true);
    expect(again.code).toBe(first.code);
    expect(again.outcome.id).toBe(first.outcome.id);
    expect(segmentUnderPointer(again.angle)).toBe(segmentIndexOf(first.outcome.id));
  }
  expect(rowsForPhone(`91${phone}`)).toHaveLength(1);
});

test("all common formats of one number resolve to the same person, stored canonically", async ({ request }) => {
  const d = randomPhone();
  const variants = [
    d,
    `+91${d}`,
    `91${d}`,
    `0${d}`,
    `+91 ${d.slice(0, 5)} ${d.slice(5)}`,
    `+91-${d.slice(0, 5)}-${d.slice(5)}`,
    `0${d.slice(0, 5)}-${d.slice(5)}`,
    ` ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)} `,
  ];
  const codes = new Set<string>();
  for (const phone of variants) {
    const res = await post(request, { name: "Format Test", phone });
    expect(res.status(), phone).toBe(200);
    codes.add(((await res.json()) as SpinResponse).code);
  }
  expect(codes.size).toBe(1);
  const rows = rowsForPhone(`91${d}`);
  expect(rows).toHaveLength(1);
  expect(rows[0].phone).toBe(`91${d}`);
});

test("25 simultaneous requests for one new number create exactly one row and one coupon", async ({ request }) => {
  const phone = randomPhone();
  const responses = await Promise.all(
    Array.from({ length: 25 }, (_, i) => post(request, { name: "Race Test", phone: i % 2 ? `+91${phone}` : phone })),
  );
  const bodies = await Promise.all(responses.map((r) => r.json() as Promise<SpinResponse>));
  expect(responses.every((r) => r.status() === 200)).toBe(true);
  expect(new Set(bodies.map((b) => b.code)).size).toBe(1);
  expect(new Set(bodies.map((b) => b.outcome.id)).size).toBe(1);
  expect(bodies.filter((b) => !b.alreadySpun)).toHaveLength(1);
  expect(rowsForPhone(`91${phone}`)).toHaveLength(1);
});

test("a fresh client with no cookies or storage still gets the original result (check is server-side)", async ({ playwright, baseURL }) => {
  const phone = randomPhone();
  const a = await playwright.request.newContext({ baseURL });
  const first = (await (await post(a, { name: "Device A", phone })).json()) as SpinResponse;
  await a.dispose();

  const b = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const second = (await (await post(b, { name: "Device B", phone })).json()) as SpinResponse;
  await b.dispose();

  expect(second.code).toBe(first.code);
  expect(second.alreadySpun).toBe(true);
});

test("fabricated outcome/angle/code in the request body are ignored", async ({ request }) => {
  const forged = { outcome: { id: "pct_90", discountPct: 90 }, angle: 0, code: "WEBAURA-HACKED", discountPct: 90, alreadySpun: false, expiresAt: "2099-01-01T00:00:00Z" };
  let jackpots = 0;
  for (let i = 0; i < 200; i++) {
    const phone = randomPhone();
    const body = (await (await post(request, { name: "Forger", phone, ...forged })).json()) as SpinResponse;
    expect(body.code).not.toBe("WEBAURA-HACKED");
    expect(body.expiresAt).not.toContain("2099");
    expect(segmentUnderPointer(body.angle)).toBe(segmentIndexOf(body.outcome.id));
    const [row] = rowsForPhone(`91${phone}`);
    expect(row.code).toBe(body.code);
    expect(row.outcome).toBe(body.outcome.id);
    if (body.outcome.id === "pct_90") jackpots++;
  }
  // 200 forged "pct_90" requests: at 0.5% odds, ≥10 jackpots would be ~1-in-10^7.
  expect(jackpots).toBeLessThan(10);
});

test("replaying a winning request does not issue a second coupon", async ({ request }) => {
  const phone = randomPhone();
  const payload = { name: "Replay", phone };
  const ip = randomIp();
  const first = (await (await post(request, payload, ip)).json()) as SpinResponse;
  const replays = await Promise.all(Array.from({ length: 10 }, () => post(request, payload, ip)));
  for (const r of replays) expect(((await r.json()) as SpinResponse).code).toBe(first.code);
  expect(rowsForPhone(`91${phone}`)).toHaveLength(1);
});

test("XSS names are rejected; apostrophes are stored verbatim via parameterized SQL", async ({ request }) => {
  for (const name of ["<script>alert(1)</script>", '<img src=x onerror="alert(1)">', "Robert'); DROP TABLE coupons;--", "javascript:alert(1)"]) {
    const res = await post(request, { name, phone: randomPhone() });
    expect(res.status(), name).toBe(422);
  }
  const phone = randomPhone();
  expect((await post(request, { name: "Shaquille O'Neal", phone })).status()).toBe(200);
  expect(rowsForPhone(`91${phone}`)[0].name).toBe("Shaquille O'Neal");
  expect(query<{ n: number }>("SELECT COUNT(*) AS n FROM coupons WHERE name LIKE '%<%' OR name LIKE '%>%'").n).toBe(0);
});

test("SQL-injection phone strings are rejected and the table is intact", async ({ request }) => {
  for (const phone of ["9876543210' OR '1'='1", "9876543210; DROP TABLE coupons;--", "' UNION SELECT * FROM coupons--", "9876543210\u0000"]) {
    const res = await post(request, { name: "Inject Test", phone });
    expect(res.status(), phone).toBe(422);
  }
  expect(query<{ n: number }>("SELECT COUNT(*) AS n FROM coupons").n).toBeGreaterThan(0);
});

test("rapid-fire spins from one IP with different numbers are throttled", async ({ request }) => {
  const ip = randomIp();
  const statuses: number[] = [];
  for (let i = 0; i < 25; i++) {
    const res = await post(request, { name: "Bot Attack", phone: randomPhone() }, ip);
    statuses.push(res.status());
    if (res.status() === 429) expect(Number(res.headers()["retry-after"])).toBeGreaterThan(0);
  }
  console.log(`one IP, 25 new numbers → ${statuses.join(" ")}`);
  expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true); // hourly new-spin cap = 10
  expect(statuses.slice(10).every((s) => s === 429)).toBe(true);
});

test("invalid input gets a clean 4xx (never a 500) and creates no row", async ({ request }) => {
  const valid = randomPhone();
  const cases: [string, unknown][] = [
    ["empty name", { name: "", phone: valid }],
    ["whitespace name", { name: "     ", phone: valid }],
    ["61-char name", { name: "A".repeat(61), phone: valid }],
    ["100KB name", { name: "A".repeat(100_000), phone: valid }],
    ["missing name", { phone: valid }],
    ["empty phone", { name: "Valid Name", phone: "" }],
    ["short phone", { name: "Valid Name", phone: "98765" }],
    ["long phone", { name: "Valid Name", phone: "98765432101234" }],
    ["starts with 5", { name: "Valid Name", phone: "5876543210" }],
    ["letters", { name: "Valid Name", phone: "98765abcde" }],
    ["numeric phone", { name: "Valid Name", phone: 9876543210 }],
    ["array body", [{ name: "Valid Name", phone: valid }]],
    ["null body", null],
  ];
  for (const [label, data] of cases) {
    const res = await post(request, data);
    expect(res.status(), label).toBeGreaterThanOrEqual(400);
    expect(res.status(), label).toBeLessThan(500);
  }
  const raw = await request.post("/api/spin", { data: "not json", headers: { "content-type": "application/json", "x-forwarded-for": randomIp() }, failOnStatusCode: false });
  expect(raw.status()).toBe(400);
  expect(rowsForPhone(`91${valid}`)).toHaveLength(0);
  expect((await request.get("/api/spin", { failOnStatusCode: false })).status()).toBe(405);
});

test("expiry is exactly +48h from spin time, stored in UTC", async ({ request }) => {
  const phone = randomPhone();
  const before = Date.now();
  const body = (await (await post(request, { name: "Expiry Test", phone })).json()) as SpinResponse;
  const after = Date.now();
  const [row] = rowsForPhone(`91${phone}`);

  expect(row.created_at).toMatch(/Z$/);
  expect(row.expires_at).toMatch(/Z$/);
  const created = Date.parse(row.created_at);
  expect(Date.parse(row.expires_at) - created).toBe(48 * 60 * 60 * 1000);
  expect(created).toBeGreaterThanOrEqual(before - 1000);
  expect(created).toBeLessThanOrEqual(after + 1000);
  expect(body.expiresAt).toBe(new Date(row.expires_at).toISOString());
  expect(body.expired).toBe(false);
});

test("a coupon past its expiry is reported as expired by the server", async ({ request }) => {
  const phone = randomPhone();
  const created = Date.now() - 49 * 60 * 60 * 1000;
  insertRaw({
    name: "Old Winner",
    phone: `91${phone}`,
    outcome: "pct_20",
    outcome_label: "20% OFF",
    discount_pct: 20,
    code: "WEBAURA-EXPRD2",
    source: null,
    ip_hash: null,
    created_at: new Date(created).toISOString(),
    expires_at: new Date(created + 48 * 60 * 60 * 1000).toISOString(),
  });
  const body = (await (await post(request, { name: "Old Winner", phone })).json()) as SpinResponse;
  expect(body.alreadySpun).toBe(true);
  expect(body.code).toBe("WEBAURA-EXPRD2");
  expect(body.expired).toBe(true);
});

test("if the database is down, the spin fails visibly and no coupon is returned", async () => {
  test.setTimeout(90_000);
  const port = 3299;
  // A path *inside a file* can never be created, simulating an unreachable database.
  const brokenDb = path.join(process.cwd(), "package.json", "nope", "spin.db");
  const server = spawn("npx", ["next", "start", "-p", String(port)], {
    env: { ...process.env, ...NO_SUPABASE, SQLITE_PATH: brokenDb },
    shell: true,
    stdio: "ignore",
  });
  try {
    const url = `http://localhost:${port}/api/spin`;
    for (let i = 0; i < 60; i++) {
      try {
        await fetch(`http://localhost:${port}/`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Outage Test", phone: randomPhone() }),
    });
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.code).toBeUndefined();
    expect(body.error).toMatch(/no coupon was issued/i);
  } finally {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill();
  }
});
