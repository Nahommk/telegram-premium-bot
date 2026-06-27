import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BotCtx } from "./bot";
import { adminMenuKeyboard, backToMenuKeyboard } from "./keyboards";
import { formatPrice } from "./util";
import { markManuallyDelivered, rejectOrder, refundOrder } from "@/services/manualDelivery";
import { adminAdjust } from "@/services/wallet";
import { createBroadcast, cancelBroadcast, runUntilDrained } from "@/services/broadcast";
import { invalidateButtonsCache, loadButtons } from "@/services/buttons";
import { getStats } from "@/services/stats";
import { getBot } from "./bot";
import { tReply, tEdit, tSend, encodeCustomEmoji, toHtml } from "./messaging";
import { getMessageTemplate, renderMessage } from "@/services/templates";

async function getState(telegramId: number): Promise<Record<string, any> | null> {
  const { data } = await supabaseAdmin
    .from("admin_sessions").select("state").eq("telegram_id", telegramId).maybeSingle();
  return (data?.state as any) ?? null;
}
async function setState(telegramId: number, state: Record<string, unknown> | null) {
  if (state === null) {
    await supabaseAdmin.from("admin_sessions").delete().eq("telegram_id", telegramId);
  } else {
    await supabaseAdmin.from("admin_sessions").upsert({ telegram_id: telegramId, state: state as any });
  }
}
async function audit(adminId: number, action: string, target: unknown) {
  await supabaseAdmin.from("audit_logs").insert({
    admin_telegram_id: adminId, action, target: target as any,
  });
}
function broadcastProductIcon(icon: unknown): string {
  const raw = String(icon ?? "").trim();

  if (!raw) return "";

  if (/^\d{8,}$/.test(raw)) {
    return `<tg-emoji emoji-id="${raw}">🤖</tg-emoji>`;
  }

  return raw;
}
function deliveryProductIcon(icon: unknown): string {
  const raw = String(icon ?? "").trim();
  if (!raw) return "";

  if (/^\d{8,}$/.test(raw)) {
    return `<tg-emoji emoji-id="${raw}">⭐</tg-emoji>`;
  }

  return raw;
}
async function countAvailableStock(productId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("product_codes")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("product_id", productId)
    .eq("is_used", false);

  return count ?? 0;
}

async function broadcastStockToUsers(
  ctx: BotCtx,
  productId: string,
  added: number
) {
  const { data: p } = await supabaseAdmin
    .from("products")
    .select("id, name, icon, warranty_text")
    .eq("id", productId)
    .maybeSingle();

  if (!p) return;

  const currentStock = await countAvailableStock(productId);

  const text = await renderMessage(
    "broadcast_stock_added",
    "{icon} {name} {warranty}\n➕ Added: {added}\n📦 Current stock: {stock}",
    {
      icon: broadcastProductIcon(p.icon),
      name: p.name,
      warranty: p.warranty_text ?? "",
      added,
      stock: currentStock,
    }
  );

  const broadcastId = await createBroadcast({
    adminId: ctx.from!.id,
    kind: "text",
    text,
    buttons: [
  {
    label: "Buy",
    callback_data: `shop:p:${productId}`,
    icon_custom_emoji_id: "5312361253610475399",
  },
],
  });

  await runUntilDrained(getBot(), broadcastId);
}
function requireAdmin(ctx: BotCtx): boolean {
  if (!ctx.isAdmin) {
    ctx.answerCallbackQuery({ text: "Admin only", show_alert: true }).catch(() => {});
    return false;
  }
  return true;
}

// Short helper for admin-only messages — keys are namespaced `admin_*` so
// they group together in the Templates list. Every literal admin string in
// this file routes through tA / tAEdit so admins can re-word them from the
// bot UI without touching code.
function tA(ctx: BotCtx, slug: string, fallback: string, vars: Record<string, any> = {}, extra: Record<string, any> = {}) {
  return tReply(ctx, `admin_${slug}`, fallback, vars, extra);
}
function tAEdit(ctx: BotCtx, slug: string, fallback: string, vars: Record<string, any> = {}, extra: Record<string, any> = {}) {
  return tEdit(ctx, `admin_${slug}`, fallback, vars, extra);
}

