import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BotCtx } from "./bot";
import {
  backToMenuKeyboard, productListKeyboard, quantityKeyboard,
  paymentMethodKeyboard, awaitingReferenceKeyboard, walletHomeKeyboard,
  depositAmountKeyboard, referralKeyboard,
} from "./keyboards";
import { dynamicMainMenu } from "@/services/buttons";
import { formatPrice, sha256Hex } from "./util";
import {
  verifyAndDeliver, verifyReceiptAndDeliver, verifyReferenceAnyBank,
} from "@/services/payment";
import { verifyReceiptImage, type VerifyResult } from "@/services/leulVerify";
import { loadAccounts, verifyAnyReceiver, type PayoutProvider } from "@/services/payoutAccounts";
import {
  getBalance, listTransactions, payOrderFromWallet, depositFromVerified,
} from "@/services/wallet";
import {
  parseStartPayload, attachReferrer, stampOrderReferrer, payoutToWallet,
  getStats as getRefStats, grantReward,
} from "@/services/referral";
import { notifyAdminsManualDelivery } from "@/services/manualDelivery";
import { recordAbuse } from "@/services/security";
import { getBot } from "./bot";
import { tReply, tEdit } from "./messaging";
import { renderMessage, getMessageTemplate, renderMessageTemplate } from "@/services/templates";

const PAGE_SIZE = 6;

async function setUserState(telegramId: number, state: Record<string, unknown> | null) {
  if (state === null) {
    await supabaseAdmin.from("admin_sessions").delete().eq("telegram_id", telegramId);
  } else {
    await supabaseAdmin.from("admin_sessions").upsert({ telegram_id: telegramId, state: state as any });
  }
}
async function getUserState(telegramId: number): Promise<Record<string, any> | null> {
  const { data } = await supabaseAdmin
    .from("admin_sessions").select("state").eq("telegram_id", telegramId).maybeSingle();
  return (data?.state as any) ?? null;
}

