// Claude Bridge v3 - Content Script
// Manual feedback, click-to-capture screenshots, compact output panel

(function () {
  "use strict";

  const WS_URL = "ws://localhost:9876";
  let ws = null;
  let isConnected = false;
  let reconnectTimer = null;
  let autoExecute = true;
  let captureMode = false;
  const RECONNECT_DELAY = 3000;

  // ── WebSocket Connection ──────────────────────────────────
  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        isConnected = true;
        clearTimeout(reconnectTimer);
        updateAllButtonStates();
        updateBadge(true);
        updateStatusBar(true);
        console.log("[Claude Bridge] Connected to agent");
      };

      ws.onclose = () => {
        isConnected = false;
        updateAllButtonStates();
        updateBadge(false);
        updateStatusBar(false);
        console.log("[Claude Bridge] Disconnected");
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

          if (data.type === "output") {
            appendToOutputPanel(data.text);
          }

          if (data.type === "command_complete") {
            updateRunningButtons();
            // Flash the "Send to Chat" button to let Al know output is ready
            flashSendToChat();
          }

          if (data.type === "error_detected") {
            showToast("⚠️ Error in terminal — check output panel", "warning");
            flashSendToChat();
          }

          if (data.type === "screenshot") {
            pasteScreenshotToChat(data.dataUrl);
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
    try {
      chrome.runtime.sendMessage({ type: "status", connected });
    } catch (e) {}
  }

  // ── Paste to Claude Chat ──────────────────────────────────
  function pasteTextToChat(text) {
    const chatInput = findChatInput();
    if (!chatInput) {
      showToast("Couldn't find chat input", "warning");
      return false;
    }
    insertTextToChat(chatInput, text);
    return true;
  }

  function pasteScreenshotToChat(dataUrl) {
    exitCaptureMode();
    showToast("📸 Pasting screenshot to chat...", "info");

    try {
      fetch(dataUrl)
        .then((res) => res.blob())
        .then((blob) => {
          const file = new File([blob], "screenshot.png", { type: "image/png" });
          const dt = new DataTransfer();
          dt.items.add(file);

          const chatInput = findChatInput();
          if (chatInput) {
            const pasteEvent = new ClipboardEvent("paste", {
              clipboardData: dt,
              bubbles: true,
            });
            chatInput.dispatchEvent(pasteEvent);
            showToast("📸 Screenshot ready — add context and send", "success");
          }
        });
    } catch (e) {
      console.log("[Claude Bridge] Screenshot paste failed:", e);
      showToast("Screenshot paste failed", "error");
    }
  }

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
        if (el.offsetHeight > 20 && el.offsetWidth > 0) {
          return el;
        }
      }
    }
    return null;
  }

  function insertTextToChat(element, text) {
    element.focus();
    if (element.tagName === "TEXTAREA") {
      element.value = text;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      if (element.textContent.trim() === "") {
        element.innerHTML = "";
      }
      document.execCommand("insertText", false, text);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function truncateOutput(text, maxLen) {
    if (text.length <= maxLen) return text;
    const half = Math.floor(maxLen / 2);
    return text.substring(0, half) + "\n\n... (truncated) ...\n\n" + text.substring(text.length - half);
  }

  // ── Screenshot Capture Mode ───────────────────────────────
  function enterCaptureMode() {
    captureMode = true;
    document.body.classList.add("cb-capture-mode");

    // Show overlay instruction
    let overlay = document.getElementById("cb-capture-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "cb-capture-overlay";
      overlay.innerHTML = `
        <div class="cb-capture-banner">
          📸 Click any browser tab to capture it — or press <strong>Esc</strong> to cancel
        </div>
      `;
      document.body.appendChild(overlay);
    }
    overlay.classList.add("cb-capture-active");

    // Listen for tab visibility change (user clicks another tab)
    document.addEventListener("visibilitychange", onTabSwitch);

    // Esc to cancel
    document.addEventListener("keydown", onCaptureKeydown);

    showToast("📸 Capture mode — click any tab", "info");

    // Tell agent to prepare for capture
    if (ws && isConnected) {
      ws.send(JSON.stringify({ type: "capture_ready" }));
    }
  }

  function exitCaptureMode() {
    captureMode = false;
    document.body.classList.remove("cb-capture-mode");

    const overlay = document.getElementById("cb-capture-overlay");
    if (overlay) overlay.classList.remove("cb-capture-active");

    document.removeEventListener("visibilitychange", onTabSwitch);
    document.removeEventListener("keydown", onCaptureKeydown);

    // Update button state
    const btn = document.getElementById("cbScreenshotBtn");
    if (btn) {
      btn.classList.remove("cb-capture-active-btn");
      btn.textContent = "📸";
    }
  }

  function onTabSwitch() {
    if (!captureMode) return;

    // User switched to another tab — tell agent to screenshot that window
    if (document.hidden && ws && isConnected) {
      ws.send(JSON.stringify({ type: "screenshot_request", trigger: "tab_switch" }));
    }
  }

  function onCaptureKeydown(e) {
    if (e.key === "Escape") {
      exitCaptureMode();
      showToast("Capture cancelled", "info");
    }
  }

  // Also allow capturing current page via right-click on screenshot btn
  function captureCurrentPage() {
    if (ws && isConnected) {
      ws.send(JSON.stringify({ type: "screenshot_request", trigger: "current_page" }));
      showToast("📸 Capturing current view...", "info");
    }
  }

  // ── Button Injection on Code Blocks ───────────────────────
  function createBridgeButton(codeBlock) {
    if (codeBlock.closest(".claude-bridge-processed")) return;

    const wrapper = codeBlock.closest("pre") || codeBlock;
    wrapper.classList.add("claude-bridge-processed");

    const btnContainer = document.createElement("div");
    btnContainer.className = "cb-btn-container";

    // Send & Run button
    const sendBtn = document.createElement("button");
    sendBtn.className = "cb-send-btn";
    sendBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      <span class="cb-btn-text">Send & Run</span>
    `;

    if (!isConnected) {
      sendBtn.classList.add("cb-disconnected");
      sendBtn.title = "Bridge agent not connected";
    }

    sendBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const text = codeBlock.textContent.trim();
      if (!text) return;

      if (!isConnected) {
        showToast("⚠️ Bridge not connected. Run: node agent/index.js", "warning");
        return;
      }

      try {
        ws.send(
          JSON.stringify({
            type: "prompt",
            text: text,
            autoExecute: autoExecute,
          })
        );

        sendBtn.classList.add("cb-running");
        sendBtn.querySelector(".cb-btn-text").textContent = "⚡ Running...";

        setTimeout(() => {
          if (sendBtn.classList.contains("cb-running")) {
            sendBtn.classList.remove("cb-running");
            sendBtn.querySelector(".cb-btn-text").textContent = "Send & Run";
          }
        }, 30000);

        showToast(autoExecute ? "⚡ Running..." : "Sent — press Enter to run", "success");

        chrome.storage.local.get(["sentCount"], (result) => {
          const count = (result.sentCount || 0) + 1;
          chrome.storage.local.set({ sentCount: count });
        });
      } catch (err) {
        showToast("❌ Failed to send", "error");
      }
    });

    // Copy button
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
      const text = codeBlock.textContent.trim();
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.querySelector(".cb-btn-text").textContent = "✅ Copied";
        setTimeout(() => {
          copyBtn.querySelector(".cb-btn-text").textContent = "Copy";
        }, 1500);
      });
    });

    btnContainer.appendChild(copyBtn);
    btnContainer.appendChild(sendBtn);

    const parent = wrapper.parentElement;
    if (parent) {
      parent.style.position = "relative";
      parent.appendChild(btnContainer);
    } else {
      wrapper.style.position = "relative";
      wrapper.appendChild(btnContainer);
    }
  }

  function updateAllButtonStates() {
    document.querySelectorAll(".cb-send-btn").forEach((btn) => {
      if (isConnected) {
        btn.classList.remove("cb-disconnected");
        btn.title = "";
      } else {
        btn.classList.add("cb-disconnected");
        btn.title = "Bridge agent not connected";
      }
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

  // ── Floating Status Bar ───────────────────────────────────
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
      <div class="cb-status-right">
        <label class="cb-toggle-label" title="Auto-execute commands (no Enter needed)">
          <span>Auto-Run</span>
          <input type="checkbox" id="cbAutoExec" ${autoExecute ? "checked" : ""}>
          <span class="cb-toggle-slider"></span>
        </label>
        <button class="cb-action-btn" id="cbScreenshotBtn" title="📸 Click, then click any tab to capture">📸</button>
        <button class="cb-action-btn cb-minimize-btn" id="cbMinimize" title="Minimize">─</button>
      </div>
    `;

    document.body.appendChild(bar);

    // Auto-Run toggle
    document.getElementById("cbAutoExec").addEventListener("change", (e) => {
      autoExecute = e.target.checked;
      chrome.storage.local.set({ autoExecute });
      showToast(autoExecute ? "⚡ Auto-Run ON" : "🛑 Auto-Run OFF", "info");
    });

    // Screenshot button — triggers Win+Shift+S via agent
    const ssBtn = document.getElementById("cbScreenshotBtn");
    ssBtn.addEventListener("click", () => {
      if (!isConnected) {
        showToast("Bridge not connected", "warning");
        return;
      }
      ws.send(JSON.stringify({ type: "screenshot_request" }));
      showToast("📸 Snipping tool opening...", "info");
    });

    // Minimize
    let minimized = false;
    document.getElementById("cbMinimize").addEventListener("click", () => {
      minimized = !minimized;
      bar.classList.toggle("cb-status-minimized", minimized);
    });

    // Load saved prefs
    chrome.storage.local.get(["autoExecute"], (result) => {
      if (result.autoExecute !== undefined) {
        autoExecute = result.autoExecute;
        document.getElementById("cbAutoExec").checked = autoExecute;
      }
    });
  }

  function updateStatusBar(connected) {
    const dot = document.getElementById("cbStatusDot");
    const text = document.getElementById("cbStatusText");
    if (dot && text) {
      if (connected) {
        dot.className = "cb-status-dot cb-dot-connected";
        text.textContent = "Connected";
        text.style.color = "#4ade80";
      } else {
        dot.className = "cb-status-dot cb-dot-disconnected";
        text.textContent = "Disconnected";
        text.style.color = "#f87171";
      }
    }
  }

  // ── Output Panel (Compact) ────────────────────────────────
  function createOutputPanel() {
    const panel = document.createElement("div");
    panel.id = "cb-output-panel";
    panel.className = "cb-output-panel cb-output-collapsed";
    panel.innerHTML = `
      <div class="cb-output-header" id="cbOutputHeader">
        <span>🖥️ Terminal Output</span>
        <div class="cb-output-actions">
          <button class="cb-output-action cb-send-to-chat-btn" id="cbOutputFeed" title="Send output to Claude chat">
            💬 Send to Chat
          </button>
          <button class="cb-output-action" id="cbOutputCopy" title="Copy output">📋</button>
          <button class="cb-output-action" id="cbOutputClear" title="Clear">🗑️</button>
          <button class="cb-output-toggle" id="cbOutputToggle">▲</button>
        </div>
      </div>
      <pre class="cb-output-content" id="cbOutputContent"></pre>
    `;

    document.body.appendChild(panel);

    // Toggle expand/collapse
    document.getElementById("cbOutputHeader").addEventListener("click", (e) => {
      // Don't toggle if clicking a button
      if (e.target.closest("button")) return;
      toggleOutputPanel();
    });

    document.getElementById("cbOutputToggle").addEventListener("click", toggleOutputPanel);

    // Send to Chat — MANUAL. Pastes output into chat input.
    document.getElementById("cbOutputFeed").addEventListener("click", () => {
      const content = document.getElementById("cbOutputContent").textContent.trim();
      if (!content) {
        showToast("No output to send", "info");
        return;
      }

      const formatted = "Here's the terminal output:\n\n```\n" + truncateOutput(content, 3000) + "\n```\n\nCan you check this?";

      if (pasteTextToChat(formatted)) {
        showToast("📋 Output pasted to chat — review and send", "success");
      }
    });

    // Copy
    document.getElementById("cbOutputCopy").addEventListener("click", () => {
      const content = document.getElementById("cbOutputContent").textContent;
      navigator.clipboard.writeText(content);
      showToast("Copied", "success");
    });

    // Clear
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

  function appendToOutputPanel(text) {
    const content = document.getElementById("cbOutputContent");
    if (content) {
      const clean = text.replace(/\x1b\[[0-9;]*m/g, "");
      content.textContent += clean;
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

  // ── Toast Notifications ───────────────────────────────────
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
    const codeBlocks = document.querySelectorAll(
      'pre code:not(.claude-bridge-scanned), [class*="code-block"] code:not(.claude-bridge-scanned)'
    );

    codeBlocks.forEach((block) => {
      block.classList.add("claude-bridge-scanned");
      createBridgeButton(block);
    });

    const preTags = document.querySelectorAll("pre:not(.claude-bridge-processed)");
    preTags.forEach((pre) => {
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
    let shouldScan = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldScan = true;
        break;
      }
    }
    if (shouldScan) {
      clearTimeout(observer._scanTimer);
      observer._scanTimer = setTimeout(scanForCodeBlocks, 500);
    }
  });

  // ── Init ──────────────────────────────────────────────────
  function init() {
    console.log("[Claude Bridge v3] Loaded");
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