export function registerAdmin(bot: Bot<BotCtx>) {
  bot.callbackQuery("admin:menu", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCallbackQuery();
    await tAEdit(ctx, "menu", "🛠 *Admin panel*", {}, { reply_markup: await adminMenuKeyboard() });
  });

  // ============ Products ============
  bot.callbackQuery(/^adm:p:list:(\d+)$/, async (ctx) => {
  if (!requireAdmin(ctx)) return;
  
  const page = parseInt(ctx.match![1], 10);
  const pageSize = 10;
  
  await ctx.answerCallbackQuery();
  
  const { data } = await supabaseAdmin
    .from("products")
    .select("id, name, icon, price_cents, is_enabled, delivery_mode, credential_request")
    .order("created_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize);
  
  const products = data ?? [];
  const visibleProducts = products.slice(0, pageSize);
  const hasNext = products.length > pageSize;
  
  const kb = new InlineKeyboard();
  
  visibleProducts.forEach((p) => {
    kb.text(
      `${p.is_enabled ? "✅" : ""} ${p.icon ?? ""} ${p.name} — ${formatPrice(p.price_cents)} ${p.delivery_mode === "manual" ? "📝" : "⚡"}`,
      `adm:p:view:${p.id}:${page}`
    ).row();
  });
  
  const nav = [];
  
  if (page > 0) {
    nav.push({
      text: await getMessageTemplate("admin_btn_prev", "◀️ Previous"),
      callback_data: `adm:p:list:${page - 1}`,
    });
  }
  
  if (hasNext) {
    nav.push({
      text: await getMessageTemplate("admin_btn_next", "Next ▶️"),
      callback_data: `adm:p:list:${page + 1}`,
    });
  }
  
  if (nav.length) {
    for (const btn of nav) {
      kb.text(btn.text, btn.callback_data);
    }
    kb.row();
  }
  
  kb.text(await getMessageTemplate("admin_btn_new_product", "➕ New product"), "adm:p:new").row()
    .text(await getMessageTemplate("admin_btn_admin", "⬅️ Admin"), "admin:menu");
  
  await tAEdit(
    ctx,
    "products_header",
    "📦 *Products* — Page {page}",
    {
      page: page + 1,
    },
    {
      reply_markup: kb,
    }
  );
});

  bot.callbackQuery("adm:p:new", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCallbackQuery();
    await setState(ctx.from!.id, { admin: "new_product_name" });
    await tA(ctx, "new_product_name_prompt", "Send the new product *name*:");
  });

  bot.callbackQuery(/^adm:p:view:([^:]+)(?::(\d+))?$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = ctx.match![1];
    const page = Number(ctx.match![2] ?? 0);
    await ctx.answerCallbackQuery();
    const { data: p } = await supabaseAdmin.from("products").select("*").eq("id", id).maybeSingle();
    if (!p) return;
    const { count: avail } = await supabaseAdmin
      .from("product_codes").select("id", { count: "exact", head: true })
      .eq("product_id", id).eq("is_used", false);
    const { count: used } = await supabaseAdmin
      .from("product_codes").select("id", { count: "exact", head: true })
      .eq("product_id", id).eq("is_used", true);
    const kb = new InlineKeyboard()
      .text(await getMessageTemplate("admin_btn_edit_name", "✏️ Name"), `adm:p:edit:name:${p.id}`)
      .text(await getMessageTemplate("admin_btn_edit_price", "💵 Price"), `adm:p:edit:price:${p.id}`).row()
      .text(await getMessageTemplate("admin_btn_edit_desc", "📝 Desc"), `adm:p:edit:desc:${p.id}`)
      .text(await getMessageTemplate("admin_btn_edit_warranty", "🛡 Warranty"), `adm:p:edit:warranty:${p.id}`).row()
      .text(await getMessageTemplate("admin_btn_edit_icon", " Icon"), `adm:p:edit:icon:${p.id}`)
  .text(await getMessageTemplate("admin_btn_toggle_delivery", " Toggle delivery"), `adm:p:delivery:${p.id}`).row()
  .text(await getMessageTemplate("admin_btn_product_up", "⬆️ Up"), `adm:p:move:${p.id}:up`)
.text(await getMessageTemplate("admin_btn_product_down", "⬇️ Down"), `adm:p:move:${p.id}:down`).row()
  .text(
    p.credential_request === "email" ?
  await getMessageTemplate("admin_btn_credentials_email", " Login: Email") :
  p.credential_request === "email_password" ?
  await getMessageTemplate("admin_btn_credentials_email_password", " Login: Email + Password") :
  p.credential_request === "telegram_username" ?
  await getMessageTemplate("admin_btn_credentials_telegram", " Login: Telegram Username") :
  await getMessageTemplate("admin_btn_credentials_off", " Login: OFF"),
    `adm:p:creds:${p.id}`
  ).row()
  .text(p.is_enabled ? await getMessageTemplate("admin_btn_disable", " Disable") : await getMessageTemplate("admin_btn_enable", "✅ Enable"), `adm:p:toggle:${p.id}`)
      .text(await getMessageTemplate("admin_btn_add_codes", "➕ Add codes"), `adm:s:add:${p.id}`).row()
      .text(await getMessageTemplate("admin_btn_delete", "🗑 Delete"), `adm:p:del:${p.id}`)
      .text(await getMessageTemplate("admin_btn_products_back", "⬅️ Products"), `adm:p:list:${page}`);
    await tAEdit(ctx, "product_view",
      "{icon} *{name}*\n\n{description}\n\n💵 {price} ETB\n🛡 {warranty}\n🚚 Delivery: *{mode}*Login request: *{creds}*\n📦 Stock: {avail} available / {used} sold\nStatus: {status}",
      {
        icon: /^\d{8,}$/.test(String(p.icon || "")) ? "" : p.icon, name: p.name,
        description: p.description || "_no description_",
        price: formatPrice(p.price_cents),
        warranty: p.warranty_text || "—",
        mode: p.delivery_mode,
        creds:
  p.credential_request === "email" ?
  "Email only" :
  p.credential_request === "email_password" ?
  "Email + Password" :
  p.credential_request === "telegram_username" ?
  "Telegram Username" :
  "OFF",
        avail: avail ?? 0, used: used ?? 0,
        status: p.is_enabled ? "✅ Enabled" : "🚫 Disabled",
      }, { reply_markup: kb });
  });

bot.callbackQuery(/^adm:p:move:([^:]+):(up|down)$/, async (ctx) => {
  if (!requireAdmin(ctx)) return;

  const id = ctx.match![1];
  const direction = ctx.match![2] as "up" | "down";

  await ctx.answerCallbackQuery();

  const pageSize = 6;

  const { data: allProducts } = await supabaseAdmin
    .from("products")
    .select("id, sort_order, created_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true }) as any;

  const products = allProducts ?? [];
  const currentIndex = products.findIndex((p: any) => p.id === id);

  if (currentIndex === -1) {
    await tA(ctx, "product_not_found", "Product not found.");
    return;
  }

  const neighborIndex = direction === "up"
    ? currentIndex - 1
    : currentIndex + 1;

  if (neighborIndex < 0 || neighborIndex >= products.length) {
    await tA(
      ctx,
      "product_move_edge",
      direction === "up"
        ? "This product is already at the top."
        : "This product is already at the bottom.",
      {},
      {
        reply_markup: new InlineKeyboard().text(
          await getMessageTemplate("admin_btn_reload", "Reload"),
          `adm:p:view:${id}:${Math.floor(currentIndex / pageSize)}`
        ),
      }
    );
    return;
  }

  const current = products[currentIndex];
  const neighbor = products[neighborIndex];

  const currentOrder = Number(current.sort_order ?? 0);
  const neighborOrder = Number(neighbor.sort_order ?? 0);

  await supabaseAdmin
    .from("products")
    .update({ sort_order: neighborOrder })
    .eq("id", current.id);

  await supabaseAdmin
    .from("products")
    .update({ sort_order: currentOrder })
    .eq("id", neighbor.id);

  await audit(ctx.from!.id, "product.move", {
    id,
    direction,
    swapped_with: neighbor.id,
  });

  const newIndex = neighborIndex;
  const newPage = Math.floor(newIndex / pageSize);

  await tAEdit(
    ctx,
    "product_moved",
    "✅ Product moved {direction}.",
    {
      direction: direction === "up" ? "up" : "down",
    },
    {
      reply_markup: new InlineKeyboard()
        .text(
          await getMessageTemplate("admin_btn_reload", "Reload product"),
          `adm:p:view:${id}:${newPage}`
        )
        .row()
        .text(
          await getMessageTemplate("admin_btn_products_back", "⬅️ Products"),
          `adm:p:list:${newPage}`
        ),
    }
  );
});

  bot.callbackQuery(/^adm:p:delivery:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = ctx.match![1];
    await ctx.answerCallbackQuery();
    const { data: p } = await supabaseAdmin.from("products").select("delivery_mode").eq("id", id).maybeSingle();
    if (!p) return;
    const next = p.delivery_mode === "automatic" ? "manual" : "automatic";
    await supabaseAdmin.from("products").update({ delivery_mode: next }).eq("id", id);
    await audit(ctx.from!.id, "product.delivery_mode", { id, mode: next });
    await tA(ctx, "delivery_mode_set", "Delivery mode set to *{mode}*.", { mode: next },
      { reply_markup: new InlineKeyboard().text(await getMessageTemplate("admin_btn_reload", "Reload"), `adm:p:view:${id}`) });
  });
