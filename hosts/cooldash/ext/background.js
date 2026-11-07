// Docs: docs/04 - Architecture/Platform Hosts.md
// Purpose: brings the window back to Dholphin when Netflix's pages ask for it, and keeps the playback position.
// Leaves the launcher's black page for the interface. The worker only runs when an event wakes it: onStartup and
// onInstalled do that when Chromium starts, whatever the profile holds. A later wake finds no such tab.
const START = 'data:text/html,<!--dholphin-->';
const leaveStart = (t) => {
  if (t.id !== undefined && (t.url ?? t.pendingUrl ?? '').replaceAll('%3C', '<').startsWith(START)) chrome.tabs.update(t.id, { url: chrome.runtime.getURL('index.html') });
};
const leaveAll = () => chrome.tabs.query({}).then((tabs) => tabs.forEach(leaveStart));
chrome.runtime.onStartup.addListener(leaveAll);
chrome.runtime.onInstalled.addListener(leaveAll);
chrome.tabs.onCreated.addListener(leaveStart);
chrome.tabs.onUpdated.addListener((_id, _change, t) => leaveStart(t));
leaveAll();
chrome.runtime.onMessage.addListener((m, sender) => {
  if (m?.t === 'back' && sender.tab?.id !== undefined) chrome.tabs.update(sender.tab.id, { url: chrome.runtime.getURL('index.html#back') });
  if (m?.t === 'progress') chrome.storage.local.set({ report: { positionSec: m.positionSec, durationSec: m.durationSec } });
});
