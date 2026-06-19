import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface StatsSummary {
  users: number;
  activeUsers7d: number;
  delivered: number;
  pending: number;
  manualWaiting: number;
  totalOrders: number;
  lifetimeRevenue: number;
  revenueToday: number;
  revenueWeek: number;
  revenueMonth: number;
  paymentSuccess: number;
  paymentFailure: number;
  topProducts: { name: string; qty: number }[];
  revenue7dDays: { label: string; revenue: number }[];
  recentOrders: {
    short_id: string;
    status: string;
    customer: string;
    amount_cents: number;
    timestamp: string;
    product: string;
  }[];
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function dayLabel(d: Date) {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
  });
}

function sumCents(rows: any) {
  return (rows.data ?? []).reduce(
    (sum: number, row: any) => sum + Number(row.total_cents ?? 0),
    0
  );
}

export async function getStats(): Promise<StatsSummary> {
  const now = new Date();
  const startToday = startOfToday();
  const startWeek = new Date(now.getTime() - 7 * 24 * 3600_000);
  const startMonth = new Date(now.getTime() - 30 * 24 * 3600_000);

  const [
    usersRes,
    deliveredRes,
    pendingRes,
    manualRes,
    totalOrdersRes,
    activeRes,
    lifetimeRev,
    todayRev,
    weekRev,
    monthRev,
    succAttempts,
    failAttempts,
    topRows,
    recentRows,
    chartRows,
  ] = await Promise.all([
    supabaseAdmin.from("bot_users").select("id", { count: "exact", head: true }),

    supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "delivered"),

    supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "pending_payment"]),

    supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "paid_waiting_delivery"),

    supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true }),

    supabaseAdmin
      .from("orders")
      .select("user_telegram_id")
      .gte("created_at", startWeek.toISOString()),

    supabaseAdmin
      .from("orders")
      .select("total_cents")
      .eq("status", "delivered"),

    supabaseAdmin
      .from("orders")
      .select("total_cents")
      .eq("status", "delivered")
      .gte("delivered_at", startToday.toISOString()),

    supabaseAdmin
      .from("orders")
      .select("total_cents")
      .eq("status", "delivered")
      .gte("delivered_at", startWeek.toISOString()),

    supabaseAdmin
      .from("orders")
      .select("total_cents")
      .eq("status", "delivered")
      .gte("delivered_at", startMonth.toISOString()),

    supabaseAdmin
      .from("payment_attempts")
      .select("id", { count: "exact", head: true })
      .eq("status", "delivered"),

    supabaseAdmin
      .from("payment_attempts")
      .select("id", { count: "exact", head: true })
      .in("status", [
        "verify_failed",
        "amount_mismatch",
        "duplicate_reference",
        "rate_limited",
        "rpc_error",
      ]),

    supabaseAdmin
      .from("orders")
      .select("quantity, products(name)")
      .eq("status", "delivered")
      .gte("delivered_at", startMonth.toISOString()),

    supabaseAdmin
      .from("orders")
      .select("short_id, status, total_cents, user_telegram_id, created_at, delivered_at, products(name)")
      .order("created_at", { ascending: false })
      .limit(10),

    supabaseAdmin
      .from("orders")
      .select("total_cents, delivered_at")
      .eq("status", "delivered")
      .gte("delivered_at", startWeek.toISOString()),
  ]);

  const activeSet = new Set<number>();
  for (const row of (activeRes.data ?? []) as any[]) {
    activeSet.add(Number(row.user_telegram_id));
  }

  const productMap = new Map<string, number>();
  for (const row of (topRows.data ?? []) as any[]) {
    const name = row.products?.name ?? "Unknown";
    productMap.set(name, (productMap.get(name) ?? 0) + Number(row.quantity ?? 0));
  }

  const topProducts = [...productMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => ({ name, qty }));

  const dayMap = new Map<string, number>();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 3600_000);
    dayMap.set(dateKey(d), 0);
  }

  for (const row of (chartRows.data ?? []) as any[]) {
    if (!row.delivered_at) continue;
    const key = dateKey(new Date(row.delivered_at));
    dayMap.set(key, (dayMap.get(key) ?? 0) + Number(row.total_cents ?? 0));
  }

  const revenue7dDays = [...dayMap.entries()].map(([key, revenue]) => ({
    label: dayLabel(new Date(key)),
    revenue,
  }));

  const recentOrders = ((recentRows.data ?? []) as any[]).map((order) => ({
    short_id: order.short_id ?? "—",
    status: order.status ?? "—",
    customer: String(order.user_telegram_id ?? "—"),
    amount_cents: Number(order.total_cents ?? 0),
    timestamp: order.delivered_at ?? order.created_at ?? new Date().toISOString(),
    product: order.products?.name ?? "—",
  }));

  return {
    users: usersRes.count ?? 0,
    activeUsers7d: activeSet.size,
    delivered: deliveredRes.count ?? 0,
    pending: pendingRes.count ?? 0,
    manualWaiting: manualRes.count ?? 0,
    totalOrders: totalOrdersRes.count ?? 0,
    lifetimeRevenue: sumCents(lifetimeRev),
    revenueToday: sumCents(todayRev),
    revenueWeek: sumCents(weekRev),
    revenueMonth: sumCents(monthRev),
    paymentSuccess: succAttempts.count ?? 0,
    paymentFailure: failAttempts.count ?? 0,
    topProducts,
    revenue7dDays,
    recentOrders,
  };
}