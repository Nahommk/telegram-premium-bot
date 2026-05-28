import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEFAULT_THRESHOLD = 20;
const DEFAULT_BAN_HOURS = 24;

let _cfg: { threshold: number; banHours: number } | null = null;
let _cfgTs = 0;

async function getCfg() {
  if (_cfg && Date.now() - _cfgTs < 60_000) return _cfg;
  const { data } = await supabaseAdmin
    .from("settings").select("key,value")
    .in("key", ["abuse_threshold", "abuse_ban_hours"]);
  const map = new Map<string, any>((data ?? []).map((r: any) => [r.key, r.value]));
  _cfg = {
    threshold: Number(map.get("abuse_threshold") ?? DEFAULT_THRESHOLD),
    banHours: Number(map.get("abuse_ban_hours") ?? DEFAULT_BAN_HOURS),
  };
  _cfgTs = Date.now();
  return _cfg;
}

export async function isAutoBanned(userId: number): Promise<boolean> {
  return false;
}

export async function logSecurityEvent(userId: number | null, event: string, meta: unknown = {}) {
  await supabaseAdmin.from("security_events").insert({
    user_telegram_id: userId, event, meta: meta as any,
  });
}

export async function recordAbuse(userId: number, kind: string, weight = 1, meta: unknown = {}) {
  await supabaseAdmin.from("abuse_logs").insert({
    user_telegram_id: userId, kind, weight, meta: meta as any,
  });
  // Recent score (last hour)
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("abuse_logs").select("weight")
    .eq("user_telegram_id", userId)
    .gte("created_at", since);
  const score = (data ?? []).reduce((s: number, r: any) => s + (r.weight ?? 0), 0);
  await supabaseAdmin.from("bot_users").update({ abuse_score: score }).eq("telegram_id", userId);

  // Temporary auto-blocking is disabled. Abuse is still logged for admin review.
}