export function registerCustomer(bot: Bot<BotCtx>) {
  bot.command("start", async (ctx) => {
    const refId = parseStartPayload(ctx.message?.text);
    if (refId && ctx.from && refId !== ctx.from.id) {
      try { await attachReferrer(ctx.from.id, refId); } catch (e) { console.error("[attachReferrer]", e); }
    }
    const kb = await dynamicMainMenu(ctx.isAdmin);
    await tReply(ctx, "welcome", "🔥 NEW SERVER TEST {first_name}!", {
      first_name: ctx.from?.first_name ?? "",
      username: ctx.from?.username ?? "",
      telegram_id: ctx.from?.id ?? "",
    }, { reply_markup: kb });
  });

  const guideText =
    "📖 *Bot Guide*\n\n" +
    "*🛒 Shop* — browse products, pick quantity, choose payment method (Telebirr / CBE / Dashen / Abyssinia / CBE Birr / M-Pesa).\n" +
    "*💳 Paying* — after paying, send the bot the *transaction reference* OR forward the *receipt screenshot*. The bot verifies via Leul Verify, matches receiver + amount, then auto-delivers your code.\n" +
    "*📦 Orders* — view all your past orders, re-read delivered codes, see status (pending / delivered / awaiting manual delivery / rejected).\n" +
    "*⏳ Pending* — your unfinished orders. Pay with reference, receipt, or *Pay from wallet*.\n" +
    "*💼 Wallet* — top up by depositing through any supported bank (send the reference, bot verifies and credits). Use balance to pay any pending order in one tap. View full transaction history.\n" +
    "*🎁 Referrals* — share your link `t.me/<bot>?start=ref_<your_id>`. Earn a % of every order your invitees complete. Move earnings to your wallet anytime.\n" +
    "*👤 Profile* — your account info.\n" +
    "*🆘 Support* — contact info / FAQ set by admin.\n\n" +
    "*Commands:* /start /help /guide\n\n" +
    "*🛡 Security:* deliveries only happen after a real bank verification — receipts/screenshots alone never trigger delivery. Repeated invalid attempts trigger temporary auto-bans.";

  bot.command(["help", "guide"], async (ctx) => {
    const kb = await dynamicMainMenu(ctx.isAdmin);
    console.log("MENU DEBUG:", JSON.stringify(kb, null, 2));
    await tReply(ctx, "guide", guideText, {}, { reply_markup: kb });
  });


  // ---- Shop
  bot.callbackQuery(/^shop:list:(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match![1], 10);
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data: products, count } = await supabaseAdmin
      .from("products").select("id, name, icon, price_cents, delivery_mode", { count: "exact" })
      .eq("is_enabled", true).order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }).range(from, to);
    await ctx.answerCallbackQuery();
    if (!products || products.length === 0) {
      await tEdit(ctx, "shop_empty", "🛒 No products available right now.", {}, { reply_markup: backToMenuKeyboard() });
      return;
    }
    // Compute in_stock per product (manual delivery is always considered in stock)
    const autoIds = products.filter((p: any) => p.delivery_mode === "automatic").map((p: any) => p.id);
    const stockMap = new Map<string, boolean>();
    if (autoIds.length) {
      const { data: codes } = await supabaseAdmin
        .from("product_codes").select("product_id")
        .in("product_id", autoIds).eq("is_used", false);
      for (const id of autoIds) stockMap.set(id, false);
      for (const row of (codes ?? []) as Array<{ product_id: string }>) stockMap.set(row.product_id, true);
    }
    const enriched = products.map((p: any) => ({
      ...p,
      in_stock: p.delivery_mode === "automatic" ? (stockMap.get(p.id) ?? false) : true,
    }));
    await tEdit(ctx, "shop_header", "🛒 *Shop* — pick a product:", {}, {
      reply_markup: productListKeyboard(enriched, page, PAGE_SIZE, count ?? products.length),
    });
  });

  bot.callbackQuery(/^shop:p:(.+)$/, async (ctx) => {
    const id = ctx.match![1];
    const { data: p } = await supabaseAdmin
      .from("products").select("id, name, icon, description, price_cents, warranty_text, quantity_presets, is_enabled, delivery_mode")
      .eq("id", id).maybeSingle();
    await ctx.answerCallbackQuery();
    if (!p || !p.is_enabled) {
      await tEdit(ctx, "product_unavailable", "Product not available.", {}, { reply_markup: backToMenuKeyboard() });
      return;
    }
    let stock = "—";
    if (p.delivery_mode === "automatic") {
      const { count } = await supabaseAdmin
        .from("product_codes").select("id", { count: "exact", head: true })
        .eq("product_id", p.id).eq("is_used", false);
      stock = String(count ?? 0);
    } else {
      stock = await getMessageTemplate("stock_manual_label", "manual delivery");
    }
    await tEdit(ctx, "product_view",
      "{icon} *{name}*\n\n{description}\n\n💵 Price: *{price} ETB* / unit\n🛡 Warranty: {warranty}\n📦 Stock: {stock}\n\nPick a quantity:",
      {
        icon: p.icon, name: p.name,
        description: p.description || "_No description_",
        price: formatPrice(p.price_cents),
        warranty: p.warranty_text || "—",
        stock,
      },
      { reply_markup: quantityKeyboard(p.id, Array.isArray(p.quantity_presets) ? (p.quantity_presets as number[]) : [1, 2, 5, 10]) },
    );
  });

  bot.callbackQuery(/^shop:q:([^:]+):(\d+)$/, async (ctx) => {
    const productId = ctx.match![1];
    const qty = parseInt(ctx.match![2], 10);
    await ctx.answerCallbackQuery();
    await createOrderAndAskMethod(ctx, productId, qty);
  });

  bot.callbackQuery(/^shop:qcustom:(.+)$/, async (ctx) => {
    const productId = ctx.match![1];
    await ctx.answerCallbackQuery();
    await setUserState(ctx.from!.id, { awaiting: "custom_qty", product_id: productId });
    await tReply(ctx, "custom_qty_prompt", "Send the quantity as a number (1-100):");
  });

  // ---- Payment method choice
  bot.callbackQuery(/^pay:method:([^:]+):(telebirr|cbe)$/, async (ctx) => {
    const orderId = ctx.match![1];
    const method = ctx.match![2] as "telebirr" | "cbe";
    await ctx.answerCallbackQuery();
    await supabaseAdmin.from("orders").update({ payment_method: method }).eq("id", orderId);
    await showPaymentInstructions(ctx, orderId, method);
  });

  bot.callbackQuery(/^pay:show:(.+)$/, async (ctx) => {
    const orderId = ctx.match![1];
    await ctx.answerCallbackQuery();
    const { data: o } = await supabaseAdmin
      .from("orders").select("payment_method").eq("id", orderId).maybeSingle();
    if (o?.payment_method) await showPaymentInstructions(ctx, orderId, o.payment_method);
  });

  // ---- Pay from wallet
  bot.callbackQuery(/^pay:wallet:(.+)$/, async (ctx) => {
    const orderId = ctx.match![1];
    await ctx.answerCallbackQuery();
    try {
      const result = await payOrderFromWallet(orderId, ctx.from!.id);
      await setUserState(ctx.from!.id, null);
      if (result.delivery_mode === "manual") {
        await tReply(ctx, "wallet_pay_manual",
          "✅ *Order {short_id} paid from wallet.*\n\nYour payment was verified. Your order is waiting for manual delivery by admin.",
          { short_id: result.short_id }, { reply_markup: backToMenuKeyboard() });
        await notifyAdminsManualDelivery(getBot(), orderId);
      } else {
        await tReply(ctx, "delivery", "Delivered. Code: {code}",
          { short_id: result.short_id, code: result.delivered_code ?? "" },
          { reply_markup: backToMenuKeyboard() });
      }
      try { await grantReward(orderId); } catch { /* noop */ }
    } catch (e: any) {
      const msg = e?.message || "";
      const key = msg.includes("insufficient_funds") ? "wallet_pay_error_insufficient"
        : msg.includes("out_of_stock") ? "wallet_pay_error_out_of_stock"
        : msg.includes("order_expired") ? "wallet_pay_error_expired"
        : "wallet_pay_error_generic";
      const fallback = msg.includes("insufficient_funds") ? "❌ Not enough balance in wallet."
        : msg.includes("out_of_stock") ? "❌ Out of stock — contact support."
        : msg.includes("order_expired") ? "❌ Order has expired."
        : "❌ Failed: {error}";
      await tReply(ctx, key, fallback, { error: msg }, { reply_markup: backToMenuKeyboard() });
    }
  });

  bot.callbackQuery(/^order:cancel:(.+)$/, async (ctx) => {
    const orderId = ctx.match![1];
    await ctx.answerCallbackQuery();
    await supabaseAdmin.from("orders").update({ status: "expired" }).eq("id", orderId).eq("status", "pending");
    await setUserState(ctx.from!.id, null);
    await tEdit(ctx, "order_cancelled", "❌ Order cancelled.", {}, { reply_markup: backToMenuKeyboard() });
  });

  // ---- My orders
  bot.callbackQuery(/^orders:mine:(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match![1], 10);
    await ctx.answerCallbackQuery();
    const { data } = await supabaseAdmin
      .from("orders")
      .select("short_id, status, total_cents, created_at, products(name, icon)")
      .eq("user_telegram_id", ctx.from!.id)
      .order("created_at", { ascending: false })
      .range(page * 10, page * 10 + 9);
    if (!data || data.length === 0) {
      await tEdit(ctx, "orders_empty", "📦 You have no orders yet.", {}, { reply_markup: backToMenuKeyboard() });
      return;
    }
    const lineTpl = await getMessageTemplate("orders_line", "*{short_id}* — {icon} {name} — {total} ETB — _{status}_");
    const lines = data.map((o: any) => renderMessageTemplate(lineTpl, {
      short_id: o.short_id, icon: o.products?.icon ?? "", name: o.products?.name ?? "?",
      total: formatPrice(o.total_cents), status: o.status,
    }));
    await tEdit(ctx, "orders_header", "📦 *Your orders:*\n\n{list}", { list: lines.join("\n") },
      { reply_markup: backToMenuKeyboard() });
  });

  bot.callbackQuery("orders:pending", async (ctx) => {
    await ctx.answerCallbackQuery();
    const { data } = await supabaseAdmin
      .from("orders")
      .select("id, short_id, total_cents, payment_method, products(name, icon)")
      .eq("user_telegram_id", ctx.from!.id).eq("status", "pending")
      .order("created_at", { ascending: false }).limit(5);
    if (!data || data.length === 0) {
      await tEdit(ctx, "orders_pending_empty", "⏳ No pending payments.", {}, { reply_markup: backToMenuKeyboard() });
      return;
    }
    const header = await getMessageTemplate("orders_pending_header", "⏳ *Pending payments — tap to resume:*\n\n");
    const lineTpl = await getMessageTemplate("orders_pending_line", "*{short_id}* — {name} — {total} ETB\n");
    const resumeLabel = await getMessageTemplate("orders_pending_resume_btn", "Resume {short_id}");
    const menuLabel = await getMessageTemplate("btn_main_menu", "⬅️ Main menu");
    let text = header;
    const kb = new InlineKeyboard();
    for (const o of data as any[]) {
      text += renderMessageTemplate(lineTpl, { short_id: o.short_id, name: o.products?.name, total: formatPrice(o.total_cents) });
      kb.text(renderMessageTemplate(resumeLabel, { short_id: o.short_id }), `pay:show:${o.id}`).row();
    }
    kb.text(menuLabel, "menu");
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
  });

  // ---- Profile
  bot.callbackQuery("profile", async (ctx) => {
    await ctx.answerCallbackQuery();
    const { data: u } = await supabaseAdmin
      .from("bot_users").select("created_at").eq("telegram_id", ctx.from!.id).maybeSingle();
    const { count: orderCount } = await supabaseAdmin
      .from("orders").select("id", { count: "exact", head: true })
      .eq("user_telegram_id", ctx.from!.id).eq("status", "delivered");
    const balance = await getBalance(ctx.from!.id);
    await tEdit(ctx, "profile",
      "👤 *Your profile*\n\nName: {first} {last}\nUsername: @{username}\nID: `{id}`\nMember since: {since}\nDelivered orders: {orders}\nWallet: *{balance} ETB*",
      {
        first: ctx.from?.first_name ?? "", last: ctx.from?.last_name ?? "",
        username: ctx.from?.username ?? "—", id: ctx.from?.id,
        since: u?.created_at ? new Date(u.created_at).toLocaleDateString() : "—",
        orders: orderCount ?? 0, balance: formatPrice(balance),
      }, { reply_markup: backToMenuKeyboard() });
  });

  bot.callbackQuery("support", async (ctx) => {
    await ctx.answerCallbackQuery();
    await tEdit(ctx, "support", "Contact admin.", {}, { reply_markup: backToMenuKeyboard() });
  });

  // ---- WALLET
  bot.callbackQuery("wallet:home", async (ctx) => {
    await ctx.answerCallbackQuery();
    const bal = await getBalance(ctx.from!.id);
    await tEdit(ctx, "wallet_home",
      "💼 *Wallet*\n\nBalance: *{balance} ETB*\n\nUse your balance to pay any pending order instantly.",
      { balance: formatPrice(bal) }, { reply_markup: walletHomeKeyboard() });
  });

  bot.callbackQuery("wallet:history", async (ctx) => {
    await ctx.answerCallbackQuery();
    const txs = await listTransactions(ctx.from!.id, 15);
    if (txs.length === 0) {
      await tEdit(ctx, "wallet_history_empty", "No wallet activity yet.", {}, { reply_markup: walletHomeKeyboard() });
      return;
    }
    const lineTpl = await getMessageTemplate("wallet_history_line", "`{date}` {sign}{amount} ({kind})");
    const lines = txs.map((t: any) => renderMessageTemplate(lineTpl, {
      date: new Date(t.created_at).toLocaleDateString(),
      sign: t.amount_cents >= 0 ? "+" : "",
      amount: formatPrice(t.amount_cents),
      kind: t.kind,
    }));
    await tEdit(ctx, "wallet_history_header", "📜 *Wallet history*\n\n{list}", { list: lines.join("\n") },
      { reply_markup: walletHomeKeyboard() });
  });

  bot.callbackQuery("wallet:deposit", async (ctx) => {
    await ctx.answerCallbackQuery();
    await tEdit(ctx, "wallet_deposit_prompt", "💼 *Deposit to wallet*\n\nPick an amount:", {},
      { reply_markup: depositAmountKeyboard() });
  });

  bot.callbackQuery("wallet:depCustom", async (ctx) => {
    await ctx.answerCallbackQuery();
    await setUserState(ctx.from!.id, { awaiting: "deposit_custom_amount" });
    await tReply(ctx, "wallet_deposit_custom_amount_prompt", "Send the amount in ETB (number only):");
  });

  bot.callbackQuery(/^wallet:depAmt:(\d+)$/, async (ctx) => {
    const amt = parseInt(ctx.match![1], 10);
    await ctx.answerCallbackQuery();
    await askDepositMethod(ctx, amt);
  });

  bot.callbackQuery(/^wallet:depMethod:(\d+):(telebirr|cbe)$/, async (ctx) => {
    const amount = parseInt(ctx.match![1], 10);
    const method = ctx.match![2] as "telebirr" | "cbe";
    await ctx.answerCallbackQuery();
    await setUserState(ctx.from!.id, {
      awaiting: "wallet_deposit_reference", amount_cents: amount * 100, method,
    });
    const text = await buildInstructions(method, {
      total: amount.toFixed(2), short_id: "DEPOSIT", quantity: 1, product_name: "Wallet deposit",
    });
    const cancelLabel = await getMessageTemplate("btn_cancel", "❌ Cancel");
    try {
      await ctx.editMessageText(text, {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text(cancelLabel, "wallet:home"),
      });
    } catch {
      await ctx.reply(text, { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text(cancelLabel, "wallet:home") });
    }
    await tReply(ctx, "wallet_deposit_reference_prompt",
      "Send the transaction reference or upload a clear receipt image here.");
  });

  // ---- REFERRALS
  bot.callbackQuery("ref:home", async (ctx) => {
    await ctx.answerCallbackQuery();
    const stats = await getRefStats(ctx.from!.id);
    const me = await ctx.api.getMe();
    const link = `https://t.me/${me.username}?start=ref_${ctx.from!.id}`;
    await tEdit(ctx, "referral_home",
      "🎁 *Referrals*\n\nYour link:\n`{link}`\n\nTotal referred: *{total}*\nPending earnings: *{pending} ETB*\nPaid out: *{paid} ETB*\n\n_You earn a configurable % of every verified order your referrals make._",
      { link, total: stats.totalReferred, pending: formatPrice(stats.pendingCents), paid: formatPrice(stats.paidCents) },
      { reply_markup: referralKeyboard(stats.pendingCents > 0) });
  });

  bot.callbackQuery("ref:payout", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const added = await payoutToWallet(ctx.from!.id);
      if (added <= 0) {
        await tReply(ctx, "referral_nothing", "Nothing to move.");
        return;
      }
      await tReply(ctx, "referral_payout_done", "✅ Moved *{amount} ETB* to wallet.", { amount: formatPrice(added) });
    } catch (e: any) {
      await tReply(ctx, "referral_payout_failed", "Failed: {error}", { error: e?.message ?? e });
    }
  });

  // ---- Text handler
  bot.on("message:text", async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) return next();
    const text = ctx.message.text.trim();
    const state = await getUserState(ctx.from!.id);

    if (state?.awaiting === "custom_qty") {
      const qty = parseInt(text, 10);
      if (!Number.isFinite(qty) || qty < 1 || qty > 100) {
        await tReply(ctx, "custom_qty_invalid", "Please send a number between 1 and 100.");
        return;
      }
      await setUserState(ctx.from!.id, null);
      await createOrderAndAskMethod(ctx, state.product_id, qty);
      return;
    }

    if (state?.awaiting === "deposit_custom_amount") {
      const amt = parseFloat(text);
      if (!Number.isFinite(amt) || amt < 10 || amt > 100000) {
        await tReply(ctx, "wallet_deposit_custom_amount_invalid", "Send a number between 10 and 100000 ETB.");
        return;
      }
      await setUserState(ctx.from!.id, null);
      await askDepositMethod(ctx, amt);
      return;
    }

    if (state?.awaiting === "wallet_deposit_reference") {
      if (!/^[A-Za-z0-9_-]{4,40}$/.test(text)) {
        await tReply(ctx, "wallet_deposit_invalid_reference",
          "Send only the reference (letters/digits, 4–40 chars), or upload a clear receipt image.");
        return;
      }
      await tReply(ctx, "wallet_deposit_reference_verifying", "⏳ Verifying deposit…");
      await handleWalletDepositVerification(ctx, state, text, () => verifyReferenceAnyBank(text));
      return;
    }

    if (state?.awaiting === "payment_reference" && state.order_id) {
      if (!/^[A-Za-z0-9_-]{4,40}$/.test(text)) {
        await tReply(ctx, "payment_invalid_reference",
          "Send only the reference (letters/digits, 4–40 chars), or upload a clear receipt image.");
        return;
      }
      await tReply(ctx, "payment_reference_verifying", "⏳ Verifying your payment…");
      const result = await verifyAndDeliver({
        orderId: state.order_id, userTelegramId: ctx.from!.id, reference: text,
      });
      await handlePaymentResult(ctx, state, result);
      return;
    }

    return next();
  });

  bot.on(["message:photo", "message:document"], async (ctx, next) => {
    const state = await getUserState(ctx.from!.id);
    if (state?.awaiting === "wallet_deposit_reference") {
      const receipt = await downloadReceiptFile(ctx);
      if (!receipt.ok) {
        await tReply(ctx, "wallet_deposit_receipt_download_failed",
          "❌ Could not read that receipt file. Reason: {reason}", { reason: receipt.reason });
        return;
      }
      await tReply(ctx, "wallet_deposit_receipt_verifying", "⏳ Verifying your deposit receipt…");
      await handleWalletDepositVerification(ctx, state, undefined, () => verifyReceipt(receipt.file));
      return;
    }

    if (state?.awaiting !== "payment_reference" || !state.order_id) return next();

    const receipt = await downloadReceiptFile(ctx);
    if (!receipt.ok) {
      await tReply(ctx, "payment_receipt_download_failed",
        "❌ Could not read that receipt file. Please upload a clear image receipt or paste the transaction reference.",
        { reason: receipt.reason }, { reply_markup: awaitingReferenceKeyboard(state.order_id) });
      return;
    }

    await tReply(ctx, "payment_receipt_verifying", "⏳ Verifying your receipt…");
    const result = await verifyReceiptAndDeliver({
      orderId: state.order_id,
      userTelegramId: ctx.from!.id,
      file: receipt.file,
      receiptHash: receipt.hash,
    });
    await handlePaymentResult(ctx, state, result);
  });
}

