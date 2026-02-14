// Claude Bridge v5 - Content Script
// Named PTY sessions, direct write, output panel

(function () {
  "use strict";

  const WS_URL = "ws://localhost:9876";
  let ws = null;
  let isConnected = false;
  let reconnectTimer = null;
  let autoExecute = true;
  let sessions = [];
  let activeSessionId = null;
  const RECONNECT_DELAY = 3000;

  // ── WebSocket ─────────────────────────────────────────────
  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        isConnected = true;
        clearTimeout(reconnectTimer);
        updateAllButtonStates();
        updateBadge(true);
        updateStatusBar(true);
      };

      ws.onclose = () => {
        isConnected = false;
        updateAllButtonStates();
        updateBadge(false);
        updateStatusBar(false);
        scheduleReconnect();
      };

      ws.onerror = () => {
        isConnected = false;
        updateAllButtonStates();
        updateBadge(false);
        updateStatusBar(false);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "sessions") {
            sessions = data.sessions || [];
            activeSessionId = data.activeId;
            updateSessionDropdown();
          }

          if (data.type === "session_selected") {
            activeSessionId = data.activeId;
            updateSessionDropdown();
          }

          if (data.type === "ack") {
            updateRunningButtons();
            showToast(`⚡ Sent to ${data.sessionName || "terminal"}`, "success");
          }

          if (data.type === "output") {
            appendToOutputPanel(data.text, data.sessionName);
          }

          if (data.type === "command_complete") {
            updateRunningButtons();
            flashSendToChat();
          }

          if (data.type === "error_detected") {
            showToast(`⚠️ Error in ${data.sessionId ? "terminal" : ""}`, "warning");
            flashSendToChat();
          }

          if (data.type === "error") {
            showToast(data.message || "Error", "error");
            updateRunningButtons();
          }

          if (data.type === "screenshot") {
            showToast("📸 Screenshot ready", "success");
          }
        } catch (e) {}
      };
    } catch (e) {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWebSocket, RECONNECT_DELAY);
  }

  function updateBadge(connected) {
    try { chrome.runtime.sendMessage({ type: "status", connected }); } catch (e) {}
  }

  // ── Chat Helpers ──────────────────────────────────────────
  function findChatInput() {
    const selectors = [
      'div.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"]',
      'div[contenteditable]',
      'textarea',
      '.ProseMirror',
    ];
    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      for (const el of elements) {
        if (el.offsetHeight > 20 && el.offsetWidth > 0) return el;
      }
    }
    return null;
  }

  function pasteTextToChat(text) {
    const chatInput = findChatInput();
    if (!chatInput) {
      showToast("Couldn't find chat input", "warning");
      return false;
    }
    chatInput.focus();
    if (chatInput.tagName === "TEXTAREA") {
      chatInput.value = text;
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      if (chatInput.textContent.trim() === "") chatInput.innerHTML = "";
      document.execCommand("insertText", false, text);
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  }

  function truncateOutput(text, maxLen) {
    if (text.length <= maxLen) return text;
    const half = Math.floor(maxLen / 2);
    return text.substring(0, half) + "\n\n... (truncated) ...\n\n" + text.substring(text.length - half);
  }

  // ── Code Block Buttons ────────────────────────────────────
  function createBridgeButton(codeBlock) {
    if (codeBlock.closest(".claude-bridge-processed")) return;
    const wrapper = codeBlock.closest("pre") || codeBlock;
    wrapper.classList.add("claude-bridge-processed");

    const btnContainer = document.createElement("div");
    btnContainer.className = "cb-btn-container";

    const sendBtn = document.createElement("button");
    sendBtn.className = "cb-send-btn";
    sendBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      <span class="cb-btn-text">Send & Run</span>
    `;
    if (!isConnected) sendBtn.classList.add("cb-disconnected");

    sendBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = codeBlock.textContent.trim();
      if (!text || !isConnected) {
        showToast(isConnected ? "Empty block" : "Bridge not connected", "warning");
        return;
      }
      if (!activeSessionId) {
        showToast("⚠️ No terminal session — create one from the + button", "warning");
        return;
      }

      ws.send(JSON.stringify({
        type: "prompt",
        text,
        autoExecute,
        sessionId: activeSessionId,
      }));

      sendBtn.classList.add("cb-running");
      sendBtn.querySelector(".cb-btn-text").textContent = "⚡ Running...";
      setTimeout(() => {
        if (sendBtn.classList.contains("cb-running")) {
          sendBtn.classList.remove("cb-running");
          sendBtn.querySelector(".cb-btn-text").textContent = "Send & Run";
        }
      }, 15000);

      chrome.storage.local.get(["sentCount"], (r) => {
        chrome.storage.local.set({ sentCount: (r.sentCount || 0) + 1 });
      });
    });

    const copyBtn = document.createElement("button");
    copyBtn.className = "cb-copy-btn";
    copyBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span class="cb-btn-text">Copy</span>
    `;
    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(codeBlock.textContent.trim()).then(() => {
        copyBtn.querySelector(".cb-btn-text").textContent = "✅ Copied";
        setTimeout(() => { copyBtn.querySelector(".cb-btn-text").textContent = "Copy"; }, 1500);
      });
    });

    btnContainer.appendChild(copyBtn);
    btnContainer.appendChild(sendBtn);
    const parent = wrapper.parentElement;
    if (parent) { parent.style.position = "relative"; parent.appendChild(btnContainer); }
    else { wrapper.style.position = "relative"; wrapper.appendChild(btnContainer); }
  }

  function updateAllButtonStates() {
    document.querySelectorAll(".cb-send-btn").forEach((btn) => {
      btn.classList.toggle("cb-disconnected", !isConnected);
    });
  }

  function updateRunningButtons() {
    document.querySelectorAll(".cb-send-btn.cb-running").forEach((btn) => {
      btn.classList.remove("cb-running");
      btn.classList.add("cb-done");
      btn.querySelector(".cb-btn-text").textContent = "✅ Done";
      setTimeout(() => {
        btn.classList.remove("cb-done");
        btn.querySelector(".cb-btn-text").textContent = "Send & Run";
      }, 2000);
    });
  }

  // ── Status Bar ────────────────────────────────────────────
  function createStatusBar() {
    const bar = document.createElement("div");
    bar.id = "cb-status-bar";
    bar.className = "cb-status-bar";
    bar.innerHTML = `
      <div class="cb-status-left">
        <span class="cb-status-icon">🌉</span>
        <span class="cb-status-dot" id="cbStatusDot"></span>
        <span class="cb-status-text" id="cbStatusText">Disconnected</span>
      </div>
      <div class="cb-status-center">
        <div class="cb-session-selector">
          <select id="cbSessionSelect" title="Select terminal session">
            <option value="">— No Sessions —</option>
          </select>
          <button class="cb-action-btn cb-add-btn" id="cbAddSession" title="Create new terminal session">+</button>
        </div>
      </div>
      <div class="cb-status-right">
        <label class="cb-toggle-label" title="Auto-execute">
          <span>Auto-Run</span>
          <input type="checkbox" id="cbAutoExec" ${autoExecute ? "checked" : ""}>
          <span class="cb-toggle-slider"></span>
        </label>
        <button class="cb-action-btn" id="cbScreenshotBtn" title="Screenshot">📸</button>
        <button class="cb-action-btn cb-minimize-btn" id="cbMinimize" title="Minimize">─</button>
      </div>
    `;
    document.body.appendChild(bar);

    // Session selector
    document.getElementById("cbSessionSelect").addEventListener("change", (e) => {
      if (e.target.value && ws && isConnected) {
        activeSessionId = e.target.value;
        ws.send(JSON.stringify({ type: "select_session", sessionId: activeSessionId }));
        const s = sessions.find((s) => s.id === activeSessionId);
        showToast(`📂 Active: ${s ? s.name : "terminal"}`, "success");
      }
    });

    // Add session
    document.getElementById("cbAddSession").addEventListener("click", () => {
      if (!isConnected) { showToast("Not connected", "warning"); return; }
      const name = prompt("Session name:", `Terminal ${sessions.length + 1}`);
      if (name) {
        const cwd = prompt("Working directory (leave empty for home):", "");
        ws.send(JSON.stringify({ type: "create_session", name, cwd: cwd || undefined }));
        showToast(`+ Created session: ${name}`, "success");
      }
    });

    // Auto-Run
    document.getElementById("cbAutoExec").addEventListener("change", (e) => {
      autoExecute = e.target.checked;
      chrome.storage.local.set({ autoExecute });
      showToast(autoExecute ? "⚡ Auto-Run ON" : "🛑 Auto-Run OFF", "info");
    });

    // Screenshot
    document.getElementById("cbScreenshotBtn").addEventListener("click", () => {
      if (!isConnected) { showToast("Not connected", "warning"); return; }
      ws.send(JSON.stringify({ type: "screenshot_request" }));
      showToast("📸 Opening snip tool...", "info");
    });

    // Minimize
    let minimized = false;
    document.getElementById("cbMinimize").addEventListener("click", () => {
      minimized = !minimized;
      bar.classList.toggle("cb-status-minimized", minimized);
    });

    chrome.storage.local.get(["autoExecute"], (r) => {
      if (r.autoExecute !== undefined) {
        autoExecute = r.autoExecute;
        document.getElementById("cbAutoExec").checked = autoExecute;
      }
    });
  }

  function updateStatusBar(connected) {
    const dot = document.getElementById("cbStatusDot");
    const text = document.getElementById("cbStatusText");
    if (dot && text) {
      dot.className = connected ? "cb-status-dot cb-dot-connected" : "cb-status-dot cb-dot-disconnected";
      text.textContent = connected ? "Connected" : "Disconnected";
      text.style.color = connected ? "#4ade80" : "#f87171";
    }
  }

  function updateSessionDropdown() {
    const select = document.getElementById("cbSessionSelect");
    if (!select) return;

    select.innerHTML = sessions.length === 0
      ? '<option value="">— No Sessions —</option>'
      : "";

    sessions.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      opt.title = s.cwd;
      if (s.id === activeSessionId) opt.selected = true;
      select.appendChild(opt);
    });

    select.classList.toggle("cb-session-active", !!activeSessionId);
  }

  // ── Output Panel ──────────────────────────────────────────
  function createOutputPanel() {
    const panel = document.createElement("div");
    panel.id = "cb-output-panel";
    panel.className = "cb-output-panel cb-output-collapsed";
    panel.innerHTML = `
      <div class="cb-output-header" id="cbOutputHeader">
        <span>🖥️ Terminal Output</span>
        <div class="cb-output-actions">
          <button class="cb-output-action cb-send-to-chat-btn" id="cbOutputFeed" title="Send to chat">💬 Send to Chat</button>
          <button class="cb-output-action" id="cbOutputCopy" title="Copy">📋</button>
          <button class="cb-output-action" id="cbOutputClear" title="Clear">🗑️</button>
          <button class="cb-output-toggle" id="cbOutputToggle">▲</button>
        </div>
      </div>
      <pre class="cb-output-content" id="cbOutputContent"></pre>
    `;
    document.body.appendChild(panel);

    document.getElementById("cbOutputHeader").addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      toggleOutputPanel();
    });
    document.getElementById("cbOutputToggle").addEventListener("click", toggleOutputPanel);

    document.getElementById("cbOutputFeed").addEventListener("click", () => {
      const content = document.getElementById("cbOutputContent").textContent.trim();
      if (!content) { showToast("No output", "info"); return; }
      const formatted = "Here's the terminal output:\n\n```\n" + truncateOutput(content, 3000) + "\n```\n\nCan you check this?";
      if (pasteTextToChat(formatted)) {
        showToast("📋 Output pasted — review and send", "success");
      }
    });

    document.getElementById("cbOutputCopy").addEventListener("click", () => {
      navigator.clipboard.writeText(document.getElementById("cbOutputContent").textContent);
      showToast("Copied", "success");
    });

    document.getElementById("cbOutputClear").addEventListener("click", () => {
      document.getElementById("cbOutputContent").textContent = "";
    });
  }

  function toggleOutputPanel() {
    const panel = document.getElementById("cb-output-panel");
    const toggle = document.getElementById("cbOutputToggle");
    panel.classList.toggle("cb-output-collapsed");
    toggle.textContent = panel.classList.contains("cb-output-collapsed") ? "▲" : "▼";
  }

  function appendToOutputPanel(text, sessionName) {
    const content = document.getElementById("cbOutputContent");
    if (content) {
      content.textContent += text.replace(/\x1b\[[0-9;]*m/g, "");
      content.scrollTop = content.scrollHeight;
    }
  }

  function flashSendToChat() {
    const btn = document.getElementById("cbOutputFeed");
    if (btn) {
      btn.classList.add("cb-flash");
      setTimeout(() => btn.classList.remove("cb-flash"), 3000);
    }
  }

  // ── Toast ─────────────────────────────────────────────────
  function showToast(message, type = "info") {
    const existing = document.querySelector(".cb-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = `cb-toast cb-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("cb-toast-show"));
    setTimeout(() => {
      toast.classList.remove("cb-toast-show");
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ── DOM Observer ──────────────────────────────────────────
  function scanForCodeBlocks() {
    document.querySelectorAll('pre code:not(.claude-bridge-scanned)').forEach((block) => {
      block.classList.add("claude-bridge-scanned");
      createBridgeButton(block);
    });
    document.querySelectorAll("pre:not(.claude-bridge-processed)").forEach((pre) => {
      if (pre.querySelector("code") || pre.textContent.trim().length > 20) {
        const code = pre.querySelector("code") || pre;
        if (!code.classList.contains("claude-bridge-scanned")) {
          code.classList.add("claude-bridge-scanned");
          createBridgeButton(code);
        }
      }
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        clearTimeout(observer._t);
        observer._t = setTimeout(scanForCodeBlocks, 500);
        break;
      }
    }
  });

  // ── Init ──────────────────────────────────────────────────
  function init() {
    console.log("[Claude Bridge v5] Loaded");
    createStatusBar();
    createOutputPanel();
    connectWebSocket();
    setTimeout(scanForCodeBlocks, 1000);
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(scanForCodeBlocks, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
