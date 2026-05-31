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
    text: b?.icon_custom_emoji_id
      ? stripEmojiTags(label)
      : `${stripEmojiTags(emoji)} ${stripEmojiTags(label)}`.trim(),
    ...(b?.icon_custom_emoji_id ? { icon_custom_emoji_id: b.icon_custom_emoji_id } : {}),
  };
}

export function mainMenuKeyboard(showAdmin: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("🛒 Shop", "shop:list:0").text("📦 My Orders", "orders:mine:0").row()
    .text("⏳ Pending", "orders:pending").text("💼 Wallet", "wallet:home").row()
    .text("🎁 Referrals", "ref:home").text("👤 Profile", "profile").row()
    .text("💬 Support", "support");

  if (showAdmin) kb.row().text("🛠 Admin", "admin:menu");
  return kb;
}

type PremiumButton = {
  text: string;
  callback_data: string;
  style?: "primary" | "success" | "danger";
  icon_custom_emoji_id?: string;
};

type PremiumKeyboard = {
  inline_keyboard: PremiumButton[][];
};

function withCallback(
  btn: Awaited<ReturnType<typeof btnTpl>>,
  callback_data: string,
  style?: PremiumButton["style"],
): PremiumButton {
  return {
    text: btn.text,
    callback_data,
    ...(style ? { style } : {}),
    ...(btn.icon_custom_emoji_id ? { icon_custom_emoji_id: btn.icon_custom_emoji_id } : {}),
  };
}

export async function backToMenuKeyboard(): Promise<PremiumKeyboard> {
  const menuBtn = await btnTpl("btn_back", "Main menu", "⬅️");
  return {
    inline_keyboard: [[withCallback(menuBtn, "menu")]],
  };
}

export async function productListKeyboard(
  products: { id: string; name: string; icon: string; price_cents: number; in_stock?: boolean }[],
  page: number,
  pageSize: number,
  total: number,
): Promise<PremiumKeyboard> {
  const rows: PremiumButton[][] = [];

  for (const p of products) {
    rows.push([
      {
        text: `${p.icon} ${p.name} — ${(p.price_cents / 100).toFixed(2)} ETB`,
        callback_data: `shop:p:${p.id}`,
        style: p.in_stock === false ? "danger" : "success",
      },
    ]);
  }

  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const nav: PremiumButton[] = [];

  if (page > 0) {
    nav.push({ text: "◀️", callback_data: `shop:list:${page - 1}`, style: "primary" });
  }

  if (page < maxPage) {
    nav.push({ text: "▶️", callback_data: `shop:list:${page + 1}`, style: "primary" });
  }

  if (nav.length) rows.push(nav);

  const menuBtn = await btnTpl("btn_back", "Main menu", "⬅️");
  rows.push([withCallback(menuBtn, "menu")]);

  return { inline_keyboard: rows };
}

export async function quantityKeyboard(productId: string, presets: number[]): Promise<PremiumKeyboard> {
  const rows: PremiumButton[][] = [];
  let row: PremiumButton[] = [];

  presets.forEach((q) => {
    row.push({
      text: `x${q}`,
      callback_data: `shop:q:${productId}:${q}`,
    });

    if (row.length === 4) {
      rows.push(row);
      row = [];
    }
  });

  if (row.length) rows.push(row);

  const customQtyBtn = await btnTpl("btn_custom_qty", "Custom qty", "✏️");
  const backBtn = await btnTpl("btn_back", "Back", "⬅️");

  rows.push([withCallback(customQtyBtn, `shop:qcustom:${productId}`)]);
  rows.push([withCallback(backBtn, "shop:list:0")]);

  return { inline_keyboard: rows };
}