async function handlePaymentResult(ctx: BotCtx, state: Record<string, any>, result: Awaited<ReturnType<typeof verifyAndDeliver>>) {
  if (result.status === "delivered" || result.status === "waiting_manual") {
    await tReply(ctx, "payment_verified_success",
      "✅ *Payment verified successfully!*\n\nReference: `{reference}`\nAmount: *{amount} ETB*\nOrder: *{short_id}*\n\n_Preparing your delivery…_",
      {
        short_id: result.short_id ?? state.short_id,
        reference: result.reference ?? "",
        amount: result.amount_cents !== undefined ? formatPrice(result.amount_cents) : "",
      });
    if (result.tip_cents && result.tip_cents > 0 && result.amount_cents !== undefined) {
      await tReply(ctx, "payment_tip_thanks",
        "🙏 *Thanks for the {tip} ETB tip!* You paid *{received} ETB* on a *{expected} ETB* order — much appreciated! 💛",
        {
          tip: formatPrice(result.tip_cents),
          expected: formatPrice(result.amount_cents - result.tip_cents),
          received: formatPrice(result.amount_cents),
        });
    }
  }

  if (result.status === "delivered") {
    await setUserState(ctx.from!.id, null);
    const { data: o } = await supabaseAdmin
      .from("orders").select("short_id, products(name, warranty_text)")
      .eq("id", state.order_id).maybeSingle() as any;
    await tReply(ctx, "delivery", "Delivered. Code: {code}", {
      short_id: o?.short_id,
      product_name: o?.products?.name,
      warranty: o?.products?.warranty_text,
      code: result.code,
    }, { reply_markup: await dynamicMainMenu(ctx.isAdmin) });
    return;
  }

  if (result.status === "waiting_manual") {
    await setUserState(ctx.from!.id, null);
    await tReply(ctx, "payment_waiting_manual",
      "✅ Your payment was verified successfully.\n\nYour order *{short_id}* is waiting for manual delivery by admin. You will be notified here as soon as it's delivered.",
      { short_id: result.short_id ?? state.short_id },
      { reply_markup: backToMenuKeyboard() });
    await notifyAdminsManualDelivery(getBot(), state.order_id);
    return;
  }

  await tReply(ctx, "payment_failed",
    "❌ Payment verification failed for order {short_id}.\n\nReason: {reason}\n\nDouble-check the reference and try again, or contact support.",
    { short_id: state.short_id, reason: result.reason ?? "unknown error" },
    { reply_markup: awaitingReferenceKeyboard(state.order_id) });
}

