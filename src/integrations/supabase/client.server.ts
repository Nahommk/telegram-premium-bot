// Server-side Supabase admin client (service role, bypasses RLS).
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from process.env.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function build() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var",
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let _c: ReturnType<typeof build> | undefined;
export const supabaseAdmin = new Proxy({} as ReturnType<typeof build>, {
  get(_, p, r) {
    if (!_c) _c = build();
    return Reflect.get(_c, p, r);
  },
});
