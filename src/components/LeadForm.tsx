"use client";

import { useEffect, useId, useRef, useState } from "react";
import { normalizeIndianPhone, normalizeName } from "@/lib/validation";

type Errors = { name?: string; phone?: string; form?: string };

type LeadFormProps = {
  open: boolean;
  submitting: boolean;
  serverError?: Errors | null;
  onClose: () => void;
  onSubmit: (data: { name: string; phone: string }) => void;
};

export function LeadForm({ open, submitting, serverError, onClose, onSubmit }: LeadFormProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (serverError) setErrors(serverError);
  }, [serverError]);

  // Once per opening only, and never steal focus from a field the user is already typing in.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      const form = nameRef.current?.form;
      if (!form?.contains(document.activeElement)) nameRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !submitting && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, submitting, onClose]);

  // Stay mounted briefly after closing so the sheet can slide away.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(t);
  }, [open]);
  const closing = !open && mounted;

  if (!open && !mounted) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    const cleanName = normalizeName(name);
    const cleanPhone = normalizeIndianPhone(phone);
    if (!cleanName) next.name = "Please enter your name (letters only).";
    if (!cleanPhone) next.phone = "Enter a valid 10-digit Indian mobile number starting with 6–9.";
    setErrors(next);
    if (cleanName && cleanPhone) onSubmit({ name: cleanName, phone: cleanPhone });
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center bg-navy/60 backdrop-blur-sm sm:items-center sm:p-4 ${closing ? "backdrop-out" : "backdrop-in"}`}
      inert={closing}
      onClick={() => !submitting && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${closing ? "sheet-out" : "pop-in"} w-full max-w-md rounded-t-3xl bg-white p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-sand sm:hidden" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gold">One spin per number</p>
            <h2 id={titleId} className="mt-1 font-display text-2xl font-extrabold text-olive">
              Unlock your spin
            </h2>
            <p className="mt-1 text-sm text-navy/70">We&apos;ll send your coupon details on WhatsApp.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="-mr-4 -mt-3 flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-navy/50 transition hover:bg-cream hover:text-navy active:scale-90 disabled:opacity-40"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} noValidate className="mt-5 space-y-4">
          <div>
            <label htmlFor="lead-name" className="text-sm font-semibold text-olive">
              Your name
            </label>
            <input
              ref={nameRef}
              id="lead-name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="e.g. Priya Sharma"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "lead-name-err" : undefined}
              className={`mt-1.5 min-h-14 w-full rounded-xl border-2 bg-white px-4 py-3 text-base text-navy outline-none transition placeholder:text-navy/35 focus:border-olive ${errors.name ? "border-red-400" : "border-sand"}`}
            />
            {errors.name && (
              <p id="lead-name-err" className="mt-1.5 text-sm text-red-600">
                {errors.name}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="lead-phone" className="text-sm font-semibold text-olive">
              WhatsApp number
            </label>
            <div
              className={`mt-1.5 flex items-center rounded-xl border-2 bg-white transition focus-within:border-olive ${errors.phone ? "border-red-400" : "border-sand"}`}
            >
              <span className="select-none border-r-2 border-sand py-3 pl-4 pr-3 text-base font-semibold text-olive">+91</span>
              <input
                id="lead-phone"
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d\s+-]/g, ""))}
                maxLength={16}
                placeholder="98765 43210"
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? "lead-phone-err" : undefined}
                className="min-h-14 w-full min-w-0 rounded-r-xl bg-transparent px-3 py-3 text-base tracking-wide text-navy outline-none placeholder:text-navy/35"
              />
            </div>
            {errors.phone && (
              <p id="lead-phone-err" className="mt-1.5 text-sm text-red-600">
                {errors.phone}
              </p>
            )}
          </div>

          {errors.form && (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {errors.form}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-olive px-6 py-4 text-lg font-bold text-cream shadow-lg shadow-olive/25 transition hover:bg-olive-soft active:scale-[0.96] disabled:cursor-wait disabled:opacity-80"
          >
            {submitting ? (
              <>
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-cream/40 border-t-cream" />
                Getting your spin…
              </>
            ) : (
              <>Unlock &amp; Spin</>
            )}
          </button>

          <p className="text-center text-xs leading-relaxed text-navy/55">
            By continuing you agree to be contacted by WebAura on WhatsApp about your coupon. No spam.
          </p>
        </form>
      </div>
    </div>
  );
}