bot.callbackQuery(/^adm:p:creds:(.+)$/, async (ctx) => {
  if (!requireAdmin(ctx)) return;

  const id = ctx.match![1];
  await ctx.answerCallbackQuery();

  const { data: p } = await supabaseAdmin
    .from("products")
    .select("credential_request")
    .eq("id", id)
    .maybeSingle();

  if (!p) return;

  const current = String(p.credential_request ?? "none");

  const next =
  current === "none" ?
  "email" :
  current === "email" ?
  "email_password" :
  current === "email_password" ?
  "telegram_username" :
  "none";

  await supabaseAdmin
    .from("products")
    .update({ credential_request: next })
    .eq("id", id);

  await audit(ctx.from!.id, "product.credential_request", {
    id,
    credential_request: next,
  });

  await tA(
    ctx,
    "credentials_request_set",
    "Login request set to *{status}*.",
    {
      status:
  next === "email" ?
  "Email only" :
  next === "email_password" ?
  "Email + Password" :
  next === "telegram_username" ?
  "Telegram Username" :
  "OFF",
    },
    {
      reply_markup: new InlineKeyboard().text(
        await getMessageTemplate("admin_btn_reload", "Reload"),
        `adm:p:view:${id}`
      ),
    }
  );
});
  bot.callbackQuery(/^adm:p:edit:(name|price|desc|warranty|icon):(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const field = ctx.match![1]; const id = ctx.match![2];
    await ctx.answerCallbackQuery();
    await setState(ctx.from!.id, { admin: "edit_product", field, product_id: id });
    const fallbacks: Record<string, string> = {
      name: "Send new name:", price: "Send new price in ETB (e.g. 99.50):",
      desc: "Send new description:", warranty: "Send warranty text:", icon: "Send a single emoji icon:",
    };
    await tA(ctx, `edit_product_${field}_prompt`, fallbacks[field]);
  });

  bot.callbackQuery(/^adm:p:toggle:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = ctx.match![1];
    await ctx.answerCallbackQuery();
    const { data: p } = await supabaseAdmin.from("products").select("is_enabled").eq("id", id).maybeSingle();
    if (!p) return;
    await supabaseAdmin.from("products").update({ is_enabled: !p.is_enabled }).eq("id", id);
    await audit(ctx.from!.id, "product.toggle", { id, enabled: !p.is_enabled });
    await tAEdit(ctx, "updated", "Updated.", {},
      { reply_markup: new InlineKeyboard().text(await getMessageTemplate("admin_btn_reload", "Reload"), `adm:p:view:${id}`) });
  });

  bot.callbackQuery(/^adm:p:del:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = ctx.match![1];
    await ctx.answerCallbackQuery();
    await supabaseAdmin.from("products").delete().eq("id", id);
    await audit(ctx.from!.id, "product.delete", { id });
    await tAEdit(ctx, "deleted", "🗑 Deleted.", {},
      { reply_markup: new InlineKeyboard().text(await getMessageTemplate("admin_btn_products_back", "⬅️ Products"), "adm:p:list:0") });
  });

  // ============ Stock ============
  bot.callbackQuery("adm:s:menu", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCallbackQuery();
    const { data } = await supabaseAdmin.from("products").select("id, name, icon").eq("is_enabled", true).limit(20);
    const kb = new InlineKeyboard();
    (data ?? []).forEach((p) => kb.text(`${p.icon} ${p.name}`, `adm:s:add:${p.id}`).row());
    kb.text(await getMessageTemplate("admin_btn_admin", "⬅️ Admin"), "admin:menu");
    await tAEdit(ctx, "stock_pick_product", "🎟 Pick a product to add codes:", {}, { reply_markup: kb });
  });

  bot.callbackQuery(/^adm:s:add:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = ctx.match![1];
    await ctx.answerCallbackQuery();
    await setState(ctx.from!.id, { admin: "add_codes", product_id: id });
    await tA(ctx, "add_codes_prompt", "Paste codes — one per line.");
  });

  // ============ Orders ============
  bot.callbackQuery(/^adm:o:list:(pending|paid|paid_waiting_delivery|delivered|failed|expired|rejected|refunded):(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const status = ctx.match![1];
    const page = parseInt(ctx.match![2], 10);
    await ctx.answerCallbackQuery();
    const { data } = await supabaseAdmin
      .from("orders")
      .select("id, short_id, total_cents, user_telegram_id, status, products(name, icon)")
      .eq("status", status as any)
      .order("created_at", { ascending: false })
      .range(page * 10, page * 10 + 9) as any;
    const header = await renderMessage("admin_orders_list_header", "🧾 *Orders — {status}*\n\n", { status });
    const empty = await getMessageTemplate("admin_orders_list_empty", "_None_");
    const lineTpl = await getMessageTemplate("admin_orders_list_line",
      "*{short_id}* — {name} — {total} ETB — user `{user}`\n");
    let text = header;
    const kb = new InlineKeyboard();
    if (!data || data.length === 0) text += empty;
    for (const o of data ?? []) {
      text += lineTpl
        .replace("{short_id}", o.short_id)
        .replace("{name}", o.products?.name ?? "?")
        .replace("{total}", formatPrice(o.total_cents))
        .replace("{user}", String(o.user_telegram_id));
      kb.text(o.short_id, `adm:o:view:${o.id}`).row();
    }
    for (const s of ["pending", "paid_waiting_delivery", "delivered", "failed", "rejected", "refunded"]) {
      kb.text(s === status ? `• ${s}` : s, `adm:o:list:${s}:0`);
    }
    kb.row().text(await getMessageTemplate("admin_btn_admin", "⬅️ Admin"), "admin:menu");
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
  });

  bot.callbackQuery(/^adm:o:view:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = ctx.match![1];
    await ctx.answerCallbackQuery();
    const { data: o } = await supabaseAdmin
      .from("orders").select("*, products(name, icon)").eq("id", id).maybeSingle() as any;
    if (!o) return;
    const codeLine = o.delivered_code ? `\nDelivered code:\n\`${o.delivered_code}\`` : "";
    const credsLine =
  o.customer_email || o.customer_telegram_username ?
  `\n\nCustomer request details:${
        o.customer_email ? `\nEmail: ${o.customer_email}` : ""
      }${
        o.customer_password ? `\nPassword: ${o.customer_password}` : ""
      }${
        o.customer_telegram_username ? `\nTelegram: ${o.customer_telegram_username}` : ""
      }` :
  "";
    
    const kb = new InlineKeyboard();
    if (o.status === "paid_waiting_delivery" || (o.status === "paid" && o.manual_delivery_status !== "delivered")) {
      kb.text(await getMessageTemplate("admin_btn_deliver_now", "📨 Deliver Now"), `mdl:start:${o.id}`)
        .text(await getMessageTemplate("admin_btn_reject", "❌ Reject"), `mdl:reject:${o.id}`).row()
        .text(await getMessageTemplate("admin_btn_refund", "💸 Refund"), `mdl:refund:${o.id}`).row();
    }
    if (o.status === "delivered") {
      kb.text(await getMessageTemplate("admin_btn_resend_code", "📨 Resend code"), `adm:o:resend:${o.id}`)
        .text(await getMessageTemplate("admin_btn_refund", "💸 Refund"), `mdl:refund:${o.id}`).row();
    }
    kb.text(await getMessageTemplate("admin_btn_back", "⬅️ Back"), "adm:o:list:pending:0");
    await tAEdit(ctx, "order_view",
      "🧾 *{short_id}*\n\nProduct: {icon} {name}\nQty: {qty}\nTotal: {total} ETB\nMethod: {method}\nStatus: {status}\nManual delivery: {manual}\nUser: `{user}`{creds_line}{code_line}",
      {
        short_id: o.short_id, icon: o.products?.icon, name: o.products?.name,
        qty: o.quantity, total: formatPrice(o.total_cents),
        method: o.payment_method ?? (o.paid_from_wallet ? "wallet" : "—"),
        status: o.status, manual: o.manual_delivery_status,
        user: o.user_telegram_id, code_line: codeLine, creds_line: credsLine,
      }, { reply_markup: kb });
  });

  bot.callbackQuery(/^adm:o:resend:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = ctx.match![1];
    await ctx.answerCallbackQuery();
    const { data: o } = await supabaseAdmin
      .from("orders").select("user_telegram_id, short_id, delivered_code").eq("id", id).maybeSingle();
    if (!o?.delivered_code) { await tA(ctx, "resend_no_code", "No code to resend."); return; }
    try {
      await tSend(ctx, Number(o.user_telegram_id), "resend_code_dm",
        "📨 Code for *{short_id}*:\n`{code}`", { short_id: o.short_id, code: o.delivered_code });
      await audit(ctx.from!.id, "order.resend", { id });
      await tA(ctx, "resend_sent", "Sent.");
    } catch (e: any) { await tA(ctx, "generic_failed", "Failed: {error}", { error: e.message }); }
  });

  // ============ Manual delivery callbacks (mdl:*) ============
  bot.callbackQuery(/^mdl:start:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const orderId = ctx.match![1];
    await ctx.answerCallbackQuery();
    const { data: o } = await supabaseAdmin
      .from("orders").select("status, manual_delivery_status, short_id").eq("id", orderId).maybeSingle();
    if (!o) { await tA(ctx, "order_not_found", "Order not found."); return; }
    if (o.manual_delivery_status === "delivered") { await tA(ctx, "order_already_delivered", "Already delivered."); return; }
    if (!["paid", "paid_waiting_delivery"].includes(o.status as string)) {
      await tA(ctx, "order_cannot_deliver", "Order status is {status}; cannot deliver.", { status: o.status }); return;
    }
    await setState(ctx.from!.id, { admin: "manual_deliver_send", order_id: orderId });
    await tA(ctx, "manual_deliver_prompt",
      "Send the delivery content for *{short_id}* now.\nYou can send: text (multiple lines OK), photo, or document/file.",
      { short_id: o.short_id });
  });

  bot.callbackQuery(/^mdl:reject:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const orderId = ctx.match![1];
    await ctx.answerCallbackQuery();
    await setState(ctx.from!.id, { admin: "reject_order_reason", order_id: orderId });
    await tA(ctx, "reject_reason_prompt",
      "Send the rejection reason (will be visible in user's wallet history):");
  });

  bot.callbackQuery(/^mdl:refund:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const orderId = ctx.match![1];
    await ctx.answerCallbackQuery();
    await setState(ctx.from!.id, { admin: "refund_order_reason", order_id: orderId });
    await tA(ctx, "refund_reason_prompt", "Send the refund reason:");
  });

  // ============ Users ============
  bot.callbackQuery("adm:u:menu", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCallbackQuery();
    await setState(ctx.from!.id, { admin: "user_search" });
    await tA(ctx, "user_search_prompt", "Send a telegram ID or @username to look up:");
  });

  bot.callbackQuery(/^adm:u:(ban|unban):(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const action = ctx.match![1]; const tid = parseInt(ctx.match![2], 10);
    await ctx.answerCallbackQuery();
    await supabaseAdmin.from("bot_users")
      .update({ is_banned: action === "ban", auto_banned_until: null }).eq("telegram_id", tid);
    await audit(ctx.from!.id, `user.${action}`, { telegram_id: tid });
    await tA(ctx, `user_${action}_ok`, action === "ban" ? "✅ User banned." : "✅ User unbanned.");
  });

  bot.callbackQuery(/^adm:u:wallet:(\d+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const tid = parseInt(ctx.match![1], 10);
    await ctx.answerCallbackQuery();
    await setState(ctx.from!.id, { admin: "wallet_adjust_amount", target_user: tid });
    await tA(ctx, "wallet_adjust_amount_prompt",
      "Send signed amount in ETB (e.g. 100 to credit, -50 to debit):");
  });

  // ============ Wallet admin ============
  bot.callbackQuery("adm:w:menu", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCallbackQuery();
    await setState(ctx.from!.id, { admin: "wallet_adjust_user" });
    await tA(ctx, "wallet_adjust_user_prompt", "Send the user's telegram ID to adjust wallet:");
  });

  // ============ Templates ============
