import { describe, expect, it } from "vitest";
import { supabaseConfig } from "@/lib/db";

const URL = "https://abcdefghijklmnop.supabase.co";
const jwt = (role: string) =>
  ["e30", Buffer.from(JSON.stringify({ role })).toString("base64url"), "sig"].join(".");
const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

describe("supabaseConfig", () => {
  it("returns null when nothing is set, so local dev falls back to SQLite", () => {
    expect(supabaseConfig(env({}))).toBeNull();
  });

  it("treats blank values as unset", () => {
    expect(supabaseConfig(env({ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "  " }))).toBeNull();
  });

  it("reads the standard names and trims whitespace", () => {
    expect(supabaseConfig(env({ SUPABASE_URL: ` ${URL} `, SUPABASE_SERVICE_ROLE_KEY: `${jwt("service_role")}\n` }))).toEqual({
      url: URL,
      key: jwt("service_role"),
    });
  });

  it("accepts the dashboard's alternative names", () => {
    expect(supabaseConfig(env({ NEXT_PUBLIC_SUPABASE_URL: URL, SUPABASE_SECRET_KEY: "sb_secret_abc123" }))).toEqual({
      url: URL,
      key: "sb_secret_abc123",
    });
  });

  it("refuses a half-configured setup instead of silently using SQLite", () => {
    expect(() => supabaseConfig(env({ SUPABASE_URL: URL }))).toThrow(/SUPABASE_SERVICE_ROLE_KEY is missing/);
    expect(() => supabaseConfig(env({ SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc123" }))).toThrow(/SUPABASE_URL is missing/);
  });

  it("rejects the anon / publishable key, which RLS would silently block", () => {
    expect(() => supabaseConfig(env({ SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: jwt("anon") }))).toThrow(/anon/);
    expect(() => supabaseConfig(env({ SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_abc" }))).toThrow(/anon/);
  });
});
