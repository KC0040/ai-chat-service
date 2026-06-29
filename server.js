// AI 聊天服務 — NEXAutogear + AegisRim 共用
// 支援 OpenAI（預設）與 Anthropic 雙供應商，由環境變數切換，金鑰絕不寫死
//   AI_PROVIDER=openai | anthropic
//   OPENAI_API_KEY / OPENAI_MODEL（預設 gpt-5-nano）
//   ANTHROPIC_API_KEY / AI_MODEL
const express = require("express");
const cors = require("cors");

const PORT = process.env.PORT || 3000;
const PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-nano";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.AI_MODEL || "claude-haiku-4-5-20251001";

if (PROVIDER === "openai" && !OPENAI_KEY) {
  console.error("❌ AI_PROVIDER=openai 但缺少 OPENAI_API_KEY");
  process.exit(1);
}
if (PROVIDER === "anthropic" && !ANTHROPIC_KEY) {
  console.error("❌ AI_PROVIDER=anthropic 但缺少 ANTHROPIC_API_KEY");
  process.exit(1);
}

const app = express();

// 只允許自家網域呼叫
const ALLOWED_ORIGINS = [
  "https://www.aegisrim.com",
  "https://aegisrim.com",
  "https://www.nexautogear.com",
  "https://nexautogear.com",
  "https://www.txrobo.com",
  "https://txrobo.com",
  "https://www.ewnexus.com",
  "https://ewnexus.com",
  "http://localhost:3000",
  "http://localhost:8768",
  "http://localhost:8771",
];
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: "16kb" }));

// 每個 IP 每分鐘最多 10 則訊息（簡易防濫用）
const rateMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
function rateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count++;
  rateMap.set(ip, entry);
  return entry.count > RATE_LIMIT;
}

// ── 兩站知識庫：從 kb/*.md 載入，改 KB 不用動程式碼 ──
const fs = require("fs");
const path = require("path");
const PERSONAS = {};
for (const site of ["aegisrim", "nexautogear", "txrobo", "ewnexus"]) {
  PERSONAS[site] = fs.readFileSync(path.join(__dirname, "kb", site + ".md"), "utf-8");
}

// ── 供應商呼叫 ──
async function askOpenAI(system, messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_completion_tokens: 500,
      messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function askAnthropic(system, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 500, system, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

// ── Tawk.to REST API — 以 agent 身分回覆訪客 ──
// 每個 Property 需要各自的 API Key（EasyPanel ENV 設定）
// TAWK_API_KEY_AEGISRIM / TAWK_API_KEY_EWNEXUS / TAWK_API_KEY_NEXAUTOGEAR / TAWK_API_KEY_TXROBO
const TAWK_KEYS = {
  aegisrim:    process.env.TAWK_API_KEY_AEGISRIM    || "",
  ewnexus:     process.env.TAWK_API_KEY_EWNEXUS     || "",
  nexautogear: process.env.TAWK_API_KEY_NEXAUTOGEAR || "",
  txrobo:      process.env.TAWK_API_KEY_TXROBO      || "",
};
const TAWK_PROPERTY_IDS = {
  aegisrim:    "691c02fcdca098195ab9966a",
  ewnexus:     "6a2e4c919e8aac1f4526f040",
  nexautogear: "6a2d7d92d6a95f1c2c58ca23",
  txrobo:      "6a2e4bf3d87e8d1d538f5d45",
};

async function tawkSendReply(site, chatId, text) {
  const key = TAWK_KEYS[site];
  const propId = TAWK_PROPERTY_IDS[site];
  if (!key) { console.warn(`[tawk] No API key for ${site}`); return; }
  const creds = Buffer.from(`${propId}:${key}`).toString("base64");
  const res = await fetch(`https://api.tawk.to/v1/chat/${chatId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${creds}` },
    body: JSON.stringify({ body: text, type: "msg" }),
  });
  if (!res.ok) console.error(`[tawk] Reply failed ${res.status}:`, await res.text());
}

