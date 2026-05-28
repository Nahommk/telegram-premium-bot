// Centralized message sender that pulls every user-facing string from the
// `message_templates` table. The first time a key is requested, the fallback
// body is inserted into the table so the admin can edit it from the bot's
// Templates UI without ever touching code.
//
// Premium custom emoji: templates store Telegram's official HTML form,
// `<tg-emoji emoji-id="ID">fallback</tg-emoji>`, and we send with
// parse_mode: "HTML". Premium users see the animated/custom emoji; everyone
// else sees the fallback char.
//
// Legacy: older templates may still contain `<ce:ID>fallback</ce>` markers.
// We transparently upgrade them to <tg-emoji> at render time so nothing
// breaks while we phase the old syntax out.
//
// The bot token is read by grammY from process.env.TELEGRAM_BOT_TOKEN in
// src/bot/bot.ts — it never reaches the client bundle.

import type { BotCtx } from "./bot";
import { renderMessage } from "@/services/templates";

type Vars = Record<string, string | number | undefined | null>;
type Extra = Record<string, any>;

// Matches both the legacy <ce:ID>..</ce> and the canonical
// <tg-emoji emoji-id="ID">..</tg-emoji> forms.
const EMOJI_TAG_RE =
  /(<ce:\d+>[\s\S]*?<\/ce>|<tg-emoji\s+emoji-id="\d+">[\s\S]*?<\/tg-emoji>)/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tagToTgEmoji(tag: string): string {
  if (tag.startsWith("<tg-emoji")) return tag;
  const m = tag.match(/^<ce:(\d+)>([\s\S]*?)<\/ce>$/);
  if (!m) return tag;
  return `<tg-emoji emoji-id="${m[1]}">${escapeHtml(m[2] || "⭐")}</tg-emoji>`;
}

// Convert a template body to safe HTML for parse_mode: "HTML".
export function toHtml(raw: string): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  EMOJI_TAG_RE.lastIndex = 0;
  while ((m = EMOJI_TAG_RE.exec(raw)) !== null) {
    out += escapeHtml(raw.slice(last, m.index));
    out += tagToTgEmoji(m[0]);
    last = EMOJI_TAG_RE.lastIndex;
  }
  out += escapeHtml(raw.slice(last));
  return out;
}

// Strip all emoji tags to just the fallback character. Use this for places
// where Telegram does not render HTML (inline keyboard button text, alert
// popups), so admins see "⭐ Shop" instead of literal "<tg-emoji ...>⭐...".
export function stripEmojiTags(raw: string): string {
  return raw
    .replace(/<ce:\d+>([\s\S]*?)<\/ce>/g, "$1")
    .replace(/<tg-emoji\s+emoji-id="\d+">([\s\S]*?)<\/tg-emoji>/g, "$1");
}

// Inverse of toHtml: when an admin edits a template via Telegram, take the
// incoming message's text + entities and re-encode any `custom_emoji`
// entities as `<tg-emoji emoji-id="..">fallback</tg-emoji>` so the saved
// template body preserves premium emojis in the canonical form.
export function encodeCustomEmoji(
  text: string,
  entities:
    | ReadonlyArray<{ type: string; offset: number; length: number; custom_emoji_id?: string }>
    | undefined,
): string {
  if (!text || !entities?.length) return text;
  const ce = entities
    .filter((e) => e.type === "custom_emoji" && e.custom_emoji_id)
    .slice()
    .sort((a, b) => b.offset - a.offset);
  let out = text;
  for (const e of ce) {
    const fallback = out.slice(e.offset, e.offset + e.length);
    out =
      out.slice(0, e.offset) +
      `<tg-emoji emoji-id="${e.custom_emoji_id}">${fallback}</tg-emoji>` +
      out.slice(e.offset + e.length);
  }
  return out;
}

async function send(
  fn: (text: string, extra?: Extra) => Promise<any>,
  key: string,
  fallback: string,
  vars: Vars = {},
  extra: Extra = {},
): Promise<any> {
  const rawText = await renderMessage(key, fallback, vars);
  const htmlText = toHtml(rawText);

  try {
    return await fn(htmlText, { ...extra, parse_mode: "HTML" });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes("parse") || msg.includes("entities") || msg.includes("HTML") || msg.includes("tag")) {
      return await fn(stripEmojiTags(rawText), { ...extra, parse_mode: undefined });
    }
    throw e;
  }
}

export function tReply(ctx: BotCtx, key: string, fallback: string, vars: Vars = {}, extra: Extra = {}) {
  return send((t, e) => ctx.reply(t, e), key, fallback, vars, extra);
}

export function tEdit(ctx: BotCtx, key: string, fallback: string, vars: Vars = {}, extra: Extra = {}) {
  return send((t, e) => ctx.editMessageText(t, e), key, fallback, vars, extra);
}

export function tSend(ctx: BotCtx, chatId: number, key: string, fallback: string, vars: Vars = {}, extra: Extra = {}) {
  return send((t, e) => ctx.api.sendMessage(chatId, t, e), key, fallback, vars, extra);
}

// Back-compat shim.
export function extractCustomEmoji(raw: string): { text: string; entities: any[] } {
  return { text: stripEmojiTags(raw), entities: [] };
}
