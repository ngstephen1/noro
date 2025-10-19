// Service worker: handles popup actions, injects content script on demand,
// and posts payloads to the local API.

const API_BASE = "http://127.0.0.1:8080";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab");
  return tab;
}

async function postJSON(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function ensureContentScript(tabId) {
  // With activeTab permission, we can inject into the current tab after a user gesture.
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["docs_capture.js"],
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "captureNow") {
    (async () => {
      try {
        const tab = await getActiveTab();

        // 1) Try to ask an already-loaded content script
        let reply;
        try {
          reply = await chrome.tabs.sendMessage(tab.id, {
            type: "PIA_CAPTURE_NOW",
            userId: msg.userId || "dev-user",
          });
        } catch (_) {
          reply = undefined;
        }

        // 2) If none, inject the script and retry
        if (!reply || !reply.ok) {
          await ensureContentScript(tab.id);
          reply = await chrome.tabs.sendMessage(tab.id, {
            type: "PIA_CAPTURE_NOW",
            userId: msg.userId || "dev-user",
          });
        }

        if (!reply?.ok || !reply?.payload) {
          throw new Error(reply?.error || "content script unavailable");
        }

        // 3) Send to backend
        const out = await postJSON(`${API_BASE}/context`, reply.payload);
        sendResponse({ ok: !!out?.processed });
      } catch (e) {
        console.error("captureNow failed:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }

  if (msg?.type === "reopenTab" && msg.url_hash) {
    chrome.tabs.create({
      url: `https://www.google.com/search?q=${encodeURIComponent(msg.url_hash)}`
    });
    sendResponse({ ok: true });
  }

  if (msg?.type === "startFocus") {
    const minutes = Number(msg.minutes || 25);
    chrome.notifications.create({
      type: "basic",
      title: "Focus timer",
      message: `Focus for ${minutes} minutes started.`,
      iconUrl: "icon128.png",
    });
    setTimeout(() => {
      chrome.notifications.create({
        type: "basic",
        title: "Focus done",
        message: `${minutes} minutes complete — nice!`,
        iconUrl: "icon128.png",
      });
    }, minutes * 60 * 1000);
    sendResponse({ ok: true });
  }
});