import { loadButtons, dynamicMainMenu } from "@/services/buttons";
import { stripEmojiTags } from "@/bot/messaging";

export { dynamicMainMenu };

type BtnStyle = "primary" | "success" | "danger";

type PremiumButton = {
  text: string;
  callback_data ? : string;
  url ? : string;
  style ? : BtnStyle;
  icon_custom_emoji_id ? : string;
};

type PremiumKeyboard = {
  inline_keyboard: PremiumButton[][];
};

function fallbackText(label: string, emoji = "") {
  const cleanLabel = stripEmojiTags(label);
  const cleanEmoji = stripEmojiTags(emoji);
  return cleanEmoji ? `${cleanEmoji} ${cleanLabel}` : cleanLabel;
}

export async function premiumBtn(
  key: string,
  fallbackLabel: string,
  fallbackEmoji: string,
  callback_data: string,
  style?: BtnStyle,
): Promise<PremiumButton> {
  const buttons = await loadButtons(false);
  const b = buttons.find((x) => x.key === key);

  const label = b?.label ?? fallbackLabel;
  const emoji = b?.emoji ?? fallbackEmoji;
  const iconId = b?.icon_custom_emoji_id ? String(b.icon_custom_emoji_id) : undefined;

  return {
    text: iconId ? stripEmojiTags(label) : fallbackText(label, emoji),
    callback_data,
    ...(style ? { style } : {}),
    ...(iconId ? { icon_custom_emoji_id: iconId } : {}),
  };
}

export async function backToMenuKeyboard(): Promise<PremiumKeyboard> {
  return {
    inline_keyboard: [
      [await premiumBtn("btn_back", "Main menu", "⬅️", "menu", "primary")],
    ],
  };
}

