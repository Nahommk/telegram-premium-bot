import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function getBalance(userId: number): Promise<number> {
  const { data } = await supabaseAdmin
    .from("wallets").select("balance_cents").eq("user_telegram_id", userId).maybeSingle();
  return data?.balance_cents ?? 0;
}

export async function ensureWallet(userId: number) {
  await supabaseAdmin.from("wallets").upsert(
    { user_telegram_id: userId },
    { onConflict: "user_telegram_id" },
  );
}

export async function listTransactions(userId: number, limit = 10) {
  const { data } = await supabaseAdmin
    .from("wallet_transactions")
    .select("kind, amount_cents, balance_after_cents, note, created_at")
    .eq("user_telegram_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function payOrderFromWallet(orderId: string, userId: number) {
  const { data, error } = await supabaseAdmin.rpc("pay_order_from_wallet", {
    p_order_id: orderId, p_user: userId,
  });
  if (error) throw error;
  const row: any = Array.isArray(data) ? data[0] : data;
  return row as { delivered_code: string | null; short_id: string; delivery_mode: "automatic" | "manual"; status: string };
}

export async function adminAdjust(adminId: number, userId: number, amountCents: number, note?: string) {
  const { data, error } = await supabaseAdmin.rpc("admin_wallet_adjust", {
    p_admin: adminId, p_user: userId, p_amount: amountCents, p_note: note ?? undefined,
  });
  if (error) throw error;
  return data as number;
}

export async function depositFromVerified(opts: {
  userId: number; reference: string; provider: "telebirr" | "cbe"; amountCents: number; raw: unknown;
}) {
  const { data, error } = await supabaseAdmin.rpc("deposit_to_wallet", {
    p_user: opts.userId,
    p_reference: opts.reference,
    p_provider: opts.provider,
    p_amount: opts.amountCents,
    p_raw: opts.raw as any,
  });
  if (error) throw error;
  return data as number; // new balance
}
