# 🌉 Claude Bridge

Send code blocks from Claude.ai directly to your Claude Code terminal with one click.

No more copy/paste. No more broken flow.

---

## How It Works

```
Chrome Extension (claude.ai)  ←→  Local Agent (WebSocket)  →  Claude Code Terminal
```

1. Extension detects code blocks in Claude's responses
2. Adds **Copy** and **Send to Terminal** buttons to each block
3. Click "Send to Terminal" → prompt appears in your terminal
4. You hit **Enter** to execute (you're always in control)

---

## Setup

### Step 1: Install the Bridge Agent

```bash
# Clone the repo
git clone https://github.com/AL-ZiLLA/claude-bridge.git
cd claude-bridge

# Install dependencies
npm install
```

### Step 2: Load the Chrome Extension

1. Open Brave/Chrome and go to `chrome://extensions`
2. Turn on **Developer Mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `claude-bridge/extension/` folder
5. You should see the 🌉 Claude Bridge icon in your toolbar

### Step 3: Start the Agent

```bash
# Navigate to your project folder first
cd ~/your-project

# Start the bridge agent
node path/to/claude-bridge/agent/index.js

# OR if installed globally:
claude-bridge start
```

### Step 4: Use It

1. Go to [claude.ai](https://claude.ai)
2. Ask Claude something that generates code blocks
3. Hover over any code block → see the **Send to Terminal** button
4. Click it → prompt appears in your terminal
5. Press **Enter** to execute

---

## Extension Popup

Click the 🌉 icon in your toolbar to see:
- **Connection status** (green = connected to agent)
- **Prompts sent** counter
- **Settings** access

---

## Troubleshooting

### Extension says "Disconnected"
- Make sure the bridge agent is running: `node agent/index.js`
- Check port 9876 isn't blocked or in use
- Try reloading the extension

### Buttons don't appear on code blocks
- Refresh claude.ai
- Check the extension is enabled in `chrome://extensions`
- Open DevTools Console and look for `[Claude Bridge]` logs

### Port conflict
```bash
# Find what's using port 9876
lsof -ti:9876

# Kill it
lsof -ti:9876 | xargs kill -9
```

---

## Config

Set a custom port:
```bash
BRIDGE_PORT=8888 node agent/index.js
```

---

## Project Structure

```
claude-bridge/
├── extension/           # Chrome Extension
│   ├── manifest.json    # Manifest V3
│   ├── content.js       # Detects code blocks, adds buttons
│   ├── styles.css       # Button & UI styles
│   ├── popup.html       # Extension popup
│   ├── popup.js         # Popup logic
│   ├── background.js    # Service worker
│   └── icons/           # Extension icons
├── agent/               # Local Bridge Agent
│   ├── index.js         # WebSocket server + PTY bridge
│   └── package.json
├── package.json         # Root package
└── README.md
```

---

## Roadmap

- [x] Phase 1: Chrome Extension (detect blocks, add buttons)
- [ ] Phase 2: Local Bridge Agent (WebSocket + PTY)
- [ ] Phase 3: Two-way sync (terminal output back to extension)
- [ ] Phase 4: Keyboard shortcuts, prompt queue, settings

---

## License

MIT