bot.callbackQuery("adm:t:list", async (ctx) => {
  if (!requireAdmin(ctx)) return;

  await ctx.answerCallbackQuery();

  const pinnedKeys = [
  "welcome",
  "order_created",
  "wallet_pay_manual",
  "delivery",
  "delivery_completed",
  
  "channel_order_pending",
  "channel_new_purchase",
  "channel_wallet_deposit_success",
  
  "payment_instruction_telebirr",
  "payment_instruction_cbe",
  "wallet_deposit_method_prompt",
  "wallet_home",
  "product_detail",
  "broadcast_stock_added",
  "bot_policies",
  "order_credentials_prompt_email",
"order_credentials_prompt_email_password",
"order_credentials_invalid_email",
"order_credentials_invalid_email_password",
"order_credentials_prompt_telegram",
"order_credentials_invalid_telegram",
"admin_btn_credentials_telegram",
];

  const { data, error } = await supabaseAdmin
    .from("message_templates")
    .select("key")
    .order("key")
    .limit(500);

  if (error) {
    await tA(ctx, "generic_failed", "Failed: {error}", {
      error: error.message,
    });
    return;
  }

  const kb = new InlineKeyboard();
  const added = new Set<string>();

  for (const key of pinnedKeys) {
    kb.text(`⭐ ${key}`, `adm:t:edit:${key}`).row();
    added.add(key);
  }

  for (const t of data ?? []) {
    if (added.has(t.key)) continue;

    kb.text(t.key, `adm:t:edit:${t.key}`).row();
    added.add(t.key);
  }

  kb.text(await getMessageTemplate("admin_btn_admin", "⬅️ Admin"), "admin:menu");

  await tAEdit(ctx, "templates_header", "📝 *Templates*", {}, {
    reply_markup: kb,
  });
});

