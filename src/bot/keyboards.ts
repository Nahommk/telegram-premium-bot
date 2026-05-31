import { loadButtons } from "@/services/buttons";
import { InlineKeyboard } from "grammy";
import { stripEmojiTags } from "@/bot/messaging";

export { dynamicMainMenu } from "@/services/buttons";

export async function btnTpl(key: string, fallbackLabel: string, fallbackEmoji = "") {
  const buttons = await loadButtons(true);
  const b = buttons.find((x) => x.key === key);

  const label = b?.label ?? fallbackLabel;
  const emoji = b?.emoji ?? fallbackEmoji;

  return {
    text: b?.icon_custom_emoji_id ? stripEmojiTags(label) : `${stripEmojiTags(emoji)} ${stripEmojiTags(label)}`.trim(),
    ...(b?.icon_custom_emoji_id
      ? { icon_custom_emoji_id: b.icon_custom_emoji_id }
      : {}),
  };
}

// Kept as a synchronous fallback used by the generic "menu" callback in bot.ts.
// Real menu rendering should go through dynamicMainMenu().
export function mainMenuKeyboard(showAdmin: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("🛒 Shop", "shop:list:0").text("📦 My Orders", "orders:mine:0").row()
    .text("⏳ Pending", "orders:pending").text("💼 Wallet", "wallet:home").row()
    .text("🎁 Referrals", "ref:home").text("👤 Profile", "profile").row()
    .text("💬 Support", "support");
  if (showAdmin) kb.row().text("🛠 Admin", "admin:menu");
  return kb;
}

export async function backToMenuKeyboard(): Promise<InlineKeyboard> {
  const kb = new InlineKeyboard();
  const menuBtn = await btnTpl("btn_back", "Main menu", "⬅️");
  kb.text(menuBtn.text, "menu");
  if (menuBtn.icon_custom_emoji_id) kb.icon(menuBtn.icon_custom_emoji_id);
  return kb;
}

export async function productListKeyboard(
  products: { id: string; name: string; icon: string; price_cents: number; in_stock?: boolean }[],
  page: number, pageSize: number, total: number,
) {
  const rows: Array<Array<{ text: string; callback_data: string; style?: "success" | "danger" | "primary", icon_custom_emoji_id?: string }>> = [];
  for (const p of products) {
    rows.push([{
      text: `${p.icon} ${p.name} — ${(p.price_cents / 100).toFixed(2)} ETB`,
      callback_data: `shop:p:${p.id}`,
      style: p.in_stock === false ? "danger" : "success",
    }]);
  }
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const nav: Array<{ text: string; callback_data: string; style?: "primary" }> = [];
  if (page > 0) nav.push({ text: "◀️", callback_data: `shop:list:${page - 1}`, style: "primary" });
  if (page < maxPage) nav.push({ text: "▶️", callback_data: `shop:list:${page + 1}`, style: "primary" });
  if (nav.length) rows.push(nav);
  
  const menuBtn = await btnTpl("btn_back", "Main menu", "⬅️");
  rows.push([{ 
    text: menuBtn.text, 
    callback_data: "menu",
    ...(menuBtn.icon_custom_emoji_id ? { icon_custom_emoji_id: menuBtn.icon_custom_emoji_id } : {})
  }]);
  
  return { inline_keyboard: rows };
}

export async function quantityKeyboard(productId: string, presets: number[]): Promise<InlineKeyboard> {
  const kb = new InlineKeyboard();
  presets.forEach((q, i) => {
    kb.text(`x${q}`, `shop:q:${productId}:${q}`);
    if ((i + 1) % 4 === 0) kb.row();
  });
  
  const customQtyBtn = await btnTpl("btn_custom_qty", "Custom qty", "✏️");
  const backBtn = await btnTpl("btn_back", "Back", "⬅️");
  
  kb.row();
  kb.text(customQtyBtn.text, `shop:qcustom:${productId}`);
  if (customQtyBtn.icon_custom_emoji_id) kb.icon(customQtyBtn.icon_custom_emoji_id);
  
  kb.row();
  kb.text(backBtn.text, `shop:list:0`);
  if (backBtn.icon_custom_emoji_id) kb.icon(backBtn.icon_custom_emoji_id);
  
  return kb;
}