export async function productListKeyboard(
    products: {
      id: string;
      name: string;
      icon: string;
      price_cents: number;
      delivery_mode ? : "automatic" | "manual";
      stock_left ? : number | null;
      in_stock ? : boolean;
    } [],
    page: number,
    pageSize: number,
    total: number,
  ): Promise < PremiumKeyboard > {
  const rows: PremiumButton[][] = [];

  for (const p of products) {
  const hasPremiumIcon = /^\d{8,}$/.test(String(p.icon || ""));
  const price = `${(p.price_cents / 100).toFixed(2)} ETB`;

  const stockBadge =
    p.delivery_mode === "manual"
      ? "👤 Manual"
      : `⚡ ${p.stock_left ?? 0} left`;

  const textWithoutIcon = `${p.name} — ${price} — ${stockBadge}`;

  rows.push([
    {
      text: hasPremiumIcon
        ? textWithoutIcon
        : `${stripEmojiTags(String(p.icon || ""))} ${textWithoutIcon}`.trim(),
      callback_data: `shop:p:${p.id}`,
      style: p.in_stock === false ? "danger" : "success",
      ...(hasPremiumIcon ? { icon_custom_emoji_id: String(p.icon) } : {}),
    },
  ]);
}

  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const nav: PremiumButton[] = [];

  if (page > 0) {
  nav.push(
    await premiumBtn(
      "btn_prev",
      "Previous",
      "◀️",
      `shop:list:${page - 1}`,
      "primary"
    )
  );
}

if (page < maxPage) {
  nav.push(
    await premiumBtn(
      "btn_next",
      "Next",
      "▶️",
      `shop:list:${page + 1}`,
      "primary"
    )
  );
}

  if (nav.length) rows.push(nav);

rows.push([
  await premiumBtn(
    "btn_refresh",
    "Refresh",
    "🔄",
    `shop:list:${page}`,
    "primary"
  ),
]);

rows.push([
  await premiumBtn("btn_back", "Main menu", "⬅️", "menu", "primary"),
]);

return { inline_keyboard: rows };

export async function quantityKeyboard(productId: string, presets: number[]): Promise<PremiumKeyboard> {
  const rows: PremiumButton[][] = [];
  let row: PremiumButton[] = [];

  for (const q of presets) {
    row.push({
      text: `x${q}`,
      callback_data: `shop:q:${productId}:${q}`,
      style: "primary",
    });

    if (row.length === 4) {
      rows.push(row);
      row = [];
    }
  }

  if (row.length) rows.push(row);

  rows.push([
    await premiumBtn("btn_custom_qty", "Custom qty", "✏️", `shop:qcustom:${productId}`, "primary"),
  ]);

  rows.push([
    await premiumBtn("btn_back", "Back", "⬅️", "shop:list:0", "primary"),
  ]);

  return { inline_keyboard: rows };
}

export async function paymentMethodKeyboard(
  orderId: string,
  walletBalanceCents = 0,
  orderTotalCents = 0,
): Promise<PremiumKeyboard> {
  const rows: PremiumButton[][] = [
    [
      await premiumBtn("btn_telebirr", "Telebirr", "📱", `pay:method:${orderId}:telebirr`, "primary"),
      await premiumBtn("btn_cbe", "CBE", "🏦", `pay:method:${orderId}:cbe`, "primary"),
    ],
  ];

  if (walletBalanceCents >= orderTotalCents && orderTotalCents > 0) {
    rows.push([
      await premiumBtn("btn_wallet", "Pay from Wallet", "💼", `pay:wallet:${orderId}`, "success"),
    ]);
  }

  rows.push([
    await premiumBtn("btn_cancel", "Cancel", "❌", `order:cancel:${orderId}`, "danger"),
  ]);

  return { inline_keyboard: rows };
}

export async function awaitingReferenceKeyboard(orderId: string): Promise<PremiumKeyboard> {
  return {
    inline_keyboard: [
      [
        await premiumBtn("btn_instructions", "Instructions again", "📋", `pay:show:${orderId}`, "primary"),
      ],
      [
        await premiumBtn("btn_cancel", "Cancel order", "❌", `order:cancel:${orderId}`, "danger"),
      ],
    ],
  };
}

export async function walletHomeKeyboard(): Promise<PremiumKeyboard> {
  return {
    inline_keyboard: [
      [
        await premiumBtn("btn_deposit", "Deposit", "➕", "wallet:deposit", "success"),
        await premiumBtn("btn_history", "History", "📜", "wallet:history", "primary"),
      ],
      [
        await premiumBtn("btn_back", "Main menu", "⬅️", "menu", "primary"),
      ],
    ],
  };
}

export async function depositAmountKeyboard(): Promise<PremiumKeyboard> {
  const rows: PremiumButton[][] = [];
  let row: PremiumButton[] = [];

  for (const amount of [50, 100, 200, 500, 1000]) {
    row.push({
      text: `${amount} ETB`,
      callback_data: `wallet:depAmt:${amount}`,
      style: "primary",
    });

    if (row.length === 3) {
      rows.push(row);
      row = [];
    }
  }

  if (row.length) rows.push(row);

  rows.push([
    await premiumBtn("btn_custom_amount", "Custom", "✏️", "wallet:depCustom", "primary"),
  ]);

  rows.push([
    await premiumBtn("btn_wallet_home", "Wallet", "⬅️", "wallet:home", "primary"),
  ]);

  return { inline_keyboard: rows };
}

export async function referralKeyboard(canPayout: boolean): Promise<PremiumKeyboard> {
  const rows: PremiumButton[][] = [];

  if (canPayout) {
    rows.push([
      {
        text: "Move earnings to wallet",
        callback_data: "ref:payout",
        style: "success",
      },
    ]);
  }

  rows.push([
    await premiumBtn("btn_back", "Main menu", "⬅️", "menu", "primary"),
  ]);

  return { inline_keyboard: rows };
}

export async function adminMenuKeyboard(): Promise<PremiumKeyboard> {
  return {
    inline_keyboard: [
      [
        { text: "📦 Products", callback_data: "adm:p:list:0", style: "primary" },
        { text: "🎟 Stock", callback_data: "adm:s:menu", style: "primary" },
      ],
      [
        { text: "🧾 Orders", callback_data: "adm:o:list:pending:0", style: "primary" },
        { text: "⏳ Manual", callback_data: "adm:o:list:paid_waiting_delivery:0", style: "primary" },
      ],
      [
        { text: "👥 Users", callback_data: "adm:u:menu", style: "primary" },
        { text: "💼 Wallet", callback_data: "adm:w:menu", style: "success" },
      ],
      [
        { text: "📣 Broadcast", callback_data: "adm:b:new", style: "primary" },
        { text: "🔘 Buttons", callback_data: "adm:btn:list", style: "primary" },
      ],
      [
        { text: "📝 Templates", callback_data: "adm:t:list", style: "primary" },
        { text: "📊 Stats", callback_data: "adm:stats", style: "primary" },
      ],
      [
        { text: "🛡 Admins", callback_data: "adm:adm:list", style: "danger" },
      ],
      [
        await premiumBtn("btn_back", "Main menu", "⬅️", "menu", "primary"),
      ],
    ],
  };
}