// ── Tawk.to Webhook 端點（四站各自觸發）──
// Tawk.to → Settings → Webhooks → URL: https://new2-chatbotservice.pkxdtf.easypanel.host/tawk-webhook/{site}
// Events: chat:msg_received（訪客送出訊息時觸發）
app.post("/tawk-webhook/:site", async (req, res) => {
  res.sendStatus(200); // 先回 200，避免 Tawk.to timeout 重送
  try {
    const site = req.params.site;
    if (!PERSONAS[site]) { console.warn(`[tawk-webhook] Unknown site: ${site}`); return; }

    const { event, chat, message } = req.body || {};
    // 只處理訪客訊息，忽略 agent 自己送出的（避免無限迴圈）
    if (event !== "chat:msg_received" || !message?.text || message?.sender?.type === "agent") return;

    const chatId = chat?.id;
    const userText = message.text.trim();
    if (!chatId || !userText) return;

    const reply = await (PROVIDER === "openai"
      ? askOpenAI(PERSONAS[site], [{ role: "user", content: userText }])
      : askAnthropic(PERSONAS[site], [{ role: "user", content: userText }]));

    await tawkSendReply(site, chatId, reply);
  } catch (err) {
    console.error("[tawk-webhook] Error:", err.message);
  }
});

// ── Chatwoot API — 以 agent 身分回覆訪客 ──
const CHATWOOT_URL = process.env.CHATWOOT_URL || "https://chatwoot-chatwoot.pkxdtf.easypanel.host";
const CHATWOOT_TOKEN = process.env.CHATWOOT_TOKEN || "";
const CHATWOOT_ACCOUNT = process.env.CHATWOOT_ACCOUNT || "1";
const CHATWOOT_INBOX_SITE = {
  "1": "aegisrim",
  "2": "nexautogear",
  "3": "txrobo",
  "4": "ewnexus",
};

async function chatwootReply(conversationId, text) {
  if (!CHATWOOT_TOKEN) { console.warn("[chatwoot] No CHATWOOT_TOKEN"); return; }
  const res = await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", api_access_token: CHATWOOT_TOKEN },
      body: JSON.stringify({ content: text, message_type: "outgoing", private: false }),
    }
  );
  if (!res.ok) console.error(`[chatwoot] Reply failed ${res.status}:`, await res.text());
}

// ── Chatwoot Webhook 端點 ──
app.post("/chatwoot-webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body || {};
    if (body.event !== "message_created") return;
    // 只處理訪客送出的訊息（message_type 0=incoming），忽略 agent 回覆避免無限迴圈
    if (body.message_type !== 0 && body.message_type !== "incoming") return;
    const text = (body.content || "").trim();
    const conversationId = body.conversation?.id;
    const inboxId = String(body.conversation?.inbox_id || body.inbox_id || "");
    if (!text || !conversationId || !inboxId) return;

    const site = CHATWOOT_INBOX_SITE[inboxId] || "aegisrim";
    const persona = PERSONAS[site] || PERSONAS.aegisrim;

    const reply = await (PROVIDER === "openai"
      ? askOpenAI(persona, [{ role: "user", content: text }])
      : askAnthropic(persona, [{ role: "user", content: text }]));

    await chatwootReply(conversationId, reply);
  } catch (err) {
    console.error("[chatwoot-webhook] Error:", err.message);
  }
});

// ── 健康檢查 ──
app.get("/health", (_req, res) =>
  res.json({ ok: true, provider: PROVIDER, model: PROVIDER === "openai" ? OPENAI_MODEL : ANTHROPIC_MODEL })
);

// ── 聊天端點 ──
app.post("/chat", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    if (rateLimited(ip)) {
      return res.status(429).json({ error: "Too many requests. Please wait a moment." });
    }

    const { message, site, history } = req.body || {};
    if (!message || typeof message !== "string" || message.length > 2000) {
      return res.status(400).json({ error: "Invalid message" });
    }
    // site 參數決定 AI 身分：aegisrim 或 nexautogear
    const persona = PERSONAS[site] || PERSONAS.aegisrim;

    // 帶入最近 6 輪對話歷史
    const messages = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-12)) {
        if (h && (h.role === "user" || h.role === "assistant") && typeof h.text === "string") {
          messages.push({ role: h.role, content: h.text.slice(0, 2000) });
        }
      }
    }
    messages.push({ role: "user", content: message });

    const reply = PROVIDER === "openai"
      ? await askOpenAI(persona, messages)
      : await askAnthropic(persona, messages);

    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: "Service temporarily unavailable" });
  }
});

app.listen(PORT, () =>
  console.log(`✅ AI chat service on :${PORT} (${PROVIDER}: ${PROVIDER === "openai" ? OPENAI_MODEL : ANTHROPIC_MODEL})`)
);
