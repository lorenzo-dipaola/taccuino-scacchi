// Supabase project used for sign-in and sync. Both values are public by design
// (the anon key only allows what the Row Level Security policies allow).
// Set them to '' to run the app in local-only mode, without sign-in.
// They can also be provided at build time as VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || 'https://gvvkpyfuvwjyvacomzfx.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || 'sb_publishable_EyBrARVG8nVS8yX5nKxjQg_v87EOsvQ';