export async function paymentMethodKeyboard(orderId: string, walletBalanceCents = 0, orderTotalCents = 0): Promise<InlineKeyboard> {
  const kb = new InlineKeyboard();
  
  const telebirr = await btnTpl("btn_telebirr", "Telebirr", "📱");
  const cbe = await btnTpl("btn_cbe", "CBE", "🏦");
  
  kb.text(telebirr.text, `pay:method:${orderId}:telebirr`);
  if (telebirr.icon_custom_emoji_id) kb.icon(telebirr.icon_custom_emoji_id);
  
  kb.text(cbe.text, `pay:method:${orderId}:cbe`);
  if (cbe.icon_custom_emoji_id) kb.icon(cbe.icon_custom_emoji_id);
  
  kb.row();
  
  if (walletBalanceCents >= orderTotalCents && orderTotalCents > 0) {
    const wallet = await btnTpl("btn_wallet", "Pay from Wallet", "💼");
    kb.text(`${wallet.text} (${(walletBalanceCents / 100).toFixed(2)} ETB)`, `pay:wallet:${orderId}`);
    if (wallet.icon_custom_emoji_id) kb.icon(wallet.icon_custom_emoji_id);
    kb.row();
  }

  const cancel = await btnTpl("btn_cancel", "Cancel", "❌");
  kb.text(cancel.text, `order:cancel:${orderId}`);
  if (cancel.icon_custom_emoji_id) kb.icon(cancel.icon_custom_emoji_id);
  
  return kb;
}

export async function awaitingReferenceKeyboard(orderId: string): Promise<InlineKeyboard> {
  const kb = new InlineKeyboard();
  
  const instructions = await btnTpl("btn_instructions", "Instructions again", "📋");
  kb.text(instructions.text, `pay:show:${orderId}`);
  if (instructions.icon_custom_emoji_id) kb.icon(instructions.icon_custom_emoji_id);
  
  kb.row();
  
  const cancel = await btnTpl("btn_cancel", "Cancel order", "❌");
  kb.text(cancel.text, `order:cancel:${orderId}`);
  if (cancel.icon_custom_emoji_id) kb.icon(cancel.icon_custom_emoji_id);

  return kb;
}

export async function walletHomeKeyboard(): Promise<InlineKeyboard> {
  const kb = new InlineKeyboard();
  
  const deposit = await btnTpl("btn_deposit", "Deposit", "➕");
  kb.text(deposit.text, "wallet:deposit");
  if (deposit.icon_custom_emoji_id) kb.icon(deposit.icon_custom_emoji_id);
  
  const history = await btnTpl("btn_history", "History", "📜");
  kb.text(history.text, "wallet:history");
  if (history.icon_custom_emoji_id) kb.icon(history.icon_custom_emoji_id);
  
  kb.row();
  
  const menu = await btnTpl("btn_back", "Main menu", "⬅️");
  kb.text(menu.text, "menu");
  if (menu.icon_custom_emoji_id) kb.icon(menu.icon_custom_emoji_id);

  return kb;
}

export async function depositAmountKeyboard(): Promise<InlineKeyboard> {
  const kb = new InlineKeyboard();
  [50, 100, 200, 500, 1000].forEach((a, i) => {
    kb.text(`${a} ETB`, `wallet:depAmt:${a}`);
    if ((i + 1) % 3 === 0) kb.row();
  });
  
  const customAmountBtn = await btnTpl("btn_custom_amount", "Custom", "✏️");
  const walletHomeBtn = await btnTpl("btn_wallet_home", "Wallet", "⬅️");
  
  kb.row();
  kb.text(customAmountBtn.text, "wallet:depCustom");
  if (customAmountBtn.icon_custom_emoji_id) kb.icon(customAmountBtn.icon_custom_emoji_id);
  
  kb.row();
  kb.text(walletHomeBtn.text, "wallet:home");
  if (walletHomeBtn.icon_custom_emoji_id) kb.icon(walletHomeBtn.icon_custom_emoji_id);
  
  return kb;
}

export async function referralKeyboard(canPayout: boolean): Promise<InlineKeyboard> {
  const kb = new InlineKeyboard();
  if (canPayout) kb.text("💼 Move earnings to wallet", "ref:payout").row();
  
  const menuBtn = await btnTpl("btn_back", "Main menu", "⬅️");
  kb.text(menuBtn.text, "menu");
  if (menuBtn.icon_custom_emoji_id) kb.icon(menuBtn.icon_custom_emoji_id);
  
  return kb;
}

// Admin
export async function adminMenuKeyboard(): Promise<InlineKeyboard> {
  const kb = new InlineKeyboard()
    .text("📦 Products", "adm:p:list:0").text("🎟 Stock", "adm:s:menu").row()
    .text("🧾 Orders", "adm:o:list:pending:0").text("⏳ Manual", "adm:o:list:paid_waiting_delivery:0").row()
    .text("👥 Users", "adm:u:menu").text("💼 Wallet", "adm:w:menu").row()
    .text("📣 Broadcast", "adm:b:new").text("🔘 Buttons", "adm:btn:list").row()
    .text("📝 Templates", "adm:t:list").text("📊 Stats", "adm:stats").row()
    .text("🛡 Admins", "adm:adm:list").row();
    
  const menuBtn = await btnTpl("btn_back", "Main menu", "⬅️");
  kb.text(menuBtn.text, "menu");
  if (menuBtn.icon_custom_emoji_id) kb.icon(menuBtn.icon_custom_emoji_id);
  
  return kb;
}
