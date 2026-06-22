import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Only initialize if both env vars are actually set. Lets the app run
// fully on the hardcoded fallback library until Supabase is wired up.
export const supabase = url && key ? createClient(url, key) : null;
