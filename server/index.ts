// Standalone Express entrypoint for Railway / any Node host.
// Supports both webhook mode (default, recommended for Railway) and
// long-polling mode (set BOT_MODE=polling) for local dev.
import "dotenv/config";
import express from "express";
import { getBot } from "@/bot/bot";
import {
  getTelegramWebhookSecret,
  safeEqualSecret,
} from "@/bot/telegramWebhookSecret";

const PORT = Number(process.env.PORT) || 3000;
const MODE = (process.env.BOT_MODE || "webhook").toLowerCase();

// grammY expects TELEGRAM_BOT_TOKEN — accept BOT_TOKEN too.
if (!process.env.TELEGRAM_BOT_TOKEN && process.env.BOT_TOKEN) {
  process.env.TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN;
}

async function main() {
  const bot = getBot();
  await bot.init();
  console.log(`[bot] @${bot.botInfo.username} ready`);
bot.api.setMyCommands([
  { command: "start", description: "Start bot" },
  { command: "help", description: "Help" },
]).catch(console.error);
  if (MODE === "polling") {
    console.log("[bot] starting long-polling…");
    try {
      await bot.api.deleteWebhook({ drop_pending_updates: false });
    } catch {
      /* noop */
    }
    await bot.start();
    return;
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => res.send("ok"));
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Webhook endpoint
  app.post("/api/telegram/webhook", async (req, res) => {
    const expected = getTelegramWebhookSecret() ?? "";
    if (expected) {
      const got =
        (req.header("x-telegram-bot-api-secret-token") as string) ?? "";
      if (!safeEqualSecret(got, expected)) {
        console.warn("[webhook] bad secret");
        return res.status(401).send("unauthorized");
      }
    }
    try {
      await bot.handleUpdate(req.body);
    } catch (e) {
      console.error("[webhook] handler error", e);
    }
    res.json({ ok: true });
  });

  // One-shot helper to (re)register the webhook URL with Telegram.
  // POST /api/telegram/setup  body: { url: "https://<your-app>.up.railway.app/api/telegram/webhook" }
  // Header:  x-setup-secret: <TELEGRAM_WEBHOOK_SECRET>
  app.get("/api/telegram/setup", async (_req, res) => {
    const info = await bot.api.getWebhookInfo();
    res.json({ ok: true, webhook: info });
  });
  app.post("/api/telegram/setup", async (req, res) => {
    const expected = getTelegramWebhookSecret();
    if (!expected)
      return res
        .status(500)
        .json({ ok: false, error: "TELEGRAM_WEBHOOK_SECRET not set" });
    const got = (req.header("x-setup-secret") as string) ?? "";
    if (got !== process.env.TELEGRAM_WEBHOOK_SECRET)
      return res.status(401).send("unauthorized");

    const url = (req.body?.url ?? "").trim();
    if (!/^https:\/\//.test(url))
      return res.status(400).json({ ok: false, error: "https url required" });

    await bot.api.setWebhook(url, {
      secret_token: expected,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
    const info = await bot.api.getWebhookInfo();
    res.json({ ok: true, webhook: info });
  });

  app.listen(PORT, () => {
    console.log(`[server] listening on :${PORT}`);
    console.log(
      `[server] webhook endpoint: POST /api/telegram/webhook`,
    );
  });
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