async function downloadReceiptFile(ctx: BotCtx): Promise<{ ok: true; file: Blob; hash: string } | { ok: false; reason: string }> {
  const photo = ctx.message?.photo?.length ? ctx.message.photo[ctx.message.photo.length - 1] : null;
  const document = ctx.message?.document ?? null;
  const fileId = photo?.file_id ?? document?.file_id;
  if (!fileId) return { ok: false, reason: "no_file" };
  if (document) {
    const name = document.file_name ?? "";
    const mime = document.mime_type ?? "";
    if (!mime.startsWith("image/") && !/\.(png|jpe?g|webp)$/i.test(name)) {
      return { ok: false, reason: "unsupported_file_type" };
    }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, reason: "bot_token_missing" };
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) return { ok: false, reason: "telegram_file_path_missing" };

  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!res.ok) return { ok: false, reason: `telegram_download_${res.status}` };
  const bytes = await res.arrayBuffer();
  const hash = await sha256Hex(bytes);
  return { ok: true, file: new Blob([bytes], { type: document?.mime_type || "image/jpeg" }), hash };
}

async function verifyReceipt(file: Blob): Promise<VerifyResult> {
  const cbeAccounts = await loadAccounts("cbe");
  const cbeSuffix = (cbeAccounts[0]?.account || "").replace(/\D+/g, "").slice(-8) || undefined;
  return verifyReceiptImage(file, cbeSuffix);
}

