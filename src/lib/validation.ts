// Shared by the form (instant feedback) and the API route (authoritative).

/**
 * Accepts common ways people type Indian mobiles — "98765 43210",
 * "+91-9876543210", "09876543210", "919876543210" — and returns the
 * canonical "91XXXXXXXXXX" form, or null if it isn't a valid Indian mobile.
 */
export function normalizeIndianPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let digits = input.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;

  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  return /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : null;
}

export function normalizeName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) return null;
  return /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(name) ? name : null;
}

export function normalizeSource(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().slice(0, 64);
  return /^[\w.-]+$/.test(s) ? s.toLowerCase() : null;
}
