#!/usr/bin/env node

// Claude Bridge Agent v5
// Multiple named PTY sessions — direct write, no window focus needed
// Commands go straight to the selected terminal session

const { WebSocketServer } = require("ws");
const pty = require("node-pty");
const os = require("os");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── Config ──────────────────────────────────────────────────
const PORT = parseInt(process.env.BRIDGE_PORT) || 9876;
const SHELL = os.platform() === "win32"
  ? "C:\\Program Files\\Git\\bin\\bash.exe"
  : process.env.SHELL || "/bin/bash";
const IDLE_TIMEOUT = 2000;

// ── State ───────────────────────────────────────────────────
let clients = new Set();
let sessions = {}; // { id: { name, pty, cwd, output, isRunning } }
let activeSessionId = null;
let sessionCounter = 0;

// Error patterns
const ERROR_PATTERNS = [
  /Error:/i, /ERR!/, /ENOENT/, /EACCES/, /EADDRINUSE/,
  /SyntaxError/, /TypeError/, /ReferenceError/,
  /ModuleNotFoundError/, /Traceback/, /FAILED/,
  /npm ERR/, /command not found/, /Permission denied/,
  /Cannot find module/, /FATAL/,
];

// ── Session Management ──────────────────────────────────────
function createSession(name, cwd) {
  const id = `session_${++sessionCounter}`;
  const sessionCwd = cwd || process.cwd();

  console.log(`\x1b[32m+ Creating session: ${name} (${sessionCwd})\x1b[0m`);

  const ptyProcess = pty.spawn(SHELL, ["--login", "-i"], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: sessionCwd,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  const session = {
    id,
    name,
    pty: ptyProcess,
    cwd: sessionCwd,
    output: "",
    commandOutput: "",
    isRunning: false,
    commandTimer: null,
  };

  ptyProcess.onData((data) => {
    // Send live output to extension
    broadcast({
      type: "output",
      text: data,
      sessionId: id,
      sessionName: name,
    });

    // Track command output
    if (session.isRunning) {
      session.commandOutput += data;
      clearTimeout(session.commandTimer);
      session.commandTimer = setTimeout(() => {
        onCommandComplete(session);
      }, IDLE_TIMEOUT);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`\x1b[33m⚠ Session "${name}" exited (${exitCode})\x1b[0m`);
    delete sessions[id];
    broadcastSessionList();
  });

  sessions[id] = session;

  // Auto-select if first session
  if (!activeSessionId) {
    activeSessionId = id;
  }

  broadcastSessionList();
  return session;
}

function removeSession(id) {
  const session = sessions[id];
  if (session) {
    console.log(`\x1b[33m- Removing session: ${session.name}\x1b[0m`);
    session.pty.kill();
    delete sessions[id];
    if (activeSessionId === id) {
      const remaining = Object.keys(sessions);
      activeSessionId = remaining.length > 0 ? remaining[0] : null;
    }
    broadcastSessionList();
  }
}

function onCommandComplete(session) {
  session.isRunning = false;
  const clean = session.commandOutput.replace(/\x1b\[[0-9;]*m/g, "").trim();

  let hasError = false;
  for (const p of ERROR_PATTERNS) {
    if (p.test(clean)) {
      hasError = true;
      break;
    }
  }

  console.log(
    hasError
      ? `\x1b[31m  ✗ [${session.name}] Finished with errors\x1b[0m`
      : `\x1b[32m  ✓ [${session.name}] Finished OK\x1b[0m`
  );

  broadcast({
    type: "command_complete",
    sessionId: session.id,
    sessionName: session.name,
    output: clean,
    exitCode: hasError ? 1 : 0,
    hasError,
  });

  if (hasError) {
    broadcast({
      type: "error_detected",
      sessionId: session.id,
      output: clean,
    });
  }

  session.commandOutput = "";
}

function broadcastSessionList() {
  const list = Object.values(sessions).map((s) => ({
    id: s.id,
    name: s.name,
    cwd: s.cwd,
  }));

  broadcast({
    type: "sessions",
    sessions: list,
    activeId: activeSessionId,
  });
}

// ── Screenshot ──────────────────────────────────────────────
function captureScreenshot(ws) {
  try {
    const tmpFile = path.join(os.tmpdir(), `cb-screenshot-${Date.now()}.png`);

    execSync(`powershell -NoProfile -Command "Start-Process 'ms-screenclip:'"`, {
      timeout: 5000,
      windowsHide: true,
    });

    console.log(`\x1b[36m  📸 Snipping tool opened — waiting...\x1b[0m`);

    const tmpPoll = path.join(os.tmpdir(), "cb-poll.ps1");
    fs.writeFileSync(tmpPoll, `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$timeout = 30
$elapsed = 0
while ($elapsed -lt $timeout) {
  Start-Sleep -Milliseconds 500
  $elapsed++
  $img = [System.Windows.Forms.Clipboard]::GetImage()
  if ($img -ne $null) {
    $img.Save('${tmpFile.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output 'OK'
    exit 0
  }
}
Write-Output 'TIMEOUT'
`);

    const result = execSync(`powershell -NoProfile -File "${tmpPoll}"`, {
      timeout: 20000,
      windowsHide: true,
    })
      .toString()
      .trim();

    if (result === "OK" && fs.existsSync(tmpFile)) {
      const imageData = fs.readFileSync(tmpFile);
      const base64 = imageData.toString("base64");
      const dataUrl = `data:image/png;base64,${base64}`;

      ws.send(JSON.stringify({ type: "screenshot", dataUrl, source: "snip" }));
      console.log(`\x1b[32m  ✓ Screenshot captured\x1b[0m`);

      // Auto-paste
      setTimeout(() => {
        try {
          const tmpPaste = path.join(os.tmpdir(), "cb-paste.ps1");
          fs.writeFileSync(tmpPaste, `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait('^v')
`);
          execSync(`powershell -NoProfile -File "${tmpPaste}"`, {
            timeout: 5000,
            windowsHide: true,
          });
          console.log(`\x1b[32m  ✓ Auto-pasted\x1b[0m`);
        } catch (e) {}
      }, 1000);

      fs.unlinkSync(tmpFile);
    } else {
      console.log(`\x1b[33m  ⚠ Snip timed out\x1b[0m`);
      ws.send(JSON.stringify({ type: "error", message: "Snip cancelled or timed out" }));
    }
  } catch (e) {
    console.log(`\x1b[33m  ⚠ Screenshot failed: ${e.message}\x1b[0m`);
    ws.send(JSON.stringify({ type: "error", message: "Screenshot failed" }));
  }
}

// ── WebSocket Server ────────────────────────────────────────
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`\x1b[32m✓ Extension connected\x1b[0m (${clients.size})`);
  ws.send(JSON.stringify({ type: "connected", port: PORT }));

  // Send session list
  broadcastSessionList();

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      // ── Create new session ──
      if (data.type === "create_session") {
        const name = data.name || `Terminal ${sessionCounter + 1}`;
        const cwd = data.cwd || undefined;
        createSession(name, cwd);
      }

      // ── Remove session ──
      if (data.type === "remove_session") {
        removeSession(data.sessionId);
      }

      // ── Select active session ──
      if (data.type === "select_session") {
        activeSessionId = data.sessionId;
        const session = sessions[activeSessionId];
        console.log(`\x1b[36m→ Active: ${session ? session.name : "none"}\x1b[0m`);
        broadcast({ type: "session_selected", activeId: activeSessionId });
      }

      // ── Send prompt to active session ──
      if (data.type === "prompt") {
        const targetId = data.sessionId || activeSessionId;
        const session = sessions[targetId];
        const autoExec = data.autoExecute !== false;

        if (!session) {
          ws.send(JSON.stringify({
            type: "error",
            message: "No terminal session. Create one from the dropdown.",
          }));
          console.log(`\x1b[31m  ✗ No active session\x1b[0m`);
          return;
        }

        const prompt = data.text;
        console.log(`\x1b[36m→ [${session.name}] Prompt (${prompt.length} chars)\x1b[0m`);
        console.log(`\x1b[90m  ${prompt.substring(0, 80)}${prompt.length > 80 ? "..." : ""}\x1b[0m`);

        session.commandOutput = "";
        session.isRunning = true;
        clearTimeout(session.commandTimer);

        if (autoExec) {
          session.pty.write(prompt + "\n");
          console.log(`\x1b[32m  ⚡ [${session.name}] Auto-executing\x1b[0m`);
        } else {
          session.pty.write(prompt);
          console.log(`\x1b[32m  ✓ [${session.name}] Sent (awaiting Enter)\x1b[0m`);
        }

        session.commandTimer = setTimeout(() => {
          onCommandComplete(session);
        }, IDLE_TIMEOUT);

        ws.send(JSON.stringify({ type: "ack", status: "sent", sessionName: session.name }));
      }

      // ── Screenshot ──
      if (data.type === "screenshot_request") {
        console.log(`\x1b[36m→ Screenshot requested\x1b[0m`);
        captureScreenshot(ws);
      }

      // ── Refresh session list ──
      if (data.type === "refresh_sessions") {
        broadcastSessionList();
      }
    } catch (e) {
      console.error(`\x1b[31mParse error:\x1b[0m`, e.message);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`\x1b[33m✗ Disconnected\x1b[0m (${clients.size})`);
  });
});

