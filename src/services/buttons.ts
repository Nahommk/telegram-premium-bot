import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { stripEmojiTags } from "@/bot/messaging";

export interface ButtonTpl {
  key: string;
  label: string;
  emoji: string;
  is_visible: boolean;
  sort_order: number;
  icon_custom_emoji_id?: string | null;
}

let _cache: ButtonTpl[] | null = null;
let _ts = 0;
const TTL = 30_000;

const DEFAULT_BUTTONS: ButtonTpl[] = [
  { key: "menu.shop", label: "Shop", emoji: "🛒", is_visible: true, sort_order: 10 },
  { key: "menu.orders", label: "My Orders", emoji: "📦", is_visible: true, sort_order: 20 },
  { key: "menu.pending", label: "Pending Payments", emoji: "⏳", is_visible: true, sort_order: 30 },
  { key: "menu.wallet", label: "Wallet", emoji: "💼", is_visible: true, sort_order: 40 },
  { key: "menu.referrals", label: "Referrals", emoji: "🎁", is_visible: true, sort_order: 50 },
  { key: "menu.profile", label: "My Profile", emoji: "👤", is_visible: true, sort_order: 60 },
  { key: "menu.support", label: "Support", emoji: "", is_visible: true, sort_order: 70 },

{ key: "menu.bot_logs", label: "Bot Logs", emoji: "", is_visible: true, sort_order: 80 },
{ key: "menu.channel", label: "Channel", emoji: "", is_visible: true, sort_order: 90 },
{ key: "menu.reviews", label: "Reviews", emoji: "⭐", is_visible: true, sort_order: 95 },

{ key: "menu.admin", label: "Admin Panel", emoji: "️", is_visible: true, sort_order: 100 },

  { key: "btn_back", label: "Back", emoji: "⬅️", is_visible: true, sort_order: 1000 },
  { key: "btn_main_menu", label: "Main menu", emoji: "⬅️", is_visible: true, sort_order: 1010 },
  { key: "btn_custom_qty", label: "Custom qty", emoji: "✏️", is_visible: true, sort_order: 1020 },
  { key: "btn_custom_amount", label: "Custom", emoji: "✏️", is_visible: true, sort_order: 1030 },
  { key: "btn_wallet_home", label: "Wallet", emoji: "⬅️", is_visible: true, sort_order: 1040 },
  { key: "btn_wallet", label: "Pay from Wallet", emoji: "💼", is_visible: true, sort_order: 1050 },
  { key: "btn_deposit", label: "Deposit", emoji: "➕", is_visible: true, sort_order: 1060 },
  { key: "btn_history", label: "History", emoji: "📜", is_visible: true, sort_order: 1070 },
  { key: "btn_telebirr", label: "Telebirr", emoji: "📱", is_visible: true, sort_order: 1080 },
  { key: "btn_cbe", label: "CBE", emoji: "🏦", is_visible: true, sort_order: 1090 },
  { key: "btn_cancel", label: "Cancel", emoji: "❌", is_visible: true, sort_order: 1100 },
  { key: "btn_instructions", label: "Instructions again", emoji: "📋", is_visible: true, sort_order: 1110 },
  { key: "reply.shop", label: "Shop", emoji: "🛍", is_visible: true, sort_order: 2000 },
{ key: "reply.reviews", label: "Reviews", emoji: "⭐", is_visible: true, sort_order: 2010 },
{ key: "reply.bot_log", label: "Bot Log", emoji: "📢", is_visible: true, sort_order: 2020 },
];

async function ensureDefaultButtons() {
  const rows = DEFAULT_BUTTONS.map(({ key, label, emoji, is_visible, sort_order }) => ({
    key,
    label,
    emoji,
    is_visible,
    sort_order,
  }));

  await supabaseAdmin
    .from("button_templates")
    .upsert(rows as any, { onConflict: "key", ignoreDuplicates: true } as any);
}

export async function loadButtons(force = false): Promise<ButtonTpl[]> {
  if (!force && _cache && Date.now() - _ts < TTL) return _cache;

  await ensureDefaultButtons();

  const { data, error } = await supabaseAdmin
    .from("button_templates")
    .select("key,label,emoji,icon_custom_emoji_id,is_visible,sort_order")
    .order("sort_order");

  if (error) throw error;

  _cache = ((data ?? []) as unknown as ButtonTpl[]);
  _ts = Date.now();
  return _cache;
}

export function invalidateButtonsCache() {
  _cache = null;
}

function btnText(b: ButtonTpl): string {
  const label = stripEmojiTags(b.label);
  const emoji = stripEmojiTags(b.emoji);
  return emoji ? `${emoji} ${label}` : label;
}

const CALLBACKS: Record<string, string> = {
  "menu.shop": "shop:list:0",
  "menu.orders": "orders:mine:0",
  "menu.pending": "orders:pending",
  "menu.wallet": "wallet:home",
  "menu.referrals": "ref:home",
  "menu.profile": "profile",
  "menu.support": "support",
  "menu.admin": "admin:menu",
};
const URL_ENVS: Record<string, string> = {
  "menu.bot_logs": "BOT_LOG_CHANNEL_URL",
  "menu.channel": "MAIN_CHANNEL_URL",
  "menu.reviews": "REVIEW_GROUP_URL",
};

type BtnStyle = "primary" | "success" | "danger" | "black";

const STYLES: Record < string, BtnStyle > = {
  "menu.shop": "primary",
  "menu.wallet": "success",
  "menu.profile": "primary",
  "menu.orders": "primary",
  "menu.pending": "primary",
  "menu.referrals": "primary",
  "menu.support": "primary",
  
  "menu.bot_logs": "black",
  "menu.channel": "black",
  "menu.reviews": "black",
  
  "menu.admin": "danger",
};

type PremiumButton = {
  text: string;
  callback_data ? : string;
  url ? : string;
  style ? : BtnStyle;
  icon_custom_emoji_id ? : string;
};

export async function dynamicMainMenu(showAdmin: boolean): Promise<{ inline_keyboard: PremiumButton[][] }> {
  const buttons = await loadButtons();
  const visible = buttons
    .filter((b) => b.is_visible && (b.key !== "menu.admin" || showAdmin))
    .sort((a, b) => a.sort_order - b.sort_order);

  const rows: PremiumButton[][] = [];
  let current: PremiumButton[] = [];

  for (const b of visible) {
    const callback_data = CALLBACKS[b.key];

const urlEnv = URL_ENVS[b.key];
const url = urlEnv ? process.env[urlEnv] : undefined;

if (!callback_data && !url) continue;

current.push({
  text: b.icon_custom_emoji_id ? stripEmojiTags(b.label) : btnText(b),
  ...(url ? { url } : { callback_data }),
  style: STYLES[b.key],
  ...(b.icon_custom_emoji_id ? { icon_custom_emoji_id: b.icon_custom_emoji_id } : {}),
});

    if (current.length === 2) {
      rows.push(current);
      current = [];
    }
  }

  if (current.length) rows.push(current);
  return { inline_keyboard: rows };
}