import { Bot, type Context } from "grammy";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { registerCustomer } from "./customer";
import { registerAdmin } from "./admin";
import { isAdmin } from "./util";
import { dynamicMainMenu } from "@/services/buttons";
import { getMessageTemplate } from "@/services/templates";

export interface BotCtx extends Context {
  isAdmin: boolean;
}

let _bot: Bot<BotCtx> | null = null;

export function getBot(): Bot<BotCtx> {
  if (_bot) return _bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const bot = new Bot<BotCtx>(token);

  // Upsert user + ban check + admin flag
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (!from) return;
    const { data: existing } = await supabaseAdmin
      .from("bot_users").select("id, is_banned").eq("telegram_id", from.id).maybeSingle();

    if (existing?.is_banned) {
      try { await ctx.reply(await getMessageTemplate("banned", "⛔ You are banned from using this bot.")); } catch { /* noop */ }
      return;
    }

    await supabaseAdmin.from("bot_users").upsert({
      telegram_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      language_code: from.language_code ?? null,
    }, { onConflict: "telegram_id" });

    ctx.isAdmin = await isAdmin(from.id);
    await next();
  });

  // Main menu callback
  bot.callbackQuery("menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    const kb = await dynamicMainMenu(ctx.isAdmin);
    await ctx.editMessageText(await getMessageTemplate("main_menu", "🏠 Main menu — pick an option:"), { reply_markup: kb });
  });

  registerCustomer(bot);
  registerAdmin(bot);

  // Fallback (must be last)
  bot.on("message", async (ctx) => {
    const kb = await dynamicMainMenu(ctx.isAdmin);
    await ctx.reply(await getMessageTemplate("fallback", "Use the menu below."), { reply_markup: kb });
  });

  bot.catch((err) => {
    console.error("[bot error]", err.error);
  });

  _bot = bot;
  return bot;
}
