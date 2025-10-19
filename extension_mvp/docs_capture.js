// Content script: builds a context payload and returns it to background.

(() => {
  const isDocs = /:\/\/docs\.google\.com\/document\//.test(location.href);

  async function getSelectionFromAllFrames() {
    // try top page first
    let t = (getSelection && getSelection().toString()) || "";
    if (t && t.trim()) return t;

    // try same-origin iframes (Docs uses nested frames)
    for (const f of document.querySelectorAll("iframe")) {
      try {
        const w = f.contentWindow;
        const s =
          (w?.getSelection && w.getSelection().toString()) ||
          (w?.document?.getSelection && w.document.getSelection().toString()) ||
          "";
        if (s && s.trim()) return s;
      } catch {
        /* cross-origin -> ignore */
      }
    }
    return "";
  }

  async function buildPayload(userId) {
    const title = document.title || "Untitled";
    const textSample = (
      isDocs ? await getSelectionFromAllFrames()
             : (getSelection && getSelection().toString()) || ""
    ).slice(0, 500);

    return {
      correlation_id: `c-${Date.now()}`,
      user_id: userId || "dev-user",
      ts: new Date().toISOString(),
      event: "manual_capture",
      active_app: "chrome",
      tabs: [
        {
          title,
          url_hash: (location.href || "").slice(-8),
          text_sample: textSample
        }
      ],
      signals: { idle_sec: 0, calendar_busy: false, slack_ping: false },
      // IMPORTANT: allow the current site, not just Docs
      privacy: { redacted: true, allowlist: [location.hostname] }
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "PIA_CAPTURE_NOW") {
      (async () => {
        try {
          const payload = await buildPayload(msg.userId);
          sendResponse({ ok: true, payload });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      })();
      return true; // keep channel open for async response
    }
  });
})();