# 🌉 Claude Bridge

**One-click code execution from Claude.ai to your terminal. No more copy/paste.**

Claude Bridge connects your Claude.ai chat directly to a local terminal. Code blocks get **Send & Run** buttons, terminal output feeds back to chat, and screenshots paste directly into conversations.

---

## What It Does

| Feature | How |
|---|---|
| ⚡ **Send & Run** | Hover any code block on claude.ai → click → auto-executes in terminal |
| 🖥️ **Terminal Output** | See live output in a panel on claude.ai, click "Send to Chat" when ready |
| 📸 **Screenshot** | Click 📸 → Windows snipping tool opens → snip any window → auto-pastes to chat |
| 🔄 **Auto-Run** | Toggle on/off — skip the Enter key confirmation |
| 🟢 **Live Status** | Connection indicator right on claude.ai |

---

## Requirements

- **Node.js** (v18 or higher) — [Download here](https://nodejs.org/)
- **Chromium browser** — Chrome, Brave, or Edge
- **Windows 10/11**, macOS, or Linux
- **Git** — [Download here](https://git-scm.com/downloads)

---

## Setup (5 minutes)

### Step 1: Clone & Install

Open a terminal (Git Bash on Windows, Terminal on Mac):

```bash
git clone https://github.com/AL-ZiLLA/claude-bridge.git
cd claude-bridge/agent
npm install
```

> ⚠️ **Windows users:** If `node-pty` fails to install, you may need to install build tools first:
> ```bash
> npm install --global windows-build-tools
> ```
> Then try `npm install` again.

### Step 2: Load the Chrome Extension

1. Open your browser and go to:
   - **Brave:** `brave://extensions`
   - **Chrome:** `chrome://extensions`
   - **Edge:** `edge://extensions`
2. Toggle **Developer Mode** ON (top right corner)
3. Click **Load unpacked**
4. Navigate to the `claude-bridge/extension/` folder and select it
5. You should see **Claude Bridge** appear in your extensions list

### Step 3: Start the Agent

Open a terminal window and run:

```bash
cd ~/claude-bridge/agent
node index.js
```

You should see:

```
  🌉 Claude Bridge v3.1
  ───────────────────────────
  ⚡ Auto-execute
  💬 Manual feedback
  📸 Win+Shift+S capture
  ───────────────────────────
  ✓ Ready
```

**Keep this terminal window open** — it's your bridge agent running in the background.

### Step 4: Go to claude.ai

1. Open [claude.ai](https://claude.ai) in your browser
2. Look for the **🌉 Connected** status bar in the top right corner
3. You're live! 🔥

---

## How to Use

### Send & Run Code

1. Ask Claude anything that generates a code block
2. Hover over the code block
3. Click **Send & Run** — it auto-executes in your terminal
4. Button shows ⚡ Running... then ✅ Done

### View Terminal Output

1. Click the **🖥️ Terminal Output** bar at the bottom of claude.ai to expand it
2. See live output from your terminal
3. Click **💬 Send to Chat** to paste the output into the chat input
4. Add context if needed, then send to Claude

### Take Screenshots

1. Click **📸** in the status bar
2. Windows Snipping Tool opens — snip any window, tab, or area
3. Screenshot auto-pastes into the Claude chat input
4. Add a question like "what's wrong here?" and send

### Controls

| Control | What it does |
|---|---|
| **Auto-Run** toggle | ON = commands execute immediately. OFF = you press Enter to confirm |
| **📸** button | Opens snipping tool for screenshots |
| **─** button | Minimize the status bar |

---

## Daily Workflow

Every time you sit down to work:

1. **Open a terminal** and start the agent:
   ```bash
   cd ~/claude-bridge/agent
   node index.js
   ```
2. **Open claude.ai** — extension connects automatically
3. **Work** — Send & Run code blocks, screenshot issues, feed output back
4. **When done** — Ctrl+C in the agent terminal to stop it

The extension stays loaded in your browser — you only set that up once.

---

## Working on a Project

Claude Bridge runs independently from your projects. Your typical setup:

- **Terminal #1:** Claude Bridge agent (running in background)
- **Terminal #2:** Your project (e.g., `cd ~/my-project && npm run dev`)
- **Browser Tab 1:** claude.ai (with bridge connected)
- **Browser Tab 2:** localhost:3000 (your app preview)

Each project has its own git repo. Claude Bridge has its own. No conflicts.

---

## Troubleshooting

### Status shows "Disconnected"
- Make sure the agent is running (`node index.js` in the agent folder)
- Refresh claude.ai (`Ctrl+Shift+R`)
- Reload the extension in `chrome://extensions` (click the 🔄 icon)

### Buttons don't appear on code blocks
- Hard refresh claude.ai: `Ctrl+Shift+R`
- Check extension is enabled in `chrome://extensions`
- Open browser DevTools (F12) → Console → look for `[Claude Bridge]` messages

### `npm install` fails on Windows
```bash
# Install Windows build tools first
npm install --global windows-build-tools

# Then retry
cd ~/claude-bridge/agent
npm install
```

### Port 9876 already in use
```bash
# Windows — find and kill the process
netstat -ano | findstr :9876
taskkill /PID <PID_NUMBER> /F

# Mac/Linux
lsof -ti:9876 | xargs kill -9
```

### Screenshot doesn't auto-paste
- Make sure you click 📸 while claude.ai is the active tab
- After snipping, click back into the Claude chat input and press `Ctrl+V`
- The snip is always on your clipboard as a fallback

### Custom port
```bash
BRIDGE_PORT=8888 node index.js
```

---

## Project Structure

```
claude-bridge/
├── extension/           # Chrome Extension (load this in browser)
│   ├── manifest.json    # Extension config
│   ├── content.js       # Code block detection + buttons
│   ├── styles.css       # UI styles
│   ├── popup.html       # Extension popup
│   ├── popup.js         # Popup logic
│   └── background.js    # Service worker
├── agent/               # Local Bridge Agent (run this)
│   ├── index.js         # WebSocket server + terminal bridge
│   └── package.json     # Dependencies
├── package.json
└── README.md
```

---

## Built By

**[Zilla](https://zilla.wtf)** — AI-first software studio

---

## License

MIT — use it, fork it, build on it.
