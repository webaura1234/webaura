// `next start` loads .env.local; blank values win over it and keep tests off the real Supabase.
export const NO_SUPABASE = {
  SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  SUPABASE_SECRET_KEY: "",
};
