'use strict';

const API_BASE = 'http://127.0.0.1:8080';
const LIMIT = 3;

const el = (id) => document.getElementById(id);
const setStatus = (msg, ok = false) => {
  const s = el('status'); if (!s) return;
  s.textContent = msg; s.style.color = ok ? '#2e7d32' : '#666';
};
const esc = (s='') => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

async function getUserId() {
  const { piaUserId } = await chrome.storage.sync.get('piaUserId');
  return piaUserId || 'dev-user';
}

function render(items=[]) {
  const wrap = el('insights'); if (!wrap) return;
  if (!Array.isArray(items) || items.length === 0) {
    wrap.innerHTML = '<div style="color:#777;font-size:12px;">No insights yet</div>';
    return;
  }
  wrap.innerHTML = items.map(i => {
    const a0 = (i.next_actions && i.next_actions[0]) || {};
    const a1 = (i.next_actions && i.next_actions[1]) || {};
    return `
      <div class="card">
        <div class="ts">${esc(i.ts || '')}</div>
        <div class="sum">${esc(i.summary || '')}</div>
        <div class="actions">
          <button class="btn-reopen" data-hash="${esc(a0.target_url_hash || '')}">
            ${esc(a0.label || 'Reopen last tab')}
          </button>
          <button class="btn-focus" data-min="${esc(String(a1.duration_min || 25))}">
            ${esc(a1.label || 'Start 25-min focus timer')}
          </button>
        </div>
      </div>`;
  }).join('');
}

async function refreshInsights() {
  try {
    const userId = await getUserId();
    const r = await fetch(`${API_BASE}/insights?user_id=${encodeURIComponent(userId)}&limit=${LIMIT}`);
    const j = await r.json();
    if (j.ok) { render(j.items || []); setStatus('Refreshed ✓', true); }
    else { setStatus('Failed to load insights'); render([]); }
  } catch (e) {
    console.error(e); setStatus('Failed to load insights'); render([]);
  }
}

function sendMsg(msg) {
  return new Promise(res => {
    try { chrome.runtime.sendMessage(msg, resp => res(resp || { ok:false })); }
    catch (e) { res({ ok:false, error:String(e) }); }
  });
}

async function captureNow() {
  setStatus('Capturing…');
  const userId = await getUserId();
  const resp = await sendMsg({ type: 'captureNow', userId });
  if (resp?.ok) {
    setStatus('Captured ✓', true);
    await new Promise(r => setTimeout(r, 300));
    refreshInsights();
  } else {
    console.warn('capture failed', resp);
    setStatus('Capture failed');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  el('btn-refresh')?.addEventListener('click', refreshInsights);
  el('btn-capture')?.addEventListener('click', captureNow);
  refreshInsights();
});

document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (t.matches('.btn-reopen')) {
    chrome.runtime.sendMessage({ type: 'reopenTab', url_hash: t.dataset.hash });
  }
  if (t.matches('.btn-focus')) {
    chrome.runtime.sendMessage({ type: 'startFocus', minutes: Number(t.dataset.min || 25) });
  }
});