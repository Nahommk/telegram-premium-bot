import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface StatsSummary {
  users: number;
  activeUsers7d: number;
  delivered: number;
  pending: number;
  manualWaiting: number;
  revenueToday: number;
  revenueWeek: number;
  revenueMonth: number;
  paymentSuccess: number;
  paymentFailure: number;
  topProducts: { name: string; qty: number }[];
}

export async function getStats(): Promise<StatsSummary> {
  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startWeek = new Date(now.getTime() - 7 * 24 * 3600_000);
  const startMonth = new Date(now.getTime() - 30 * 24 * 3600_000);

  const [usersRes, deliveredRes, pendingRes, manualRes, activeRes,
    todayRev, weekRev, monthRev, succAttempts, failAttempts, topRows,
  ] = await Promise.all([
    supabaseAdmin.from("bot_users").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).eq("status", "delivered"),
    supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).eq("status", "paid_waiting_delivery"),
    supabaseAdmin.from("orders").select("user_telegram_id", { head: false })
      .gte("created_at", startWeek.toISOString()),
    supabaseAdmin.from("orders").select("total_cents").eq("status", "delivered").gte("delivered_at", startToday.toISOString()),
    supabaseAdmin.from("orders").select("total_cents").eq("status", "delivered").gte("delivered_at", startWeek.toISOString()),
    supabaseAdmin.from("orders").select("total_cents").eq("status", "delivered").gte("delivered_at", startMonth.toISOString()),
    supabaseAdmin.from("payment_attempts").select("id", { count: "exact", head: true }).eq("status", "delivered"),
    supabaseAdmin.from("payment_attempts").select("id", { count: "exact", head: true })
      .in("status", ["verify_failed", "amount_mismatch", "duplicate_reference", "rate_limited", "rpc_error"]),
    supabaseAdmin.from("orders")
      .select("quantity, products(name)")
      .eq("status", "delivered")
      .gte("delivered_at", startMonth.toISOString()),
  ]);

  const sum = (rows: any) => (rows.data ?? []).reduce((s: number, r: any) => s + (r.total_cents ?? 0), 0);
  const activeSet = new Set<number>();
  for (const r of (activeRes.data ?? []) as any[]) activeSet.add(Number(r.user_telegram_id));

  const tally = new Map<string, number>();
  for (const r of (topRows.data ?? []) as any[]) {
    const name = r.products?.name ?? "?";
    tally.set(name, (tally.get(name) ?? 0) + (r.quantity ?? 0));
  }
  const topProducts = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => ({ name, qty }));

  return {
    users: usersRes.count ?? 0,
    activeUsers7d: activeSet.size,
    delivered: deliveredRes.count ?? 0,
    pending: pendingRes.count ?? 0,
    manualWaiting: manualRes.count ?? 0,
    revenueToday: sum(todayRev),
    revenueWeek: sum(weekRev),
    revenueMonth: sum(monthRev),
    paymentSuccess: succAttempts.count ?? 0,
    paymentFailure: failAttempts.count ?? 0,
    topProducts,
  };
}
