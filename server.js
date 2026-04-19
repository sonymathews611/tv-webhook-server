// ─────────────────────────────────────────────────────────────────────────────
// TV AI COMPANION — Webhook Server
// Receives TradingView alerts → sends to Telegram → logs everything
// Deploy on Railway / Render / Fly.io for free
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.text()); // TradingView sometimes sends plain text

// ─── CONFIG (set these as environment variables on your cloud host) ───────────
const TELEGRAM_TOKEN  = process.env.TELEGRAM_TOKEN  || "";   // Your bot token
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ""; // Your chat ID
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET  || "";   // Optional security key
const PORT            = process.env.PORT             || 3000;

// ─── IN-MEMORY LOG (last 100 alerts) ─────────────────────────────────────────
const alertLog = [];

// ─── TELEGRAM HELPER ─────────────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("⚠️  Telegram not configured. Set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID.");
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
    }),
  });
  const data = await res.json();
  if (!data.ok) console.error("Telegram error:", data);
  return data;
}

// ─── FORMAT ALERT MESSAGE ─────────────────────────────────────────────────────
function formatAlert(payload) {
  const {
    ticker   = "UNKNOWN",
    price    = "—",
    action   = "—",
    indicator = "—",
    timeframe = "—",
    message  = "",
    exchange = "",
  } = payload;

  const emoji = action.toLowerCase() === "buy"  ? "🟢" :
                action.toLowerCase() === "sell" ? "🔴" : "📊";
  const actionUpper = action.toUpperCase();
  const time = new Date().toUTCString();

  return `${emoji} <b>TradingView Alert</b>
━━━━━━━━━━━━━━━
📌 Symbol: <b>${ticker}</b>${exchange ? ` (${exchange})` : ""}
💵 Price: <b>$${price}</b>
⚡ Action: <b>${actionUpper}</b>
📈 Indicator: ${indicator}
⏱ Timeframe: ${timeframe}
${message ? `📝 Note: ${message}\n` : ""}🕐 Time: ${time}
━━━━━━━━━━━━━━━`;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "✅ TV AI Companion Server running",
    alerts_received: alertLog.length,
    telegram_configured: !!(TELEGRAM_TOKEN && TELEGRAM_CHAT_ID),
    uptime_seconds: Math.floor(process.uptime()),
  });
});

// ── MAIN WEBHOOK ENDPOINT ─────────────────────────────────────────────────────
// Point TradingView alert Webhook URL to: https://YOUR-SERVER-URL/webhook
app.post("/webhook", async (req, res) => {

  // Optional secret key check
  if (WEBHOOK_SECRET) {
    const incoming = req.headers["x-webhook-secret"] || req.query.secret;
    if (incoming !== WEBHOOK_SECRET) {
      console.warn("⛔ Unauthorized webhook attempt");
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  // Parse body — TradingView can send JSON or plain text
  let payload = {};
  if (typeof req.body === "string") {
    // Try JSON first
    try {
      payload = JSON.parse(req.body);
    } catch {
      // Plain text fallback — treat as message
      payload = { message: req.body, ticker: "UNKNOWN" };
    }
  } else if (typeof req.body === "object") {
    payload = req.body;
  }

  console.log("📡 Webhook received:", JSON.stringify(payload, null, 2));

  // Log it
  const entry = { ...payload, received_at: new Date().toISOString() };
  alertLog.unshift(entry);
  if (alertLog.length > 100) alertLog.pop();

  // Send to Telegram
  const message = formatAlert(payload);
  await sendTelegram(message);

  res.json({ ok: true, received: payload });
});

// ── GET ALERT LOG (for dashboard polling) ─────────────────────────────────────
app.get("/alerts", (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json({ alerts: alertLog.slice(0, limit) });
});

// ── MANUAL TEST ENDPOINT ──────────────────────────────────────────────────────
app.post("/test", async (req, res) => {
  const testPayload = {
    ticker: "BTC",
    price: "84200",
    action: "buy",
    indicator: "EMA Cross (9/21)",
    timeframe: "4H",
    message: "Test alert from TV AI Companion server",
    exchange: "BINANCE",
  };
  const message = formatAlert(testPayload);
  const result = await sendTelegram(message);
  res.json({ ok: true, telegram_response: result, payload_sent: testPayload });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   TV AI COMPANION — Webhook Server    ║
║   Port: ${PORT}                          ║
║   Telegram: ${TELEGRAM_TOKEN ? "✅ Configured" : "❌ Not set"}         ║
╚═══════════════════════════════════════╝

Endpoints:
  GET  /          → Health check
  POST /webhook   → TradingView alerts (point this in TV)
  GET  /alerts    → Recent alert log
  POST /test      → Send a test Telegram message
  `);
});