function depositProvider(v: VerifyResult, reference: string): PayoutProvider {
  const provider = String(v.provider ?? "").toLowerCase();
  if (provider.includes("cbebirr")) return "cbebirr";
  if (provider.includes("mpesa")) return "mpesa";
  if (provider.includes("dashen")) return "dashen";
  if (provider.includes("abyssinia") || provider.includes("boa")) return "abyssinia";
  if (provider.includes("cbe")) return "cbe";
  if (provider.includes("telebirr")) return "telebirr";
  return /^FT/i.test(reference) ? "cbe" : "telebirr";
}

async function handleWalletDepositVerification(
  ctx: BotCtx,
  state: Record<string, any>,
  submittedReference: string | undefined,
  verifier: () => Promise<VerifyResult>,
) {
  const amount = Number(state.amount_cents);
  try {
    if (submittedReference) {
      const { data: dup } = await supabaseAdmin.from("payments").select("id").eq("reference", submittedReference).maybeSingle();
      if (dup) {
        await recordAbuse(ctx.from!.id, "duplicate_reference", 3, { reference: submittedReference, context: "deposit" });
        await tReply(ctx, "wallet_deposit_error_duplicate_reference",
          "❌ This reference was already used.", { reference: submittedReference });
        return;
      }
    }

    let v = await verifier();
    const reference = (v.reference ?? submittedReference ?? "").trim();
    if (!v.ok || !reference) {
      await recordAbuse(ctx.from!.id, "verify_failed", 2, { reference, error: v.error });
      await tReply(ctx, "wallet_deposit_error_verify_failed",
        "❌ Could not verify this payment. Reason: {reason}",
        { reference, reason: v.error ?? "unknown error" });
      return;
    }
    if (reference !== submittedReference) {
      const { data: dup } = await supabaseAdmin.from("payments").select("id").eq("reference", reference).maybeSingle();
      if (dup) {
        await recordAbuse(ctx.from!.id, "duplicate_reference", 3, { reference, context: "deposit" });
        await tReply(ctx, "wallet_deposit_error_duplicate_reference",
          "❌ This reference was already used.", { reference });
        return;
      }
    }

    // Receipt images are only used to extract the reference. Always re-check
    // that reference directly so the amount/receiver comes from bank data, not OCR.
    if (!submittedReference || v.amount_cents === undefined || (!v.receiver && !v.receiverName)) {
      const refVerification = await verifyReferenceAnyBank(reference);
      if (!refVerification.ok) {
        await recordAbuse(ctx.from!.id, "verify_failed", 2, { reference, error: refVerification.error, context: "deposit_reference_fallback" });
        await tReply(ctx, "wallet_deposit_error_verify_failed",
          "❌ Could not verify this payment. Reason: {reason}",
          { reference, reason: refVerification.error ?? "unknown error" });
        return;
      }
      v = { ...refVerification, raw: { receipt: v.raw, reference: refVerification.raw } };
    }

    if (v.amount_cents === undefined || v.amount_cents !== amount) {
      await recordAbuse(ctx.from!.id, "amount_mismatch", 4, { expected: amount, got: v.amount_cents });
      await tReply(ctx, "wallet_deposit_error_amount_mismatch",
        "❌ Amount mismatch. Expected {expected} ETB, verified reference shows {received} ETB.",
        {
          reference,
          expected: (amount / 100).toFixed(2),
          received: v.amount_cents === undefined ? "unknown" : (v.amount_cents / 100).toFixed(2),
        });
      return;
    }
    const detectedProvider = depositProvider(v, reference);
    const rc = await verifyAnyReceiver(detectedProvider, v.receiver, v.receiverName);
    if (!rc.ok) {
      await recordAbuse(ctx.from!.id, "receiver_mismatch", 5, { reference, receiver: v.receiver });
      await tReply(ctx, "wallet_deposit_error_receiver_mismatch", "❌ {reason}",
        { reference, reason: rc.reason ?? "Receipt recipient does not match our accounts." });
      return;
    }
    // DB enum supports only telebirr/cbe — map any other bank in.
    const storedProvider: "telebirr" | "cbe" =
      (detectedProvider === "cbe" || detectedProvider === "cbebirr") ? "cbe" : "telebirr";
    const newBal = await depositFromVerified({
      userId: ctx.from!.id,
      reference,
      provider: storedProvider,
      amountCents: v.amount_cents,
      raw: { detected_provider: detectedProvider, matched_provider: rc.matchedProvider, ...(v.raw as any) },
    });
    await setUserState(ctx.from!.id, null);
    await tReply(ctx, "wallet_deposit_success",
      "✅ Deposited *{amount} ETB*. New balance: *{balance} ETB*.",
      { reference, amount: formatPrice(v.amount_cents), balance: formatPrice(newBal) },
      { reply_markup: walletHomeKeyboard() });
  } catch (e: any) {
    await tReply(ctx, "wallet_deposit_error_failed", "❌ Failed: {reason}",
      { reason: e?.message ?? e });
  }
}

