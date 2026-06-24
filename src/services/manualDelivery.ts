import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { InlineKeyboard, type Bot } from "grammy";
import type { BotCtx } from "@/bot/bot";

export function manualDeliveryKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("📨 Deliver Now", `mdl:start:${orderId}`)
    .text("❌ Reject", `mdl:reject:${orderId}`).row()
    .text("💸 Refund", `mdl:refund:${orderId}`);
}

export async function notifyAdminsManualDelivery(bot: Bot<BotCtx>, orderId: string) {
  const { data: o } = await supabaseAdmin
    .from("orders")
    .select("id, short_id, user_telegram_id, quantity, total_cents, payment_method, customer_email, customer_password, customer_telegram_username, products(name, icon)")
    .eq("id", orderId).maybeSingle() as any;
  if (!o) return;
  const { data: u } = await supabaseAdmin
    .from("bot_users").select("username, first_name").eq("telegram_id", o.user_telegram_id).maybeSingle();
  const { data: lastPayment } = await supabaseAdmin
    .from("payments").select("reference, amount_cents").eq("order_id", orderId)
    .order("verified_at", { ascending: false }).limit(1).maybeSingle();

  const requestLine =
    o.customer_email || o.customer_telegram_username
      ? `\n\nCustomer request details:${
          o.customer_email ? `\nEmail: \`${o.customer_email}\`` : ""
        }${
          o.customer_password ? `\nPassword: \`${o.customer_password}\`` : ""
        }${
          o.customer_telegram_username ? `\nTelegram: \`${o.customer_telegram_username}\`` : ""
        }`
      : "";

  const text = ` *Manual delivery required*\n\n` +
    `Order: \`${o.short_id}\`\n` +
    `Product: ${o.products?.icon ?? ""} ${o.products?.name}\n` +
    `Quantity: ${o.quantity}\n` +
    `Total: ${(o.total_cents / 100).toFixed(2)} ETB\n` +
    `Method: ${o.payment_method ?? "wallet"}\n` +
    `Reference: \`${lastPayment?.reference ?? "wallet"}\`\n` +
    `Amount paid: ${((lastPayment?.amount_cents ?? o.total_cents) / 100).toFixed(2)} ETB\n` +
    `User: ${u?.first_name ?? ""} @${u?.username ?? "—"} \`${o.user_telegram_id}\`` +
    requestLine;

  const adminIds = (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of adminIds) {
    try {
      await bot.api.sendMessage(Number(id), text, {
        parse_mode: "Markdown",
        reply_markup: manualDeliveryKeyboard(orderId),
      });
    } catch (e) { console.error("[notifyAdminsManualDelivery]", id, e); }
  }
}

export async function markManuallyDelivered(orderId: string, adminId: number, contentType: string, code?: string) {
  const { data, error } = await supabaseAdmin.rpc("manual_deliver", {
    p_order_id: orderId, p_admin: adminId, p_content_type: contentType, p_code: code,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function rejectOrder(orderId: string, adminId: number, reason: string) {
  const { data, error } = await supabaseAdmin.rpc("reject_order", {
    p_order_id: orderId, p_admin: adminId, p_reason: reason,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function refundOrder(orderId: string, adminId: number, reason: string) {
  const { data, error } = await supabaseAdmin.rpc("refund_order", {
    p_order_id: orderId, p_admin: adminId, p_reason: reason,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