export async function paymentMethodKeyboard(
  orderId: string,
  walletBalanceCents = 0,
  orderTotalCents = 0,
): Promise<PremiumKeyboard> {
  const telebirr = await btnTpl("btn_telebirr", "Telebirr", "📱");
  const cbe = await btnTpl("btn_cbe", "CBE", "🏦");

  const rows: PremiumButton[][] = [
    [
      withCallback(telebirr, `pay:method:${orderId}:telebirr`),
      withCallback(cbe, `pay:method:${orderId}:cbe`),
    ],
  ];

  if (walletBalanceCents >= orderTotalCents && orderTotalCents > 0) {
    const wallet = await btnTpl("btn_wallet", "Pay from Wallet", "💼");

    rows.push([
      {
        ...withCallback(wallet, `pay:wallet:${orderId}`),
        text: `${wallet.text} (${(walletBalanceCents / 100).toFixed(2)} ETB)`,
      },
    ]);
  }

  const cancel = await btnTpl("btn_cancel", "Cancel", "❌");
  rows.push([withCallback(cancel, `order:cancel:${orderId}`)]);

  return { inline_keyboard: rows };
}

export async function awaitingReferenceKeyboard(orderId: string): Promise<PremiumKeyboard> {
  const instructions = await btnTpl("btn_instructions", "Instructions again", "📋");
  const cancel = await btnTpl("btn_cancel", "Cancel order", "❌");

  return {
    inline_keyboard: [
      [withCallback(instructions, `pay:show:${orderId}`)],
      [withCallback(cancel, `order:cancel:${orderId}`)],
    ],
  };
}

export async function walletHomeKeyboard(): Promise<PremiumKeyboard> {
  const deposit = await btnTpl("btn_deposit", "Deposit", "➕");
  const history = await btnTpl("btn_history", "History", "📜");
  const menu = await btnTpl("btn_back", "Main menu", "⬅️");

  return {
    inline_keyboard: [
      [withCallback(deposit, "wallet:deposit"), withCallback(history, "wallet:history")],
      [withCallback(menu, "menu")],
    ],
  };
}

export async function depositAmountKeyboard(): Promise<PremiumKeyboard> {
  const rows: PremiumButton[][] = [];
  let row: PremiumButton[] = [];

  [50, 100, 200, 500, 1000].forEach((amount) => {
    row.push({
      text: `${amount} ETB`,
      callback_data: `wallet:depAmt:${amount}`,
    });

    if (row.length === 3) {
      rows.push(row);
      row = [];
    }
  });

  if (row.length) rows.push(row);

  const customAmountBtn = await btnTpl("btn_custom_amount", "Custom", "✏️");
  const walletHomeBtn = await btnTpl("btn_wallet_home", "Wallet", "⬅️");

  rows.push([withCallback(customAmountBtn, "wallet:depCustom")]);
  rows.push([withCallback(walletHomeBtn, "wallet:home")]);

  return { inline_keyboard: rows };
}

export async function referralKeyboard(canPayout: boolean): Promise<PremiumKeyboard> {
  const rows: PremiumButton[][] = [];

  if (canPayout) {
    rows.push([{ text: "💼 Move earnings to wallet", callback_data: "ref:payout" }]);
  }

  const menuBtn = await btnTpl("btn_back", "Main menu", "⬅️");
  rows.push([withCallback(menuBtn, "menu")]);

  return { inline_keyboard: rows };
}

export async function adminMenuKeyboard(): Promise<PremiumKeyboard> {
  const menuBtn = await btnTpl("btn_back", "Main menu", "⬅️");

  return {
    inline_keyboard: [
      [
        { text: "📦 Products", callback_data: "adm:p:list:0" },
        { text: "🎟 Stock", callback_data: "adm:s:menu" },
      ],
      [
        { text: "🧾 Orders", callback_data: "adm:o:list:pending:0" },
        { text: "⏳ Manual", callback_data: "adm:o:list:paid_waiting_delivery:0" },
      ],
      [
        { text: "👥 Users", callback_data: "adm:u:menu" },
        { text: "💼 Wallet", callback_data: "adm:w:menu" },
      ],
      [
        { text: "📣 Broadcast", callback_data: "adm:b:new" },
        { text: "🔘 Buttons", callback_data: "adm:btn:list" },
      ],
      [
        { text: "📝 Templates", callback_data: "adm:t:list" },
        { text: "📊 Stats", callback_data: "adm:stats" },
      ],
      [{ text: "🛡 Admins", callback_data: "adm:adm:list" }],
      [withCallback(menuBtn, "menu")],
    ],
  };
}