async function askDepositMethod(ctx: BotCtx, amount: number) {
  const tbLabel = await getMessageTemplate("btn_telebirr", "📱 Telebirr");
  const cbeLabel = await getMessageTemplate("btn_cbe", "🏦 CBE");
  const backLabel = await getMessageTemplate("btn_back", "⬅️ Back");
  const kb = new InlineKeyboard()
    .text(tbLabel, `wallet:depMethod:${amount}:telebirr`)
    .text(cbeLabel, `wallet:depMethod:${amount}:cbe`).row()
    .text(backLabel, "wallet:deposit");
  const body = await renderMessage("wallet_deposit_method_prompt",
    "Deposit *{amount} ETB* — pick payment method:", { amount });
  try {
    await ctx.editMessageText(body, { parse_mode: "Markdown", reply_markup: kb });
  } catch {
    await ctx.reply(body, { parse_mode: "Markdown", reply_markup: kb });
  }
}

async function createOrderAndAskMethod(ctx: BotCtx, productId: string, qty: number) {
  const { data: p } = await supabaseAdmin
    .from("products").select("id, name, price_cents, is_enabled, delivery_mode")
    .eq("id", productId).maybeSingle();
  if (!p || !p.is_enabled) {
    await tReply(ctx, "product_unavailable_inline", "Product unavailable.");
    return;
  }

  if (p.delivery_mode === "automatic") {
    const { count } = await supabaseAdmin
      .from("product_codes").select("id", { count: "exact", head: true })
      .eq("product_id", p.id).eq("is_used", false);
    if ((count ?? 0) < qty) {
      await tReply(ctx, "order_not_enough_stock", "Not enough stock. Available: {available}", { available: count ?? 0 });
      return;
    }
  }

  const total = p.price_cents * qty;
  const { data: order, error } = await supabaseAdmin.from("orders").insert({
    user_telegram_id: ctx.from!.id, product_id: p.id, quantity: qty,
    unit_price_cents: p.price_cents, total_cents: total,
  }).select("id, short_id").single();
  if (error || !order) {
    await tReply(ctx, "order_create_failed", "Could not create order.");
    return;
  }

  await stampOrderReferrer(order.id, ctx.from!.id);

  const balance = await getBalance(ctx.from!.id);
  await tReply(ctx, "order_created",
    "🧾 *Order {short_id}*\n\n{name} × {qty} = *{total} ETB*\n\nChoose payment method:",
    { short_id: order.short_id, name: p.name, qty, total: formatPrice(total) },
    { reply_markup: await paymentMethodKeyboard(order.id, balance, total) });
}

