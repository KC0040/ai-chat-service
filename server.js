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

// ── 模組化站台設定：新增站點只要編輯 sites.json + 加一份 kb/{site}.md，不用改這支程式 ──
const fs = require("fs");
const path = require("path");
const SITES = JSON.parse(fs.readFileSync(path.join(__dirname, "sites.json"), "utf-8"));
const SITE_KEYS = Object.keys(SITES);
const DEFAULT_SITE = "aegisrim"; // 找不到對應 site 參數時的 fallback persona

// 只允許 sites.json 裡登記過網域的來源呼叫（+ 本機開發用的 localhost）
const LOCAL_DEV_ORIGINS = ["http://localhost:3000", "http://localhost:8768", "http://localhost:8771"];
const ALLOWED_ORIGINS = [...new Set(SITE_KEYS.flatMap((s) => SITES[s].origins || []).concat(LOCAL_DEV_ORIGINS))];
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

// ── 知識庫：依 sites.json 動態從 kb/*.md 載入，改 KB / 加站點都不用動這支程式 ──
const PERSONAS = {};
for (const site of SITE_KEYS) {
  const kbFile = path.join(__dirname, "kb", site + ".md");
  if (fs.existsSync(kbFile)) {
    PERSONAS[site] = fs.readFileSync(kbFile, "utf-8");
  } else {
    console.warn(`[persona] sites.json 有 "${site}" 但找不到 kb/${site}.md，略過`);
  }
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
// 從 sites.json 的 chatwootInboxId 欄位自動組出對照表
const CHATWOOT_INBOX_SITE = {};
for (const site of SITE_KEYS) {
  if (SITES[site].chatwootInboxId) CHATWOOT_INBOX_SITE[String(SITES[site].chatwootInboxId)] = site;
}

const CHATWOOT_AGENT_ID = process.env.CHATWOOT_AGENT_ID || "";

async function chatwootReply(conversationId, text) {
  if (!CHATWOOT_TOKEN) { console.warn("[chatwoot] No CHATWOOT_TOKEN"); return null; }
  const res = await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", api_access_token: CHATWOOT_TOKEN },
      body: JSON.stringify({ content: text, message_type: "outgoing", private: false }),
    }
  );
  if (!res.ok) { console.error(`[chatwoot] Reply failed ${res.status}:`, await res.text()); return null; }
  const data = await res.json();
  return data.id || null;
}

// AI 回覆後把對話 assign 給人工 agent，讓它出現在 App 收件匣
async function chatwootAssign(conversationId) {
  if (!CHATWOOT_AGENT_ID) return;
  await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT}/conversations/${conversationId}/assignments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", api_access_token: CHATWOOT_TOKEN },
      body: JSON.stringify({ assignee_id: parseInt(CHATWOOT_AGENT_ID) }),
    }
  );
}

