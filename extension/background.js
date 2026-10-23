/* War Room service worker: fetches Sleeper's public API for the overlay (no cookies, read-only). */
const ALLOWED = /^https:\/\/api\.sleeper\.(app|com)\//;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "wr-fetch") return false;
  if (!ALLOWED.test(msg.url || "")) { sendResponse({ ok: false, error: "blocked url" }); return false; }
  fetch(msg.url, { cache: "no-store", credentials: "omit" })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // async response
});

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { type: "wr-toggle" }).catch(() => {});
});