function methodLabel(m: "telebirr" | "cbe") {
  return m === "telebirr" ? "📱 Telebirr" : "🏦 CBE";
}

async function buildInstructions(
  method: "telebirr" | "cbe",
  vars: { total: string; short_id: string; quantity: number | string; product_name?: string },
): Promise<string> {
  const accounts = await loadAccounts(method);
  const acct = accounts[0] ?? {};
  const number = (method === "telebirr" ? acct.msisdn : acct.account) ?? "—";
  const name = acct.name ?? "—";

  const key = method === "telebirr" ? "payment_instruction_telebirr" : "payment_instruction_cbe";
  const defaultBody =
    `💳 *Payment — ${methodLabel(method)}*\n\n` +
    `Order: *{short_id}*\n` +
    (vars.product_name ? `Item: *{product_name}* × {quantity}\n` : "") +
    `Amount: *{total} ETB*\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `*Send exactly {total} ETB to:*\n` +
    (method === "telebirr"
      ? `📱 Telebirr number:\n\`{account}\`\n👤 Account name: *{account_name}*\n`
      : `🏦 CBE account:\n\`{account}\`\n👤 Account name: *{account_name}*\n`) +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `📋 *Steps:*\n` +
    (method === "telebirr"
      ? `1️⃣ Open Telebirr → *Send Money*\n` +
        `2️⃣ Send *{total} ETB* to the number above\n` +
        `3️⃣ Copy the *transaction reference* from the confirmation SMS\n` +
        `4️⃣ Paste it here, or upload a clear receipt screenshot/photo\n\n` +
        `_Example reference: AB12CD34EF_`
      : `1️⃣ Transfer *{total} ETB* to the CBE account above\n` +
        `2️⃣ Copy the *transaction reference* (FT…) from the SMS / receipt\n` +
        `3️⃣ Paste it here, or upload a clear receipt screenshot/photo\n\n` +
        `_Example reference: FT12ABC3456_`) +
    `\n\n⚠️ *Important:*\n` +
    `• Send the *exact* amount — partial payments are rejected\n` +
    `• You may also pay from any other Ethiopian bank Leul Verify supports — paste the reference or upload the receipt\n` +
    `• Each reference can be used *once*\n` +
    `• Verification is automatic & usually instant`;

  return renderMessage(key, defaultBody, {
    ...vars,
    account: number,
    account_name: name,
    method: methodLabel(method),
  });
}

async function showPaymentInstructions(ctx: BotCtx, orderId: string, method: "telebirr" | "cbe") {
  const { data: o } = await supabaseAdmin
    .from("orders").select("short_id, quantity, total_cents, products(name)")
    .eq("id", orderId).maybeSingle() as any;
  if (!o) return;
  const text = await buildInstructions(method, {
    short_id: o.short_id, product_name: o.products?.name,
    quantity: o.quantity, total: formatPrice(o.total_cents),
  });
  await setUserState(ctx.from!.id, { awaiting: "payment_reference", order_id: orderId, short_id: o.short_id });
  try {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: awaitingReferenceKeyboard(orderId) });
  } catch {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: awaitingReferenceKeyboard(orderId) });
  }
}
