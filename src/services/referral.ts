import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ReferralStats {
  totalReferred: number;
  pendingCents: number;
  paidCents: number;
}

export function parseStartPayload(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.match(/^\/start\s+ref_(\d+)$/);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  return Number.isFinite(id) ? id : null;
}

export async function attachReferrer(refereeId: number, referrerId: number) {
  if (refereeId === referrerId) return;
  // Only attach if referee has never had a referrer
  const { data: existing } = await supabaseAdmin
    .from("bot_users").select("referred_by_telegram_id, created_at")
    .eq("telegram_id", refereeId).maybeSingle();
  if (!existing || existing.referred_by_telegram_id) return;
  // Verify referrer exists
  const { data: ref } = await supabaseAdmin
    .from("bot_users").select("telegram_id").eq("telegram_id", referrerId).maybeSingle();
  if (!ref) return;
  await supabaseAdmin.from("bot_users")
    .update({ referred_by_telegram_id: referrerId })
    .eq("telegram_id", refereeId);
  await supabaseAdmin.from("referrals")
    .upsert({ referrer_telegram_id: referrerId, referee_telegram_id: refereeId },
      { onConflict: "referee_telegram_id" });
}

export async function stampOrderReferrer(orderId: string, userId: number) {
  const { data: u } = await supabaseAdmin
    .from("bot_users").select("referred_by_telegram_id")
    .eq("telegram_id", userId).maybeSingle();
  if (u?.referred_by_telegram_id) {
    await supabaseAdmin.from("orders").update({
      referrer_telegram_id: u.referred_by_telegram_id,
    }).eq("id", orderId);
  }
}

export async function grantReward(orderId: string) {
  const { data } = await supabaseAdmin.rpc("grant_referral_reward", { p_order_id: orderId });
  return (data as number) ?? 0;
}

export async function payoutToWallet(userId: number) {
  const { data, error } = await supabaseAdmin.rpc("referral_payout", { p_user: userId });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function getStats(userId: number): Promise<ReferralStats> {
  const { count } = await supabaseAdmin
    .from("referrals").select("id", { count: "exact", head: true })
    .eq("referrer_telegram_id", userId);
  const { data: rows } = await supabaseAdmin
    .from("referral_rewards").select("amount_cents, paid_to_wallet")
    .eq("referrer_telegram_id", userId);
  let pending = 0, paid = 0;
  for (const r of (rows ?? []) as any[]) {
    if (r.paid_to_wallet) paid += r.amount_cents; else pending += r.amount_cents;
  }
  return { totalReferred: count ?? 0, pendingCents: pending, paidCents: paid };
}

export async function buildReferralLink(userId: number): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  // bot username isn't strictly needed; fall back to t.me link with token-derived hint
  // Most projects pre-configure BOT_USERNAME, but we can compute lazily via getMe at call site.
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (username) return `https://t.me/${username}?start=ref_${userId}`;
  void token;
  return `https://t.me/?start=ref_${userId}`;
}
