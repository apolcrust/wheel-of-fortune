import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const hasSupabaseConfig = Boolean(supabaseUrl?.trim() || supabasePublishableKey?.trim());
let validSupabaseUrl = false;

if (supabaseUrl) {
  try {
    const parsedUrl = new URL(supabaseUrl);
    validSupabaseUrl = (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") && !!parsedUrl.hostname;
  } catch {
    validSupabaseUrl = false;
  }
}

const configuredSupabaseUrl = validSupabaseUrl ? supabaseUrl : null;
const configuredPublishableKey = supabasePublishableKey?.trim() || null;

export const supabaseConfigurationError = hasSupabaseConfig && (!configuredSupabaseUrl || !configuredPublishableKey)
  ? "Supabase is configured incorrectly. Set VITE_SUPABASE_URL to the full Project URL (for example, https://your-project-ref.supabase.co) and set VITE_SUPABASE_PUBLISHABLE_KEY to the publishable key, then rebuild and redeploy."
  : null;

export const supabase = configuredSupabaseUrl && configuredPublishableKey
  ? createClient(configuredSupabaseUrl, configuredPublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  : null;
