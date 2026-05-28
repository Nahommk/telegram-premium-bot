import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { InlineKeyboard } from "grammy";
import { stripEmojiTags } from "@/bot/messaging";

export interface ButtonTpl {
  key: string;
  label: string;
  emoji: string;
  is_visible: boolean;
  sort_order: number;
  icon_custom_emoji_id?: string;
}

let _cache: ButtonTpl[] | null = null;
let _ts = 0;
const TTL = 30_000;

export async function loadButtons(force = false): Promise<ButtonTpl[]> {
  if (!force && _cache && Date.now() - _ts < TTL) return _cache;
  const { data, error } = await supabaseAdmin
    .from("button_templates")
    .select("key,label,emoji,icon_custom_emoji_id,is_visible,sort_order")
    .order("sort_order");
console.log("BUTTONS DEBUG DATA:", data);
console.log("BUTTONS DEBUG ERROR:", error);
  _cache = (data as ButtonTpl[]) ?? [];
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

type BtnStyle = "primary" | "success" | "danger";
const STYLES: Record<string, BtnStyle> = {
  "menu.shop": "primary",
  "menu.wallet": "success",   // Deposit/Wallet → green
  "menu.profile": "primary",
  "menu.orders": "primary",
  "menu.pending": "primary",
  "menu.referrals": "primary",
  "menu.support": "primary",
  "menu.admin": "danger",
};

export async function dynamicMainMenu(showAdmin: boolean) {
  const buttons = await loadButtons();
  const visible = buttons
    .filter((b) => b.is_visible && (b.key !== "menu.admin" || showAdmin))
    .sort((a, b) => a.sort_order - b.sort_order);
  const rows: Array<Array<{
  text: string;
  callback_data: string;
  style?: BtnStyle;
  icon_custom_emoji_id?: string;
}>> = [];

let current: Array<{
  text: string;
  callback_data: string;
  style?: BtnStyle;
  icon_custom_emoji_id?: string;
}> = [];
  for (const b of visible) {
    const cb = CALLBACKS[b.key];
    if (!cb) continue;
    current.push({
  text: btnText(b),
  callback_data: cb,
  style: STYLES[b.key],
  ...(b.icon_custom_emoji_id
    ? { icon_custom_emoji_id: b.icon_custom_emoji_id }
    : {}),
} as any);
    if (current.length === 2) { rows.push(current); current = []; }
  }
  if (current.length) rows.push(current);
  return { inline_keyboard: rows };
}

