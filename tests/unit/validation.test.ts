import { describe, expect, it } from "vitest";
import { normalizeIndianPhone, normalizeName, normalizeSource } from "@/lib/validation";

describe("normalizeIndianPhone", () => {
  it.each([
    "9876543210",
    "+919876543210",
    "919876543210",
    "09876543210",
    "+91 98765 43210",
    "+91-98765-43210",
    "098765-43210",
    "(+91) 98765 43210",
    "  98765 43210  ",
    "+91.98765.43210",
  ])("normalizes %j to one canonical number", (input) => {
    expect(normalizeIndianPhone(input)).toBe("919876543210");
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["too short", "98765"],
    ["9 digits", "987654321"],
    ["11 digits without 0 prefix", "98765432101"],
    ["13 digits", "9198765432101"],
    ["starts with 5", "5876543210"],
    ["starts with 0 after prefix", "+910876543210"],
    ["all zeros", "0000000000"],
    ["letters", "98765abcde"],
    ["foreign number", "+44 7911 123456"],
    ["US number", "+1 202 555 0143"],
    ["SQL injection", "9876543210' OR '1'='1"],
    ["SQL comment", "9876543210;--"],
    ["script tag", "<script>9876543210</script>"],
    ["non-ASCII digits", "٩٨٧٦٥٤٣٢١٠"],
    ["very long", "9".repeat(5000)],
  ])("rejects %s", (_label, input) => {
    expect(normalizeIndianPhone(input)).toBeNull();
  });

  it.each([9876543210, null, undefined, {}, ["9876543210"]])("rejects non-string %j", (input) => {
    expect(normalizeIndianPhone(input)).toBeNull();
  });
});

describe("normalizeName", () => {
  it.each([
    ["Priya Sharma", "Priya Sharma"],
    ["  Priya    Sharma  ", "Priya Sharma"],
    ["D'Souza", "D'Souza"],
    ["Jean-Luc", "Jean-Luc"],
    ["Dr. Rao", "Dr. Rao"],
    ["Zoë", "Zoë"],
    ["प्रिया शर्मा", "प्रिया शर्मा"],
    ["அருண்", "அருண்"],
    ["A".repeat(60), "A".repeat(60)],
  ])("accepts %j", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it.each([
    ["empty", ""],
    ["only whitespace", "     "],
    ["single letter", "A"],
    ["61 characters", "A".repeat(61)],
    ["huge input", "A".repeat(100_000)],
    ["script tag", "<script>alert(1)</script>"],
    ["img onerror", '<img src=x onerror="alert(1)">'],
    ["SQL injection", "Robert'); DROP TABLE coupons;--"],
    ["ampersand", "Tom & Jerry"],
    ["digits", "12345"],
    ["emoji", "Priya 😀"],
    ["null byte", "Priya\u0000"],
    ["leading punctuation", "'Priya"],
  ])("rejects %s", (_label, input) => {
    expect(normalizeName(input)).toBeNull();
  });
});

describe("normalizeSource", () => {
  it("lowercases valid utm values and drops anything else", () => {
    expect(normalizeSource("WhatsApp")).toBe("whatsapp");
    expect(normalizeSource("insta_story-1")).toBe("insta_story-1");
    expect(normalizeSource("<x>")).toBeNull();
    expect(normalizeSource(null)).toBeNull();
  });
});
