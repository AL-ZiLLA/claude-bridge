#!/usr/bin/env node

// Claude Bridge Agent v3.1
// Auto-execute, command completion, Win+Shift+S screenshot capture

const { WebSocketServer } = require("ws");
const pty = require("node-pty");
const os = require("os");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── Config ──────────────────────────────────────────────────
const PORT = parseInt(process.env.BRIDGE_PORT) || 9876;
const SHELL =
  os.platform() === "win32"
    ? process.env.COMSPEC || "cmd.exe"
    : process.env.SHELL || "/bin/bash";
const IDLE_TIMEOUT = 2000;

// ── State ───────────────────────────────────────────────────
let clients = new Set();
let ptyProcess = null;
let commandOutput = "";
let isRunning = false;
let commandTimer = null;

// Error patterns
const ERROR_PATTERNS = [
  /Error:/i,
  /ERR!/,
  /ENOENT/,
  /EACCES/,
  /EADDRINUSE/,
  /SyntaxError/,
  /TypeError/,
  /ReferenceError/,
  /ModuleNotFoundError/,
  /Traceback/,
  /FAILED/,
  /npm ERR/,
  /command not found/,
  /Permission denied/,
  /Cannot find module/,
  /FATAL/,
];

// ── Terminal ────────────────────────────────────────────────
function startTerminal() {
  const cwd = process.cwd();
  console.log(`\x1b[90m  Shell: ${SHELL}\x1b[0m`);
  console.log(`\x1b[90m  CWD:   ${cwd}\x1b[0m`);

  ptyProcess = pty.spawn(SHELL, [], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: cwd,
    env: { ...process.env, TERM: "xterm-256color" },
  });

  ptyProcess.onData((data) => {
    broadcast({ type: "output", text: data });

    if (isRunning) {
      commandOutput += data;
      clearTimeout(commandTimer);
      commandTimer = setTimeout(onCommandComplete, IDLE_TIMEOUT);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`\x1b[33m⚠ Terminal exited (${exitCode})\x1b[0m`);
    ptyProcess = null;
  });
}

