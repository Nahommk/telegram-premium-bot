// Standalone Express entrypoint for Railway / any Node host.
// Supports both webhook mode (default, recommended for Railway) and
// long-polling mode (set BOT_MODE=polling) for local dev.
import "dotenv/config";
import express from "express";
import { getStats } from "@/services/stats";
import { formatPrice } from "@/bot/util";
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

  app.get("/", (_req, res) => {
  res.redirect("/admin/stats");
});
  app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/admin/stats", async (req, res) => {
  const expected = process.env.STATS_DASHBOARD_SECRET;

  if (!expected) {
    return res.status(500).send("STATS_DASHBOARD_SECRET not set");
  }

  const key = String(req.query.key ?? "");

  if (key !== expected) {
    return res.status(401).send("unauthorized");
  }

  const s = await getStats();

  const esc = (v: unknown) =>
    String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const values = s.revenue7dDays.map((d) => d.revenue);
  const max = Math.max(...values, 1);

  const points = s.revenue7dDays
    .map((d, i) => {
      const x = 45 + i * 140;
      const y = 260 - (d.revenue / max) * 190;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `45,285 ${points} ${45 + (s.revenue7dDays.length - 1) * 140},285`;

  const chartLabels = s.revenue7dDays
    .map((d, i) => {
      const x = 45 + i * 140;
      return `<text x="${x}" y="326" text-anchor="middle" class="axis-label">${esc(d.label)}</text>`;
    })
    .join("");

  const recentRows = s.recentOrders.length
    ? s.recentOrders
        .map((o) => {
          const ok = o.status === "delivered";
          return `
            <tr>
              <td><span class="dot ${ok ? "green" : "orange"}"></span>${esc(o.status)}</td>
              <td>${esc(o.short_id)}</td>
              <td>${esc(o.customer)}</td>
              <td>${esc(o.product)}</td>
              <td><b>${formatPrice(o.amount_cents)} ETB</b></td>
              <td>${new Date(o.timestamp).toLocaleString()}</td>
            </tr>`;
        })
        .join("")
    : `<tr><td colspan="6">No recent activity</td></tr>`;

  const topProducts = s.topProducts.length
    ? s.topProducts
        .map(
          (p, i) => `
            <div class="quick-row">
              <div class="quick-icon">${i + 1}</div>
              <div>
                <b>${esc(p.name)}</b>
                <span>${p.qty} sold</span>
              </div>
            </div>`
        )
        .join("")
    : `<div class="quick-row"><div class="quick-icon">0</div><div><b>No products</b><span>No sales yet</span></div></div>`;

  const successRate =
    s.paymentSuccess + s.paymentFailure > 0
      ? Math.round((s.paymentSuccess / (s.paymentSuccess + s.paymentFailure)) * 100)
      : 0;

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Revenue Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f6f5ef;
      color: #20242a;
      font-family: Arial, Helvetica, sans-serif;
    }
    .page {
      max-width: 1500px;
      margin: 0 auto;
      border-left: 1px solid #d8d6ca;
      border-right: 1px solid #d8d6ca;
      background: #fbfaf5;
      min-height: 100vh;
    }
    .topbar {
      padding: 22px 26px;
      border-bottom: 1px solid #d8d6ca;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .brand {
      font-size: 13px;
      letter-spacing: 3px;
      text-transform: uppercase;
      font-weight: 800;
    }
    .refresh {
      color: #4c92c9;
      text-decoration: none;
      font-size: 13px;
      letter-spacing: 2px;
      text-transform: uppercase;
      font-weight: 800;
    }
    .summary {
      display: grid;
      grid-template-columns: 1.6fr .8fr .8fr;
      border-bottom: 1px solid #d8d6ca;
    }
    .summary-card {
      min-height: 180px;
      padding: 28px;
      border-right: 1px solid #d8d6ca;
      background: #fbfaf5;
    }
    .summary-card:last-child { border-right: none; }
    .label {
      font-size: 12px;
      letter-spacing: 2.2px;
      text-transform: uppercase;
      font-weight: 800;
      color: #333842;
      margin-bottom: 24px;
    }
    .big-money {
      font-size: 34px;
      font-weight: 900;
      letter-spacing: 1px;
    }
    .small-note {
      margin-top: 28px;
      font-size: 13px;
      color: #69707c;
    }
    .number {
      font-size: 30px;
      font-weight: 900;
      margin-bottom: 8px;
    }
    .health {
      display: flex;
      gap: 22px;
      align-items: center;
    }
    .gauge {
      width: 70px;
      height: 70px;
      border-radius: 50%;
      background:
        radial-gradient(circle at center, #fbfaf5 50%, transparent 51%),
        conic-gradient(#359ae8 0 ${successRate}%, #e4e2d8 ${successRate}% 100%);
      display: grid;
      place-items: center;
      font-size: 11px;
      font-weight: 900;
      color: #359ae8;
    }
    .middle {
      display: grid;
      grid-template-columns: 2fr 1fr;
      border-bottom: 1px solid #d8d6ca;
    }
    .chart-box {
      padding: 28px;
      border-right: 1px solid #d8d6ca;
    }
    .chart-head {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 16px;
    }
    .chart-title {
      font-size: 12px;
      letter-spacing: 2.2px;
      text-transform: uppercase;
      font-weight: 900;
    }
    .chart-money {
      font-size: 24px;
      font-weight: 900;
      margin-top: 8px;
    }
    .pill {
      background: #e5f4ea;
      color: #1f8b4c;
      padding: 7px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 900;
    }
    svg {
      width: 100%;
      height: 350px;
      display: block;
    }
    .grid-line {
      stroke: #cbc9bd;
      stroke-width: 1;
    }
    .axis-label {
      fill: #333842;
      font-size: 13px;
    }
    .line {
      fill: none;
      stroke: #3a9eea;
      stroke-width: 4;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .area { fill: rgba(58, 158, 234, 0.15); }
    .dot-chart {
      fill: #fbfaf5;
      stroke: #3a9eea;
      stroke-width: 3;
    }
    .quick { padding: 28px; }
    .quick-row {
      display: flex;
      gap: 16px;
      align-items: center;
      margin-bottom: 26px;
    }
    .quick-icon {
      width: 50px;
      height: 50px;
      display: grid;
      place-items: center;
      background: #eaf6ff;
      color: #2688c9;
      font-weight: 900;
    }
    .quick-row span {
      display: block;
      color: #767b85;
      font-size: 13px;
      margin-top: 5px;
    }
    .activity { padding: 26px; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #fbfaf5;
    }
    th {
      text-align: left;
      padding: 16px 10px;
      border-bottom: 1px solid #d8d6ca;
      color: #303640;
      font-size: 12px;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    td {
      padding: 18px 10px;
      border-bottom: 1px solid #d8d6ca;
      font-size: 14px;
    }
    .dot {
      width: 7px;
      height: 7px;
      display: inline-block;
      border-radius: 50%;
      margin-right: 8px;
    }
    .green { background: #2dbd68; }
    .orange { background: #f59e0b; }
    @media (max-width: 850px) {
      .summary, .middle { grid-template-columns: 1fr; }
      .summary-card, .chart-box {
        border-right: none;
        border-bottom: 1px solid #d8d6ca;
      }
      th:nth-child(4), td:nth-child(4),
      th:nth-child(6), td:nth-child(6) {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="topbar">
      <div class="brand">Bot Revenue Dashboard</div>
      <a class="refresh" href="/admin/stats?key=${encodeURIComponent(key)}">Refresh →</a>
    </div>

    <section class="summary">
      <div class="summary-card">
        <div class="label">Net Settlement</div>
        <div class="big-money">${formatPrice(s.lifetimeRevenue)} ETB</div>
        <div class="small-note">Lifetime delivered order revenue</div>
      </div>

      <div class="summary-card">
        <div class="label">Live Volume</div>
        <div class="number">${s.totalOrders}</div>
        <div class="small-note">Total orders</div>
      </div>

      <div class="summary-card">
        <div class="label">Health</div>
        <div class="health">
          <div class="gauge">${successRate}%</div>
          <div>
            <div class="number">${s.paymentSuccess}</div>
            <div class="small-note">Successful payments</div>
          </div>
        </div>
      </div>
    </section>

    <section class="middle">
      <div class="chart-box">
        <div class="chart-head">
          <div>
            <div class="chart-title">Revenue 7 Days</div>
            <div class="chart-money">${formatPrice(s.revenueWeek)} ETB</div>
          </div>
          <div class="pill">Live</div>
        </div>

        <svg viewBox="0 0 940 350" preserveAspectRatio="none">
          <line x1="45" y1="70" x2="900" y2="70" class="grid-line" />
          <line x1="45" y1="115" x2="900" y2="115" class="grid-line" />
          <line x1="45" y1="160" x2="900" y2="160" class="grid-line" />
          <line x1="45" y1="205" x2="900" y2="205" class="grid-line" />
          <line x1="45" y1="250" x2="900" y2="250" class="grid-line" />

          <polygon points="${areaPoints}" class="area"></polygon>
          <polyline points="${points}" class="line"></polyline>

          ${points
            .split(" ")
            .map((point) => {
              const [x, y] = point.split(",");
              return `<circle cx="${x}" cy="${y}" r="6" class="dot-chart"></circle>`;
            })
            .join("")}

          ${chartLabels}
        </svg>
      </div>

      <div class="quick">
        <div class="label">Quick Stats</div>

        <div class="quick-row">
          <div class="quick-icon">👥</div>
          <div><b>${s.users}</b><span>Total users</span></div>
        </div>

        <div class="quick-row">
          <div class="quick-icon">✅</div>
          <div><b>${s.delivered}</b><span>Delivered orders</span></div>
        </div>

        <div class="quick-row">
          <div class="quick-icon">⏳</div>
          <div><b>${s.pending}</b><span>Pending payments</span></div>
        </div>

        <div class="quick-row">
          <div class="quick-icon">📦</div>
          <div><b>${s.manualWaiting}</b><span>Manual deliveries</span></div>
        </div>

        <div class="label">Top Products</div>
        ${topProducts}
      </div>
    </section>

    <section class="activity">
      <div class="label">Recent Activity</div>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Order Ref</th>
            <th>Customer</th>
            <th>Product</th>
            <th>Amount</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          ${recentRows}
        </tbody>
      </table>
    </section>
  </div>
</body>
</html>`);
});
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
