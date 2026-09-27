-- WebAura Spin the Wheel — leads + coupons.
-- Run once in Supabase: Dashboard → SQL Editor → paste → Run.

create table if not exists public.coupons (
  id             bigint generated always as identity primary key,
  name           text        not null check (char_length(name) between 2 and 60),
  -- Canonical form 91XXXXXXXXXX. UNIQUE = one spin per WhatsApp number,
  -- enforced by the database so concurrent requests can't double-spin.
  phone          text        not null unique check (phone ~ '^91[6-9][0-9]{9}$'),
  outcome        text        not null check (outcome in (
                   'pct_5','pct_10','pct_15','pct_20','pct_30','pct_50','free_consult','pct_90')),
  outcome_label  text        not null,
  discount_pct   smallint    check (discount_pct between 0 and 100), -- null = free consultation
  code           text        not null unique check (code ~ '^WEBAURA-[2-9A-HJKMNP-Z]{6}$'),
  source         text,                                               -- utm_source, e.g. whatsapp / instagram
  ip_hash        text,                                               -- salted SHA-256 of client IP (IPv6 by /64); never the raw IP
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  redeemed_at    timestamptz                                          -- set manually by sales when claimed
);

create index if not exists coupons_created_at_idx on public.coupons (created_at desc);
-- For tables created from an earlier version of this file.
alter table public.coupons add column if not exists ip_hash text;
-- Backs the "max new spins per network per hour" check.
create index if not exists coupons_ip_hash_idx on public.coupons (ip_hash, created_at);

-- Lock the table down: RLS on with no policies means the anon/public key
-- can do nothing. Only the server (service-role key) reads and writes.
alter table public.coupons enable row level security;
