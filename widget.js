/**
 * NEX AI 聊天 Widget — 貼在任何頁面 </body> 前：
 *   <script>window.NEX_CHAT = { endpoint: "https://你的easypanel網址/chat" };</script>
 *   <script src="/js/widget.js" defer></script>
 */
(function () {
  var cfg = window.NEX_CHAT || {};
  var ENDPOINT = cfg.endpoint || "";
  var ACCENT = cfg.accentColor || "#ffd165";
  var BOT = cfg.botName || "NEX";
  var SITE = cfg.site || "nexautogear";
  var history = [];

  // ── 樣式 ──
  var css =
    "#nexw-btn{position:fixed;bottom:24px;right:24px;z-index:9999;width:56px;height:56px;border:none;cursor:pointer;background:" + ACCENT + ";color:#1a1a1a;display:flex;align-items:center;justify-content:center;border-radius:50%;box-shadow:0 4px 24px rgba(255,209,101,.35);transition:transform .2s}" +
    "#nexw-btn:hover{transform:scale(1.08)}" +
    "#nexw-panel{position:fixed;bottom:96px;right:24px;z-index:9999;width:360px;max-width:calc(100vw - 32px);height:480px;background:#16161a;border:1px solid #2c2c30;border-radius:12px;display:none;flex-direction:column;overflow:hidden;font-family:Inter,system-ui,sans-serif;box-shadow:0 12px 48px rgba(0,0,0,.5)}" +
    "#nexw-panel.open{display:flex}" +
    "#nexw-head{background:#1e1e23;border-bottom:1px solid #2c2c30;padding:14px 18px;display:flex;align-items:center;gap:10px}" +
    "#nexw-head .dot{width:8px;height:8px;border-radius:50%;background:#2ed573}" +
    "#nexw-head b{color:#f5f0e6;font-size:13px;letter-spacing:.08em;text-transform:uppercase}" +
    "#nexw-head span{color:#8a8a90;font-size:11px;display:block}" +
    "#nexw-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}" +
    ".nexw-m{max-width:85%;padding:9px 13px;font-size:13px;line-height:1.55;border-radius:10px;white-space:pre-wrap}" +
    ".nexw-m.user{align-self:flex-end;background:" + ACCENT + ";color:#1a1a1a}" +
    ".nexw-m.bot{align-self:flex-start;background:#222227;color:#d7d2c7;border:1px solid #2c2c30}" +
    "#nexw-in{border-top:1px solid #2c2c30;padding:10px;display:flex;gap:8px}" +
    "#nexw-in input{flex:1;background:#1e1e23;border:1px solid #2c2c30;color:#f5f0e6;font-size:13px;padding:9px 12px;border-radius:8px;outline:none}" +
    "#nexw-in input:focus{border-color:" + ACCENT + "}" +
    "#nexw-in button{background:" + ACCENT + ";border:none;color:#1a1a1a;font-size:11px;font-weight:700;letter-spacing:.08em;padding:0 16px;cursor:pointer;border-radius:8px}" +
    "@media(max-width:480px){#nexw-panel{height:70vh;bottom:88px}}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ── DOM ──
  var btn = document.createElement("button");
  btn.id = "nexw-btn";
  btn.setAttribute("aria-label", "Chat with " + BOT);
  btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';

  var panel = document.createElement("div");
  panel.id = "nexw-panel";
  panel.innerHTML =
    '<div id="nexw-head"><span class="dot"></span><div><b>' + BOT + ' Assistant</b><span>B2B wheels &amp; TPMS specialist · AI</span></div></div>' +
    '<div id="nexw-msgs"></div>' +
    '<div id="nexw-in"><input type="text" placeholder="Ask about MOQ, pricing tiers, TPMS…" /><button>SEND</button></div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var msgs = panel.querySelector("#nexw-msgs");
  var input = panel.querySelector("input");
  var send = panel.querySelector("#nexw-in button");

  function add(role, text) {
    var d = document.createElement("div");
    d.className = "nexw-m " + (role === "user" ? "user" : "bot");
    d.textContent = text;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }

  add("bot", "Welcome to NEX AUTO GEAR. Ask me about wholesale pricing tiers, MOQ, TPMS compatibility, or our B2B program.");

  btn.addEventListener("click", function () {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) input.focus();
  });

  var busy = false;
  function submit() {
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    add("user", text);
    history.push({ role: "user", text: text });
    busy = true;
    var thinking = add("bot", "···");

    if (!ENDPOINT) {
      thinking.textContent = "Chat service is being configured. Please email Sales@nexautogear.com — we respond within 1 business day.";
      busy = false;
      return;
    }

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, site: SITE, history: history.slice(-12) }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var reply = data.reply || data.error || "Sorry, please try again.";
        thinking.textContent = reply;
        history.push({ role: "assistant", text: reply });
      })
      .catch(function () {
        thinking.textContent = "Connection issue — please email Sales@nexautogear.com.";
      })
      .finally(function () { busy = false; });
  }

  send.addEventListener("click", submit);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
})();
