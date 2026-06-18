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
