import { InlineKeyboard } from "grammy";
export { dynamicMainMenu } from "@/services/buttons";

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

export function backToMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("⬅️ Main menu", "menu");
}

export function productListKeyboard(
  products: { id: string; name: string; icon: string; price_cents: number; in_stock?: boolean }[],
  page: number, pageSize: number, total: number,
) {
  const rows: Array<Array<{ text: string; callback_data: string; style?: "success" | "danger" | "primary" }>> = [];
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
  rows.push([{ text: "⬅️ Main menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

export function quantityKeyboard(productId: string, presets: number[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  presets.forEach((q, i) => {
    kb.text(`x${q}`, `shop:q:${productId}:${q}`);
    if ((i + 1) % 4 === 0) kb.row();
  });
  kb.row().text("✏️ Custom qty", `shop:qcustom:${productId}`);
  kb.row().text("⬅️ Back", "shop:list:0");
  return kb;
}

export function paymentMethodKeyboard(orderId: string, walletBalanceCents = 0, orderTotalCents = 0): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("📱 Telebirr", `pay:method:${orderId}:telebirr`)
    .text("🏦 CBE", `pay:method:${orderId}:cbe`).row();
  if (walletBalanceCents >= orderTotalCents && orderTotalCents > 0) {
    kb.text(`💼 Pay from Wallet (${(walletBalanceCents / 100).toFixed(2)} ETB)`, `pay:wallet:${orderId}`).row();
  }
  kb.text("❌ Cancel", `order:cancel:${orderId}`);
  return kb;
}

export function awaitingReferenceKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 Instructions again", `pay:show:${orderId}`).row()
    .text("❌ Cancel order", `order:cancel:${orderId}`);
}

export function walletHomeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Deposit", "wallet:deposit").text("📜 History", "wallet:history").row()
    .text("⬅️ Main menu", "menu");
}

export function depositAmountKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  [50, 100, 200, 500, 1000].forEach((a, i) => {
    kb.text(`${a} ETB`, `wallet:depAmt:${a}`);
    if ((i + 1) % 3 === 0) kb.row();
  });
  kb.row().text("✏️ Custom", "wallet:depCustom");
  kb.row().text("⬅️ Wallet", "wallet:home");
  return kb;
}

export function referralKeyboard(canPayout: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (canPayout) kb.text("💼 Move earnings to wallet", "ref:payout").row();
  kb.text("⬅️ Main menu", "menu");
  return kb;
}

// Admin
export function adminMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📦 Products", "adm:p:list:0").text("🎟 Stock", "adm:s:menu").row()
    .text("🧾 Orders", "adm:o:list:pending:0").text("⏳ Manual", "adm:o:list:paid_waiting_delivery:0").row()
    .text("👥 Users", "adm:u:menu").text("💼 Wallet", "adm:w:menu").row()
    .text("📣 Broadcast", "adm:b:new").text("🔘 Buttons", "adm:btn:list").row()
    .text("📝 Templates", "adm:t:list").text("📊 Stats", "adm:stats").row()
    .text("🛡 Admins", "adm:adm:list").row()
    .text("⬅️ Main menu", "menu");
}