wss.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\x1b[31m✗ Port ${PORT} in use\x1b[0m`);
    process.exit(1);
  }
});

// ── Broadcast ───────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach((c) => {
    if (c.readyState === 1) c.send(msg);
  });
}

// ── Startup ─────────────────────────────────────────────────
console.log("");
console.log("\x1b[1m  🌉 Claude Bridge v5\x1b[0m");
console.log("\x1b[90m  ───────────────────────────\x1b[0m");
console.log(`\x1b[90m  Port: ${PORT}\x1b[0m`);
console.log(`\x1b[90m  Shell: ${SHELL}\x1b[0m`);
console.log("\x1b[90m  ───────────────────────────\x1b[0m");
console.log("\x1b[90m  ⚡ Direct PTY (no focus needed)\x1b[0m");
console.log("\x1b[90m  📂 Multiple named sessions\x1b[0m");
console.log("\x1b[90m  📸 Snip & paste\x1b[0m");
console.log("\x1b[90m  ───────────────────────────\x1b[0m");

// Create a default session
createSession("Default", os.homedir());

console.log("\x1b[32m  ✓ Ready\x1b[0m");
console.log("\x1b[90m  Create more sessions from the extension dropdown\x1b[0m");
console.log("");

// ── Cleanup ─────────────────────────────────────────────────
process.on("SIGINT", () => {
  console.log("\n\x1b[33mShutting down...\x1b[0m");
  Object.values(sessions).forEach((s) => s.pty.kill());
  wss.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  Object.values(sessions).forEach((s) => s.pty.kill());
  wss.close();
  process.exit(0);
});