function onCommandComplete() {
  isRunning = false;
  const clean = commandOutput.replace(/\x1b\[[0-9;]*m/g, "").trim();

  let hasError = false;
  for (const p of ERROR_PATTERNS) {
    if (p.test(clean)) {
      hasError = true;
      break;
    }
  }

  console.log(
    hasError
      ? `\x1b[31m  ✗ Finished with errors\x1b[0m`
      : `\x1b[32m  ✓ Finished OK\x1b[0m`
  );

  broadcast({
    type: "command_complete",
    output: clean,
    exitCode: hasError ? 1 : 0,
    hasError,
  });

  if (hasError) {
    broadcast({ type: "error_detected", output: clean });
  }

  commandOutput = "";
}

// ── WebSocket Server ────────────────────────────────────────
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`\x1b[32m✓ Extension connected\x1b[0m (${clients.size})`);
  ws.send(JSON.stringify({ type: "connected", port: PORT }));

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type === "prompt") {
        const prompt = data.text;
        const autoExec = data.autoExecute !== false;

        console.log(`\x1b[36m→ Prompt (${prompt.length} chars)\x1b[0m`);
        console.log(`\x1b[90m  ${prompt.substring(0, 80)}${prompt.length > 80 ? "..." : ""}\x1b[0m`);

        if (ptyProcess) {
          commandOutput = "";
          isRunning = true;
          clearTimeout(commandTimer);

          if (autoExec) {
            ptyProcess.write(prompt + "\n");
            console.log(`\x1b[32m  ⚡ Auto-executing\x1b[0m`);
          } else {
            ptyProcess.write(prompt);
            console.log(`\x1b[32m  ✓ Sent (awaiting Enter)\x1b[0m`);
          }

          commandTimer = setTimeout(onCommandComplete, IDLE_TIMEOUT);
          ws.send(JSON.stringify({ type: "ack", status: "sent" }));
        } else {
          ws.send(JSON.stringify({ type: "error", message: "No terminal" }));
        }
      }

      if (data.type === "screenshot_request") {
        console.log(`\x1b[36m→ Screenshot requested\x1b[0m`);
        captureScreenshot(ws);
      }

      if (data.type === "capture_ready") {
        console.log(`\x1b[36m→ Capture mode active\x1b[0m`);
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

// ── Screenshot (Win+Shift+S) ────────────────────────────────
function captureScreenshot(ws) {
  try {
    const tmpFile = path.join(os.tmpdir(), `cb-screenshot-${Date.now()}.png`);
    const platform = os.platform();

    if (platform === "win32") {
      // Trigger Win+Shift+S (Snip & Sketch)
      execSync(
        `powershell -NoProfile -Command "Start-Process 'ms-screenclip:'"`,
        { timeout: 5000, windowsHide: true }
      );

      console.log(`\x1b[36m  📸 Snipping tool opened — waiting for capture...\x1b[0m`);

      // Poll clipboard for image data (every 500ms, up to 15 seconds)
      const pollScript = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "Add-Type -AssemblyName System.Drawing",
        "$timeout = 30",
        "$elapsed = 0",
        "while ($elapsed -lt $timeout) {",
        "  Start-Sleep -Milliseconds 500",
        "  $elapsed++",
        "  $img = [System.Windows.Forms.Clipboard]::GetImage()",
        "  if ($img -ne $null) {",
        `    $img.Save('${tmpFile.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
        "    Write-Output 'OK'",
        "    exit 0",
        "  }",
        "}",
        "Write-Output 'TIMEOUT'",
      ].join("; ");

      const result = execSync(`powershell -NoProfile -Command "${pollScript}"`, {
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
        console.log(`\x1b[32m  ✓ Screenshot captured and sent\x1b[0m`);

        // Auto-paste: simulate Ctrl+V after a short delay
        setTimeout(() => {
          try {
            execSync(
              `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 500; [System.Windows.Forms.SendKeys]::SendWait('^v')"`,
              { timeout: 5000, windowsHide: true }
            );
            console.log(`\x1b[32m  ✓ Auto-pasted to chat\x1b[0m`);
          } catch (e) {}
        }, 1000);

        fs.unlinkSync(tmpFile);
      } else {
        console.log(`\x1b[33m  ⚠ Snip timed out or cancelled\x1b[0m`);
        ws.send(JSON.stringify({ type: "error", message: "Snip cancelled or timed out" }));
      }
    } else if (platform === "darwin") {
      // macOS: interactive screenshot
      execSync(`screencapture -i "${tmpFile}"`, { timeout: 30000 });

      if (fs.existsSync(tmpFile)) {
        const imageData = fs.readFileSync(tmpFile);
        const base64 = imageData.toString("base64");
        const dataUrl = `data:image/png;base64,${base64}`;

        ws.send(JSON.stringify({ type: "screenshot", dataUrl, source: "screencapture" }));
        console.log(`\x1b[32m  ✓ Screenshot captured and sent\x1b[0m`);

        fs.unlinkSync(tmpFile);
      }
    } else {
      // Linux fallback
      execSync(`scrot -s "${tmpFile}" 2>/dev/null || import "${tmpFile}"`, { timeout: 30000 });

      if (fs.existsSync(tmpFile)) {
        const imageData = fs.readFileSync(tmpFile);
        const base64 = imageData.toString("base64");
        const dataUrl = `data:image/png;base64,${base64}`;

        ws.send(JSON.stringify({ type: "screenshot", dataUrl, source: "scrot" }));
        console.log(`\x1b[32m  ✓ Screenshot captured and sent\x1b[0m`);

        fs.unlinkSync(tmpFile);
      }
    }
  } catch (e) {
    console.log(`\x1b[33m  ⚠ Screenshot failed: ${e.message}\x1b[0m`);
    ws.send(JSON.stringify({ type: "error", message: "Screenshot failed" }));
  }
}

// ── Broadcast ───────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach((c) => {
    if (c.readyState === 1) c.send(msg);
  });
}

// ── Startup ─────────────────────────────────────────────────
console.log("");
console.log("\x1b[1m  🌉 Claude Bridge v3.1\x1b[0m");
console.log("\x1b[90m  ───────────────────────────\x1b[0m");
console.log(`\x1b[90m  Port: ${PORT}\x1b[0m`);
startTerminal();
console.log("\x1b[90m  ───────────────────────────\x1b[0m");
console.log("\x1b[90m  ⚡ Auto-execute\x1b[0m");
console.log("\x1b[90m  💬 Manual feedback\x1b[0m");
console.log("\x1b[90m  📸 Win+Shift+S capture\x1b[0m");
console.log("\x1b[90m  ───────────────────────────\x1b[0m");
console.log("\x1b[32m  ✓ Ready\x1b[0m");
console.log("");

// ── Cleanup ─────────────────────────────────────────────────
process.on("SIGINT", () => {
  console.log("\n\x1b[33mShutting down...\x1b[0m");
  if (ptyProcess) ptyProcess.kill();
  wss.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (ptyProcess) ptyProcess.kill();
  wss.close();
  process.exit(0);
});
