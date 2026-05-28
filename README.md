# Telegram Digital Store Bot — Railway Edition

Standalone Node.js + Express + grammY version of the bot. Runs on Railway,
Fly, Render, a VPS, or your laptop. No Lovable runtime required.

Keeps every existing feature: customer flow, admin panel, products & codes,
Telebirr / CBE / CBE Birr / Abyssinia / Dashen / M-Pesa verification via
Leul Verify, wallet, referrals, broadcasts, manual delivery, stats, button
customization, message templates, **Telegram Premium custom emoji** in
message bodies (`<tg-emoji emoji-id="…">…</tg-emoji>` + HTML parse mode).

## 1. Prerequisites

| Need                                | Where                                          |
| ----------------------------------- | ---------------------------------------------- |
| Telegram bot token                  | https://t.me/BotFather → `/newbot`             |
| Your Telegram numeric user id       | https://t.me/userinfobot                       |
| Supabase project (URL + service key)| https://supabase.com → Project Settings → API |
| Leul Verify API key                 | https://verify.leul.et/docs                    |
| Railway account                     | https://railway.app                            |

## 2. Set up the database (Supabase)

1. Create a new Supabase project.
2. Apply the migrations in `supabase/migrations/` in chronological order.
   Easiest way: install the Supabase CLI (`npm i -g supabase`) and run
   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   ```
   Or open Supabase SQL Editor and paste each migration in order.
3. Copy **Project URL** and the **service_role** key from
   Project Settings → API Keys. You'll need them in step 4.

## 3. Local development (polling — no public URL needed)

```bash
git clone <this-repo> && cd <this-repo>
cp .env.example .env
# fill in BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# LEUL_VERIFY_API_KEY, ADMIN_TELEGRAM_IDS, TELEGRAM_WEBHOOK_SECRET
npm install
npm run dev
```

Open the bot in Telegram and send `/start`.

## 4. Deploy to Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo** → pick the repo.
3. Railway auto-detects Node and runs `npm start`.
4. In the service **Variables** tab, add every key from `.env.example`
   **except** `PORT` (Railway injects it) and `BOT_MODE` (defaults to
   `webhook`).
5. Open **Settings → Networking → Generate Domain**. You now have an
   `https://your-app.up.railway.app` URL.
6. Register the webhook with Telegram (one-time, from your laptop):

   ```bash
   curl -X POST 'https://your-app.up.railway.app/api/telegram/setup' \
     -H 'Content-Type: application/json' \
     -H "x-setup-secret: $TELEGRAM_WEBHOOK_SECRET" \
     -d '{"url":"https://your-app.up.railway.app/api/telegram/webhook"}'
   ```

7. Verify:
   ```bash
   curl https://your-app.up.railway.app/api/telegram/setup
   ```
   You should see your URL and `pending_update_count: 0`.

That's it — send `/start` to the bot.

## 5. Environment variables

| Name                          | Required | Notes                                       |
| ----------------------------- | -------- | ------------------------------------------- |
| `BOT_TOKEN`                   | ✅       | From @BotFather. Alias: `TELEGRAM_BOT_TOKEN`|
| `TELEGRAM_WEBHOOK_SECRET`     | ✅       | Any long random string                      |
| `ADMIN_TELEGRAM_IDS`          | ✅       | Comma-separated numeric IDs                 |
| `SUPABASE_URL`                | ✅       | `https://xxx.supabase.co`                   |
| `SUPABASE_SERVICE_ROLE_KEY`   | ✅       | **Server-only.** Bypasses RLS               |
| `LEUL_VERIFY_API_KEY`         | ✅       | For payment verification                    |
| `PORT`                        | auto     | Set by Railway. Local default 3000          |
| `BOT_MODE`                    | optional | `webhook` (default) or `polling`            |

## 6. Project layout

```
server/index.ts          Express + webhook entrypoint
src/bot/                 grammY composition, customer + admin handlers
src/services/            payments, wallet, broadcasts, referrals, etc.
src/integrations/supabase/  client + generated DB types
supabase/migrations/     full schema (apply in order)
```

## 7. First-time admin actions

1. Send `/start` from a Telegram account whose ID is in `ADMIN_TELEGRAM_IDS`.
2. Tap **🛠 Admin → 📦 Products → ➕ New product**.
3. Open the product → **✏️ Edit** description / warranty / icon → **➕ Add codes**.
4. Tap **📝 Templates** to customize messages — premium emoji are preserved
   if you send them from a Premium account.
5. **Replace** the demo Telebirr / CBE account numbers in the
   `payment_instruction_*` templates with your real payout accounts before
   going live.

## 8. How payments stay safe

Same flow as the original:

1. User picks product → method → bot shows amount + account.
2. User pays out of band, sends transaction **reference**.
3. Bot calls Leul Verify (`/verify-telebirr`, `/verify-cbe`, etc.).
4. On success, the SQL function `process_payment` runs inside a single
   transaction: locks the order, asserts provider+amount match, inserts
   the payment (UNIQUE on `reference` prevents double-spend), claims one
   unused product code (`FOR UPDATE SKIP LOCKED`), flips order to
   `delivered`. Code is only DM'd after all of that succeeds.

A screenshot, OCR result, or hash by itself is **never** enough.

## 9. Updating the bot

```bash
git push origin main   # Railway redeploys automatically
```

Webhook URL doesn't change on redeploy — no re-registration needed.