bot.callbackQuery(/^adm:t:edit:(.+)$/, async (ctx) => {
  if (!requireAdmin(ctx)) return;

  const key = ctx.match![1];

  await ctx.answerCallbackQuery();

  const { data, error } = await supabaseAdmin
    .from("message_templates")
    .select("body")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    await tA(ctx, "generic_failed", "Failed: {error}", {
      error: error.message,
    });
    return;
  }

  await setState(ctx.from!.id, {
    admin: "edit_template",
    key,
  });

  await tA(
    ctx,
    "edit_template_prompt",
    "Current *{key}*:\n\n{body}\n\nSend the new body.",
    {
      key,
      body: data?.body ?? "_empty_",
    },
  );
});
  // ============ Buttons editor ============
  bot.callbackQuery("adm:btn:list", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCallbackQuery();
    const buttons = await loadButtons(true);
    const kb = new InlineKeyboard();
    for (const b of buttons) {
      kb.text(`${b.is_visible ? "✅" : "🚫"} ${b.emoji} ${b.label}`, `adm:btn:edit:${b.key}`).row();
    }
    kb.text(await getMessageTemplate("admin_btn_admin", "⬅️ Admin"), "admin:menu");
    await tAEdit(ctx, "buttons_header", "🔘 *Buttons* — tap to edit:", {}, { reply_markup: kb });
  });

  bot.callbackQuery(/^adm:btn:edit:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const key = ctx.match![1];
    await ctx.answerCallbackQuery();
    const { data: b } = await supabaseAdmin.from("button_templates").select("*").eq("key", key).maybeSingle();
    if (!b) return;
    const kb = new InlineKeyboard()
      .text(await getMessageTemplate("admin_btn_edit_label", "✏️ Label"), `adm:btn:label:${key}`)
.text(await getMessageTemplate("admin_btn_edit_emoji", "🎨 Emoji"), `adm:btn:emoji:${key}`).row()
.text("💎 Premium Icon ID", `adm:btn:premium:${key}`).row()
.text(b.is_visible ? await getMessageTemplate("admin_btn_hide", "🚫 Hide") : await getMessageTemplate("admin_btn_show", "✅ Show"), `adm:btn:toggle:${key}`).row()
      .text("⬆️", `adm:btn:move:${key}:up`).text("⬇️", `adm:btn:move:${key}:down`).row()
      .text(await getMessageTemplate("admin_btn_buttons_back", "⬅️ Buttons"), "adm:btn:list");
    await tAEdit(ctx, "button_view",
      "*{key}*\nLabel: {label}\nEmoji: {emoji}\nPremium Icon ID: {premium}\nVisible: {visible}\nOrder: {sort}",
      {   key,   label: b.label,   emoji: b.emoji || "—",   premium: b.icon_custom_emoji_id || "—",   visible: b.is_visible,   sort: b.sort_order, },
      { reply_markup: kb });
  });

  bot.callbackQuery(/^adm:btn:(label|emoji|premium):(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const field = ctx.match![1]; const key = ctx.match![2];
    await ctx.answerCallbackQuery();
    await setState(ctx.from!.id, { admin: "edit_button", field, key });
    await tA(
  ctx,
  `edit_button_${field}_prompt`,
  field === "label"
    ? "Send new label text:"
    : field === "emoji"
      ? "Send fallback emoji:"
      : "Send the premium custom emoji itself, or paste the custom emoji ID:",
);
  });

  bot.callbackQuery(/^adm:btn:toggle:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const key = ctx.match![1];
    await ctx.answerCallbackQuery();
    const { data: b } = await supabaseAdmin.from("button_templates").select("is_visible").eq("key", key).maybeSingle();
    if (!b) return;
    await supabaseAdmin.from("button_templates").update({ is_visible: !b.is_visible }).eq("key", key);
    invalidateButtonsCache();
    await audit(ctx.from!.id, "button.toggle", { key, visible: !b.is_visible });
    await tA(ctx, "updated", "Updated.", {},
      { reply_markup: new InlineKeyboard().text(await getMessageTemplate("admin_btn_reload", "Reload"), `adm:btn:edit:${key}`) });
  });

  bot.callbackQuery(/^adm:btn:move:([^:]+):(up|down)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const key = ctx.match![1]; const dir = ctx.match![2];
    await ctx.answerCallbackQuery();
    const { data: b } = await supabaseAdmin.from("button_templates").select("sort_order").eq("key", key).maybeSingle();
    if (!b) return;
    const delta = dir === "up" ? -15 : 15;
    await supabaseAdmin.from("button_templates").update({ sort_order: b.sort_order + delta }).eq("key", key);
    invalidateButtonsCache();
    await tA(ctx, "button_moved", "Moved {dir}.", { dir },
      { reply_markup: new InlineKeyboard().text(await getMessageTemplate("admin_btn_buttons_back", "⬅️ Buttons"), "adm:btn:list") });
  });

  // ============ Broadcast ============
  bot.callbackQuery("adm:b:new", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text(await getMessageTemplate("admin_btn_broadcast_text", "✏️ Text"), "adm:b:type:text")
      .text(await getMessageTemplate("admin_btn_broadcast_photo", "🖼 Photo + caption"), "adm:b:type:photo").row()
      .text(await getMessageTemplate("admin_btn_admin", "⬅️ Admin"), "admin:menu");
    await tAEdit(ctx, "broadcast_pick_type", "📣 *Broadcast* — pick type:", {}, { reply_markup: kb });
  });

  bot.callbackQuery(/^adm:b:type:(text|photo)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const kind = ctx.match![1] as "text" | "photo";
    await ctx.answerCallbackQuery();
    if (kind === "text") {
      await setState(ctx.from!.id, { admin: "broadcast_text_body" });
      await tA(ctx, "broadcast_text_prompt", "Send the broadcast text:");
    } else {
      await setState(ctx.from!.id, { admin: "broadcast_photo_image" });
      await tA(ctx, "broadcast_photo_prompt", "Send the photo (you can include a caption):");
    }
  });

  bot.callbackQuery(/^adm:b:send:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = ctx.match![1];
    await ctx.answerCallbackQuery();
    const m = await tA(ctx, "broadcast_queued", "📣 Broadcast queued. Starting…");
    await supabaseAdmin.from("broadcasts").update({
      progress_chat_id: ctx.chat!.id, progress_message_id: m.message_id,
    }).eq("id", id);
    await audit(ctx.from!.id, "broadcast.start", { id });
    // Run inline — Cloudflare Workers kill orphan promises after the response returns.
    try {
      await runUntilDrained(getBot(), id);
      const bc = await supabaseAdmin.from("broadcasts").select("sent,failed,total,status").eq("id", id).maybeSingle();
      if (bc.data) {
        await tA(ctx, "broadcast_done",
          "✅ Broadcast finished — sent {sent} / {total} (failed {failed}).",
          { sent: bc.data.sent, total: bc.data.total, failed: bc.data.failed });
      }
    } catch (e: any) {
      console.error("[broadcast]", e);
      try { await tA(ctx, "broadcast_failed", "❌ Broadcast error: {error}", { error: e?.message ?? String(e) }); } catch { /* noop */ }
    }
  });

  bot.callbackQuery(/^adm:b:cancel:(.+)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const id = ctx.match![1];
    await ctx.answerCallbackQuery();
    await cancelBroadcast(id);
    await audit(ctx.from!.id, "broadcast.cancel", { id });
    await tA(ctx, "broadcast_cancelled", "❌ Broadcast cancelled.");
  });

  // ============ Stats ============
  bot.callbackQuery("adm:stats", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCallbackQuery();
    const s = await getStats();
    const noneLabel = await getMessageTemplate("admin_stats_top_none", "_none_");
    const top = s.topProducts.length
      ? s.topProducts.map((p, i) => `${i + 1}. ${p.name} — ${p.qty}`).join("\n")
      : noneLabel;
    await tAEdit(ctx, "stats",
      "📊 *Stats*\n\n👥 Users: {users}\n📈 Active (7d): {active}\n\n📦 Delivered: {delivered}\n⏳ Pending: {pending}\n👤 Awaiting manual: {manual}\n\n💰 Revenue today: *{rev_today} ETB*\n💰 This week: *{rev_week} ETB*\n💰 This month: *{rev_month} ETB*\n\n✅ Payment success: {ok}\n❌ Payment failures: {fail}\n\n🏆 *Top products (30d)*:\n{top}",
      {
        users: s.users, active: s.activeUsers7d,
        delivered: s.delivered, pending: s.pending, manual: s.manualWaiting,
        rev_today: formatPrice(s.revenueToday), rev_week: formatPrice(s.revenueWeek), rev_month: formatPrice(s.revenueMonth),
        ok: s.paymentSuccess, fail: s.paymentFailure, top,
      }, { reply_markup: await backToMenuKeyboard() });
  });

  // ============ Admins management ============
  bot.callbackQuery("adm:adm:list", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCallbackQuery();
    const { listAllAdmins } = await import("./util");
    const admins = await listAllAdmins();
    const lines = admins.map((a) =>
      `• \`${a.telegram_id}\` ${a.source === "env" ? "🔒 env" : "🛡 added"}${a.note ? ` — ${a.note}` : ""}`,
    ).join("\n") || "_(none)_";
    const kb = new InlineKeyboard()
      .text("➕ Add admin", "adm:adm:add").row()
      .text("➖ Remove admin", "adm:adm:rm").row()
      .text("⬅️ Admin", "admin:menu");
    await tAEdit(ctx, "admins_list", "🛡 *Admins*\n\n{list}\n\n_env admins are configured via the ADMIN_TELEGRAM_IDS secret and cannot be removed here._",
      { list: lines }, { reply_markup: kb });
  });

  bot.callbackQuery("adm:adm:add", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCallbackQuery();
    await setState(ctx.from!.id, { admin: "add_admin_id" });
    await tA(ctx, "add_admin_prompt", "Send the Telegram numeric ID of the user to make admin:");
  });

  bot.callbackQuery("adm:adm:rm", async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.answerCallbackQuery();
    await setState(ctx.from!.id, { admin: "remove_admin_id" });
    await tA(ctx, "remove_admin_prompt", "Send the Telegram numeric ID of the admin to remove:");
  });

  // ============ Text & media flows ============

  bot.on("message", async (ctx, next) => {
    if (!ctx.isAdmin) return next();
    const state = await getState(ctx.from!.id);
    if (!state?.admin) return next();
    const text = ctx.message?.text?.trim();
    if (text?.startsWith("/")) return next();

    switch (state.admin) {
      case "add_admin_id": {
        if (!text) return next();
        const tid = parseInt(text.replace("@", ""), 10);
        if (!Number.isFinite(tid)) { await tA(ctx, "add_admin_invalid", "Send a numeric telegram ID."); return; }
        try {
          const { addDbAdmin, isEnvAdmin } = await import("./util");
          if (isEnvAdmin(tid)) { await tA(ctx, "add_admin_env", "That ID is already an env admin."); await setState(ctx.from!.id, null); return; }
          await addDbAdmin(tid, ctx.from!.id);
          await audit(ctx.from!.id, "admin.add", { telegram_id: tid });
          await setState(ctx.from!.id, null);
          await tA(ctx, "add_admin_done", "✅ Added `{id}` as admin.", { id: tid });
          try { await ctx.api.sendMessage(tid, "🛡 You have been granted admin access. Use /start."); } catch { /* user hasn't started bot */ }
        } catch (e: any) {
          await tA(ctx, "generic_failed", "Failed: {error}", { error: e?.message ?? e });
        }
        return;
      }
      case "remove_admin_id": {
        if (!text) return next();
        const tid = parseInt(text.replace("@", ""), 10);
        if (!Number.isFinite(tid)) { await tA(ctx, "remove_admin_invalid", "Send a numeric telegram ID."); return; }
        try {
          const { removeDbAdmin } = await import("./util");
          await removeDbAdmin(tid);
          await audit(ctx.from!.id, "admin.remove", { telegram_id: tid });
          await setState(ctx.from!.id, null);
          await tA(ctx, "remove_admin_done", "✅ Removed `{id}` from admins.", { id: tid });
        } catch (e: any) {
          await setState(ctx.from!.id, null);
          await tA(ctx, "generic_failed", "Failed: {error}", { error: e?.message ?? e });
        }
        return;
      }
      case "new_product_name": {
        if (!text) return next();
        await setState(ctx.from!.id, { admin: "new_product_price", name: text });
        await tA(ctx, "new_product_price_prompt", "Price in ETB (e.g. 99.50):");
        return;
      }
      case "new_product_price": {
        if (!text) return next();
        const n = parseFloat(text);
        if (!Number.isFinite(n) || n < 0) { await tA(ctx, "invalid_input", "Invalid."); return; }
        const { data, error } = await supabaseAdmin.from("products").insert({
          name: state.name, price_cents: Math.round(n * 100),
        }).select("id").single();
        if (error || !data) { await tA(ctx, "generic_failed", "Failed: {error}", { error: error?.message ?? "" }); return; }
        await audit(ctx.from!.id, "product.create", { id: data.id, name: state.name });
        await setState(ctx.from!.id, null);
        await tA(ctx, "new_product_created", "✅ Created. Open Products → {name} to edit.", { name: state.name });
        return;
      }
      case "edit_product": {
        if (!text) return next();
        const field = state.field as string; const id = state.product_id as string;
        const update: any = {};
        if (field === "name") update.name = text;

else if (field === "desc") {
  update.description = encodeCustomEmoji(
    ctx.message?.text ?? text,
    ctx.message?.entities as any
  ).trim();
}

else if (field === "warranty") {
  update.warranty_text = encodeCustomEmoji(
    ctx.message?.text ?? text,
    ctx.message?.entities as any
  ).trim();
}
        else if (field === "icon") {   const customEmoji = ctx.message?.entities?.find(     (e: any) => e.type === "custom_emoji",   ) as any;    update.icon = customEmoji?.custom_emoji_id     ? String(customEmoji.custom_emoji_id)     : text.trim(); }
        else if (field === "price") {
          const n = parseFloat(text);
          if (!Number.isFinite(n) || n < 0) { await tA(ctx, "invalid_input", "Invalid."); return; }
          update.price_cents = Math.round(n * 100);
        }
        const { error } = await supabaseAdmin.from("products").update(update).eq("id", id);
        if (error) { await tA(ctx, "generic_failed", "Failed: {error}", { error: error.message }); return; }
        await audit(ctx.from!.id, "product.edit", { id, field });
        await setState(ctx.from!.id, null);
        await tA(ctx, "generic_updated", "✅ Updated.");
        return;
      }
      case "add_codes": {
        if (!text) return next();
        const id = state.product_id as string;
        const codes = text
  .split(/\n\s*\n/g)
  .map((c) => c.trim())
  .filter(Boolean);
        if (codes.length === 0) { await tA(ctx, "add_codes_empty", "No codes."); return; }
        const { error } = await supabaseAdmin.from("product_codes").insert(
          codes.map((code) => ({ product_id: id, code })),
        );
        if (error) { await tA(ctx, "generic_failed", "Failed: {error}", { error: error.message }); return; }
        await audit(ctx.from!.id, "stock.add", {
  id,
  count: codes.length,
});

await broadcastStockToUsers(ctx, id, codes.length);

await setState(ctx.from!.id, null);

await tA(ctx, "add_codes_done", "✅ Added {count} code(s).", {
  count: codes.length,
});

return;
      }
      case "user_search": {
        if (!text) return next();
        let q = text;
        let query = supabaseAdmin.from("bot_users").select("*");
        if (q.startsWith("@")) q = q.slice(1);
        if (/^\d+$/.test(q)) query = query.eq("telegram_id", parseInt(q, 10));
        else query = query.eq("username", q);
        const { data } = await query.maybeSingle();
        if (!data) { await tA(ctx, "user_not_found", "Not found."); await setState(ctx.from!.id, null); return; }
        const { data: w } = await supabaseAdmin.from("wallets").select("balance_cents")
          .eq("user_telegram_id", data.telegram_id).maybeSingle();
        const kb = new InlineKeyboard()
          .text(data.is_banned ? await getMessageTemplate("admin_btn_unban", "✅ Unban") : await getMessageTemplate("admin_btn_ban", "⛔ Ban"),
            `adm:u:${data.is_banned ? "unban" : "ban"}:${data.telegram_id}`).row()
          .text(await getMessageTemplate("admin_btn_adjust_wallet", "💼 Adjust wallet"), `adm:u:wallet:${data.telegram_id}`);
        await setState(ctx.from!.id, null);
        await tA(ctx, "user_found",
          "👤 {first} @{username} `{id}`\nBanned: {banned}\nAbuse score: {abuse}\nWallet: {balance} ETB",
          {
            first: data.first_name ?? "", username: data.username ?? "—", id: data.telegram_id,
            banned: data.is_banned, abuse: data.abuse_score ?? 0,
            balance: formatPrice(w?.balance_cents ?? 0),
          }, { reply_markup: kb });
        return;
      }
      case "edit_template": {
        if (!text) return next();
        const key = state.key as string;
        // Preserve premium custom emoji entities by re-encoding them into our
        // `<ce:ID>fallback</ce>` markers before saving the template body.
        const body = encodeCustomEmoji(ctx.message?.text ?? text, ctx.message?.entities as any).trim();
        await supabaseAdmin.from("message_templates").upsert({ key, body }, { onConflict: "key" });
        await audit(ctx.from!.id, "template.edit", { key });
        await setState(ctx.from!.id, null);
        await tA(ctx, "edit_template_done", "✅ Template *{key}* updated.", { key });
        return;
      }
      case "edit_button": {
  if (!text) return next();

  const field = state.field as string;
  const key = state.key as string;

  const customEmoji = ctx.message?.entities?.find(
    (e: any) => e.type === "custom_emoji",
  ) as any;

  let update: any = {};

  if (field === "label") {
    update = { label: text };
  } else if (field === "emoji") {
    update = { emoji: text.slice(0, 4) };
  } else if (field === "premium") {
    const idFromEmoji = customEmoji?.custom_emoji_id;
    const idFromText = text.match(/\d{8,}/)?.[0];
    const iconId = idFromEmoji || idFromText;

    if (!iconId) {
      await tA(
        ctx,
        "edit_button_premium_invalid",
        "❌ I couldn't detect a premium custom emoji ID. Send the premium emoji itself or paste the numeric ID.",
      );
      return;
    }

    update = { icon_custom_emoji_id: String(iconId) };
  } else {
    return next();
  }

  const { error } = await supabaseAdmin
    .from("button_templates")
    .update(update)
    .eq("key", key);

  if (error) {
    await tA(ctx, "generic_failed", "Failed: {error}", { error: error.message });
    return;
  }

  invalidateButtonsCache();
  await audit(ctx.from!.id, "button.edit", { key, field, update });
  await setState(ctx.from!.id, null);
  await tA(ctx, "generic_updated", "✅ Updated.");
  return;
}
      case "wallet_adjust_user": {
        if (!text) return next();
        const tid = parseInt(text.replace("@", ""), 10);
        if (!Number.isFinite(tid)) { await tA(ctx, "wallet_adjust_user_invalid", "Send a numeric telegram ID."); return; }
        await setState(ctx.from!.id, { admin: "wallet_adjust_amount", target_user: tid });
        await tA(ctx, "wallet_adjust_amount_prompt2", "Send signed amount in ETB (e.g. 100 or -50):");
        return;
      }
      case "wallet_adjust_amount": {
        if (!text) return next();
        const n = parseFloat(text);
        if (!Number.isFinite(n)) { await tA(ctx, "wallet_adjust_amount_invalid", "Invalid number."); return; }
        try {
          const newBal = await adminAdjust(ctx.from!.id, Number(state.target_user), Math.round(n * 100), "Admin adjustment");
          await setState(ctx.from!.id, null);
          await tA(ctx, "wallet_adjust_done", "✅ Done. New balance: {balance} ETB.", { balance: formatPrice(newBal) });
        } catch (e: any) { await tA(ctx, "generic_failed", "Failed: {error}", { error: e?.message ?? e }); }
        return;
      }
      case "reject_order_reason": {
        if (!text) return next();
        try {
          const row = await rejectOrder(state.order_id as string, ctx.from!.id, text);
          await setState(ctx.from!.id, null);
          await tA(ctx, "reject_done", "✅ Rejected {short}. Refunded {refund} ETB.",
            { short: row.short_id, refund: formatPrice(row.refunded_cents) });
          try {
            await tSend(ctx, Number(row.user_telegram_id), "user_dm_rejected",
              "❌ Your order *{short}* was rejected.\nReason: {reason}\nRefunded *{refund} ETB* to your wallet.",
              { short: row.short_id, reason: text, refund: formatPrice(row.refunded_cents) });
          } catch { /* user blocked */ }
        } catch (e: any) { await tA(ctx, "generic_failed", "Failed: {error}", { error: e?.message ?? e }); }
        return;
      }
      case "refund_order_reason": {
        if (!text) return next();
        try {
          const row = await refundOrder(state.order_id as string, ctx.from!.id, text);
          await setState(ctx.from!.id, null);
          await tA(ctx, "refund_done", "✅ Refunded {short}: {refund} ETB.",
            { short: row.short_id, refund: formatPrice(row.refunded_cents) });
          try {
            await tSend(ctx, Number(row.user_telegram_id), "user_dm_refunded",
              "💸 Refund for *{short}*: *{refund} ETB* added to your wallet.\nReason: {reason}",
              { short: row.short_id, refund: formatPrice(row.refunded_cents), reason: text });
          } catch { /* ignore */ }
        } catch (e: any) { await tA(ctx, "generic_failed", "Failed: {error}", { error: e?.message ?? e }); }
        return;
      }
      case "manual_deliver_send": {
  const orderId = state.order_id as string;
  
  const { data: o } = await supabaseAdmin
  .from("orders")
  .select("user_telegram_id, short_id, status, manual_delivery_status, products(name, icon, warranty_text)")
  .eq("id", orderId)
  .maybeSingle();
  
  if (!o) {
    await tA(ctx, "order_missing", "Order missing.");
    await setState(ctx.from!.id, null);
    return;
  }
  
  if (o.manual_delivery_status === "delivered") {
    await tA(ctx, "order_already_delivered", "Already delivered.");
    await setState(ctx.from!.id, null);
    return;
  }
  
  const userId = Number(o.user_telegram_id);
  
  try {
    if (ctx.message?.text) {
      const body = await renderMessage(
        "delivery_completed",
        "🎉 *Delivery for {short}*\n\n{content}",
     {
  short: o.short_id,
  short_id: o.short_id,
  order_id: o.short_id,
  
  icon: deliveryProductIcon((o as any).products?.icon),
  product_name: (o as any).products?.name ?? "",
  warranty: (o as any).products?.warranty_text ?? "",
  
  content: encodeCustomEmoji(
  ctx.message.text,
  ctx.message.entities as any
),
        }
      );
      
      await ctx.api.sendMessage(userId, toHtml(body), {
  parse_mode: "HTML",
});
      
      await markManuallyDelivered(
        orderId,
        ctx.from!.id,
        "text",
        ctx.message.text.slice(0, 500)
      );
      
    } else if (ctx.message?.photo?.length) {
      const ph = ctx.message.photo[ctx.message.photo.length - 1];
      
      const caption = await renderMessage(
        "delivery_completed",
        "🎉 *Delivery for {short}*\n\n{content}",
       {
  short: o.short_id,
  short_id: o.short_id,
  order_id: o.short_id,

  icon: deliveryProductIcon((o as any).products?.icon),
  product_name: (o as any).products?.name ?? "",
  warranty: (o as any).products?.warranty_text ?? "",

  content: encodeCustomEmoji(   ctx.message.caption ?? "",   ctx.message.caption_entities as any ),
        }
      );
      
      await ctx.api.sendPhoto(userId, ph.file_id, {
  caption: toHtml(caption),
  parse_mode: "HTML",
});
      
      await markManuallyDelivered(
        orderId,
        ctx.from!.id,
        "photo"
      );
      
    } else if (ctx.message?.document) {
      const caption = await renderMessage(
        "delivery_completed",
        "🎉 *Delivery for {short}*\n\n{content}",
        {
  short: o.short_id,
  short_id: o.short_id,
  order_id: o.short_id,
  
  icon: deliveryProductIcon((o as any).products?.icon),
  product_name: (o as any).products?.name ?? "",
  warranty: (o as any).products?.warranty_text ?? "",
  
  content: encodeCustomEmoji(  ctx.message.caption ?? "",   ctx.message.caption_entities as any ),
        }
      );
      
      await ctx.api.sendDocument(userId, ctx.message.document.file_id, {
  caption: toHtml(caption),
  parse_mode: "HTML",
});
      
      await markManuallyDelivered(
        orderId,
        ctx.from!.id,
        "document"
      );
      
    } else {
      await tA(
        ctx,
        "manual_deliver_unsupported",
        "Unsupported content type. Send text, photo, or document."
      );
      return;
    }
    
    await setState(ctx.from!.id, null);
    
    await tA(ctx, "manual_deliver_done", "✅ Delivered {short} to user.", {
      short: o.short_id,
    });
    
  } catch (e: any) {
    await tA(ctx, "generic_failed", "Failed: {error}", {
      error: e?.message ?? e,
    });
  }
  
  return;
}
      case "broadcast_text_body": {
  if (!text) return next();
  
  const body = encodeCustomEmoji(
    ctx.message?.text ?? text,
    ctx.message?.entities as any
  ).trim();
  
  await setState(ctx.from!.id, null);
  
  const id = await createBroadcast({
    adminId: ctx.from!.id,
    kind: "text",
    text: body,
  });
  
  await previewBroadcast(ctx, id, body);
  return;
}
      case "broadcast_photo_image": {
  if (!ctx.message?.photo?.length) {
    await tA(ctx, "broadcast_photo_invalid", "Send a photo (with optional caption).");
    return;
  }

  const ph = ctx.message.photo[ctx.message.photo.length - 1];

  const caption = encodeCustomEmoji(
    ctx.message.caption ?? "",
    ctx.message.caption_entities as any
  ).trim();

  await setState(ctx.from!.id, null);

  const id = await createBroadcast({
    adminId: ctx.from!.id,
    kind: "photo",
    photoFileId: ph.file_id,
    text: caption,
  });

  await previewBroadcast(ctx, id, caption || "(photo)");
  return;
}
    }
    return next();
  });
}

async function previewBroadcast(ctx: BotCtx, id: string, preview: string) {
  const { data: bc } = await supabaseAdmin.from("broadcasts").select("total").eq("id", id).maybeSingle();
  const kb = new InlineKeyboard()
    .text(await getMessageTemplate("admin_btn_broadcast_send", "📣 Send now"), `adm:b:send:${id}`)
    .text(await getMessageTemplate("admin_btn_cancel", "❌ Cancel"), `adm:b:cancel:${id}`).row()
    .text(await getMessageTemplate("admin_btn_admin", "⬅️ Admin"), "admin:menu");
  await tA(ctx, "broadcast_preview",
    "📣 Broadcast ready ({total} recipients)\n\n_Preview:_\n{preview}",
    { total: bc?.total ?? 0, preview: preview.slice(0, 500) },
    { reply_markup: kb });
}