// 抓對話歷史，帶入 AI context（最近 6 輪）
async function chatwootHistory(conversationId) {
  try {
    const res = await fetch(
      `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT}/conversations/${conversationId}/messages`,
      { headers: { api_access_token: CHATWOOT_TOKEN } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const msgs = (data.payload || []).slice(-12);
    return msgs
      .filter(m => m.content && (m.message_type === 0 || m.message_type === 1))
      .map(m => ({ role: m.message_type === 0 ? "user" : "assistant", content: m.content }));
  } catch { return []; }
}

// 去重快取：防止 Chatwoot 同時觸發兩種格式造成重複回覆
const _recentMsgIds = new Set();
function isDuplicate(key) {
  if (_recentMsgIds.has(key)) return true;
  _recentMsgIds.add(key);
  setTimeout(() => _recentMsgIds.delete(key), 10000);
  return false;
}

// ── 真人接手偵測 ──
// 問題：AI 回覆後會呼叫 chatwootAssign() 把對話指派給人工方便你在 App 看到，
// 但如果拿「這則對話有沒有指派人」當作 AI 該不該閉嘴的依據，AI 自己回完第一句
// 就會把自己判定成「已有人接手」，之後永遠不再回覆——等於只回一次就啞巴。
// 改成：只有偵測到「不是我們自己送出的」outgoing 訊息（=你在 Chatwoot 裡親自打字回的）
// 才視為真人接手，接手後 30 分鐘內 AI 讓路；超過 30 分鐘沒有你的新回覆，
// 訪客再傳訊息時 AI 自動恢復回覆（不用手動「指派回去」）。
const _ourMessageIds = new Set(); // 我們剛用 API 貼出去的 message id，用來排除自己的回聲
const _humanActiveUntil = new Map(); // conversationId -> timestamp，這段時間內 AI 不搶答
const HUMAN_TAKEOVER_WINDOW_MS = 30 * 60 * 1000; // 30 分鐘

// ── Chatwoot Webhook 端點（支援 Agent Bot 格式 + 一般 Webhook 格式）──
app.post("/chatwoot-webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body || {};

    // Agent Bot 格式：直接送 message 物件，沒有 event 欄位
    // 一般 Webhook 格式：有 event: "message_created"
    const isAgentBot = !body.event && body.conversation_id !== undefined;
    const isRegularWebhook = body.event === "message_created";
    if (!isAgentBot && !isRegularWebhook) return;

    const msgType = body.message_type;
    const conversationId = body.conversation_id || body.conversation?.id;
    if (!conversationId) return;

    // 訪客以外送出的訊息（outgoing）：判斷是不是我們自己剛貼的 AI 回覆
    if (msgType === 1 || msgType === "outgoing") {
      const msgId = body.id;
      if (msgId && _ourMessageIds.has(msgId)) {
        _ourMessageIds.delete(msgId); // 是我們自己的回聲，忽略
        return;
      }
      // 不是我們貼的 outgoing 訊息 = 你親自在 Chatwoot 打字回覆了，接手 30 分鐘
      _humanActiveUntil.set(conversationId, Date.now() + HUMAN_TAKEOVER_WINDOW_MS);
      console.log(`[chatwoot-webhook] Human reply detected on conversation ${conversationId}, AI stands down for 30min`);
      return;
    }

    // 只處理訪客訊息（incoming = 0）
    if (msgType !== 0 && msgType !== "incoming") return;

    const text = (body.content || "").trim();
    const inboxId = String(body.inbox_id || body.conversation?.inbox_id || "");
    if (!text || !inboxId) return;

    // 去重：同一 conversation 同一內容 10 秒內只處理一次
    const dedupKey = `${conversationId}:${text}`;
    if (isDuplicate(dedupKey)) {
      console.log(`[chatwoot-webhook] Duplicate suppressed: ${dedupKey}`);
      return;
    }

    // 真人接手時間窗內，AI 讓路給人工
    const takeoverUntil = _humanActiveUntil.get(conversationId);
    if (takeoverUntil && Date.now() < takeoverUntil) {
      console.log(`[chatwoot-webhook] Conversation ${conversationId} in human-takeover window, skipping AI reply`);
      return;
    }

    const site = CHATWOOT_INBOX_SITE[inboxId] || DEFAULT_SITE;
    const persona = PERSONAS[site] || PERSONAS[DEFAULT_SITE];

    // 帶入對話歷史，AI 不再失憶
    const history = await chatwootHistory(conversationId);
    const messages = [...history.slice(0, -1), { role: "user", content: text }];

    const reply = await (PROVIDER === "openai"
      ? askOpenAI(persona, messages)
      : askAnthropic(persona, messages));

    const postedId = await chatwootReply(conversationId, reply);
    if (postedId) {
      _ourMessageIds.add(postedId);
      setTimeout(() => _ourMessageIds.delete(postedId), 30000);
    }
    await chatwootAssign(conversationId); // 讓對話進 App 收件匣，方便你隨時查看/接手
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
    // site 參數決定 AI 身分，對應 sites.json 的 key（找不到就 fallback 到 DEFAULT_SITE）
    const persona = PERSONAS[site] || PERSONAS[DEFAULT_SITE];

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

// widget.js route
app.get("/widget.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(path.join(__dirname, "widget.js"));
});

app.listen(PORT, () =>
  console.log(`✅ AI chat service on :${PORT} (${PROVIDER}: ${PROVIDER === "openai" ? OPENAI_MODEL : ANTHROPIC_MODEL})`)
);
