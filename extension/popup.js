// Claude Bridge v2 - Popup

document.addEventListener("DOMContentLoaded", () => {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const sentCount = document.getElementById("sentCount");
  const autoExec = document.getElementById("autoExec");
  const autoFeedback = document.getElementById("autoFeedback");
  const resetBtn = document.getElementById("resetBtn");

  // Load state
  chrome.storage.local.get(["connected", "sentCount", "autoExecute", "autoFeedback"], (result) => {
    updateStatus(result.connected || false);
    sentCount.textContent = result.sentCount || 0;
    autoExec.checked = result.autoExecute !== undefined ? result.autoExecute : true;
    autoFeedback.checked = result.autoFeedback !== undefined ? result.autoFeedback : true;
  });

  // Live connection check
  try {
    const testWs = new WebSocket("ws://localhost:9876");
    testWs.onopen = () => {
      updateStatus(true);
      chrome.storage.local.set({ connected: true });
      testWs.close();
    };
    testWs.onerror = () => {
      updateStatus(false);
      chrome.storage.local.set({ connected: false });
    };
  } catch (e) {
    updateStatus(false);
  }

  // Listen for changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.connected) updateStatus(changes.connected.newValue);
    if (changes.sentCount) sentCount.textContent = changes.sentCount.newValue;
  });

  function updateStatus(connected) {
    if (connected) {
      statusDot.className = "dot dot-green";
      statusText.textContent = "Connected";
      statusText.style.color = "#4ade80";
    } else {
      statusDot.className = "dot dot-red";
      statusText.textContent = "Disconnected";
      statusText.style.color = "#f87171";
    }
  }

  // Sync toggles to storage (content script reads these)
  autoExec.addEventListener("change", () => {
    chrome.storage.local.set({ autoExecute: autoExec.checked });
  });

  autoFeedback.addEventListener("change", () => {
    chrome.storage.local.set({ autoFeedback: autoFeedback.checked });
  });

  resetBtn.addEventListener("click", () => {
    chrome.storage.local.set({ sentCount: 0 });
    sentCount.textContent = "0";
  });
});
