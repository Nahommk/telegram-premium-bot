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

export async function quantityKeyboard(productId: string, presets: number[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  presets.forEach((q, i) => {
    kb.text(`x${q}`, `shop:q:${productId}:${q}`);
    if ((i + 1) % 4 === 0) kb.row();
  });
  const customQtyBtn = await btnTpl("btn_custom_qty", "Custom qty", "✏️");
  const backBtn = await btnTpl("btn_back", "Back", "⬅️");
  
  return {
  inline_keyboard: [
    ...((kb as any).inline_keyboard ?? []),
    [
      { ...customQtyBtn, callback_data: `shop:qcustom:${productId}` },
    ],
    [
      { ...backBtn, callback_data: "shop:list:0" },
    ],
  ],
};
}

export async function paymentMethodKeyboard(orderId: string, walletBalanceCents = 0, orderTotalCents = 0) {
  const telebirr = await btnTpl("btn_telebirr", "Telebirr", "📱");
  const cbe = await btnTpl("btn_cbe", "CBE", "🏦");
  const cancel = await btnTpl("btn_cancel", "Cancel", "❌");
  const wallet = await btnTpl("btn_wallet", "Pay from Wallet", "💼");

  const rows: any[] = [
    [
      { ...telebirr, callback_data: `pay:method:${orderId}:telebirr` },
      { ...cbe, callback_data: `pay:method:${orderId}:cbe` },
    ],
  ];

  if (walletBalanceCents >= orderTotalCents && orderTotalCents > 0) {
    rows.push([
      {
        ...wallet,
        text: `${wallet.text} (${(walletBalanceCents / 100).toFixed(2)} ETB)`,
        callback_data: `pay:wallet:${orderId}`,
      },
    ]);
  }

  rows.push([
    { ...cancel, callback_data: `order:cancel:${orderId}` },
  ]);
console.log("PAYMENT KB DEBUG:", JSON.stringify(rows, null, 2));
  return { inline_keyboard: rows };
}

export async function awaitingReferenceKeyboard(orderId: string) {
  const instructions = await btnTpl("btn_instructions", "Instructions again", "📋");
  const cancel = await btnTpl("btn_cancel", "Cancel order", "❌");

  return {
    inline_keyboard: [
      [{ ...instructions, callback_data: `pay:show:${orderId}` }],
      [{ ...cancel, callback_data: `order:cancel:${orderId}` }],
    ],
  };
}

export async function walletHomeKeyboard() {
  const deposit = await btnTpl("btn_deposit", "Deposit", "➕");
  const history = await btnTpl("btn_history", "History", "📜");
  const menu = await btnTpl("btn_back", "Main menu", "⬅️");

  return {
    inline_keyboard: [
      [
        { ...deposit, callback_data: "wallet:deposit" },
        { ...history, callback_data: "wallet:history" },
      ],
      [
        { ...menu, callback_data: "menu" },
      ],
    ],
  };
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
