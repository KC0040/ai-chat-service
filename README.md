# AI 聊天服務 — NEX + AEGIS 共用

一個服務，兩個網站共用。Claude API 代理 + 知識庫。

## EasyPanel 部署（5 分鐘）

1. EasyPanel → 新增 Service → 類型選 **App**
2. Source：上傳此資料夾（或推到 GitHub 後連結 repo）
3. Build：選 **Dockerfile**
4. **Environment Variables** 加入：
   ```
   ANTHROPIC_API_KEY=（你的 sk-ant-... 金鑰）
   ```
5. Port mapping：3000
6. Deploy → 記下服務網址，例如 `https://ai-chat.xxx.easypanel.host`

## 驗證

```
curl https://你的網址/health
→ {"ok":true,"model":"claude-haiku-4-5-20251001"}
```

## 接上兩個網站

### NEXAutogear（靜態 HTML）
把 `widget.js` 上傳到 `/public_html/js/widget.js`，每頁 `</body>` 前加：

```html
<script>window.NEX_CHAT = { endpoint: "https://你的easypanel網址/chat" };</script>
<script src="/js/widget.js" defer></script>
```

### AegisRim（Next.js）
部署平台（Vercel/主機）環境變數加：

```
NEXT_PUBLIC_AI_ENDPOINT=https://你的easypanel網址/chat
```

AiConcierge 元件會自動切換成真 AI（未設定時用內建知識庫 fallback）。

## 安全設計

- API 金鑰只存在 EasyPanel 環境變數，前端完全看不到
- CORS 只允許 aegisrim.com / nexautogear.com
- 每 IP 每分鐘限 10 則（防濫用刷 API 費用）
- 訊息長度限 2000 字、回覆限 500 tokens（控制成本）

## 成本估算

模型用 Haiku 4.5（最便宜）。每則對話約 $0.002，每月 1 萬則對話 ≈ $20。
要更聰明可改環境變數 `AI_MODEL=claude-sonnet-4-6`（約 6 倍價）。
