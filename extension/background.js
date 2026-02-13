// Claude Bridge - Background Service Worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "status") {
    chrome.storage.local.set({ connected: message.connected });

    // Update extension icon badge
    if (message.connected) {
      chrome.action.setBadgeText({ text: "ON" });
      chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  }
});

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ sentCount: 0, connected: false });
  console.log("[Claude Bridge] Extension installed");
});
