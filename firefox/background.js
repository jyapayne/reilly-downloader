import { SafariBooksDownloader } from "./safaribooks/downloader.js";
import { collectSessionCookies } from "./safaribooks/cookies.js";

const runtime = typeof browser !== "undefined" ? browser : chrome;
const pendingDownloads = new Map();

const downloader = new SafariBooksDownloader((message) => {
  console.log(`[BackgroundDownloader] ${message}`);
}, (payload) => {
  const entry = payload?.bookId ? pendingDownloads.get(payload.bookId) : null;
  if (!entry) {
    return;
  }
  sendProgress(entry, payload);
});

function sendProgress(entry, payload) {
  if (!entry?.tabId) {
    return;
  }
  const progressMessage = {
    type: "download-progress",
    payload
  };

  try {
    if (typeof browser !== "undefined" && browser.tabs?.sendMessage) {
      browser.tabs.sendMessage(entry.tabId, progressMessage).catch(() => {});
    } else {
      chrome.tabs.sendMessage(entry.tabId, progressMessage, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          console.debug("Progress send error", error.message);
        }
      });
    }
  } catch (error) {
    console.debug("Unable to dispatch progress message", error);
  }
}

runtime.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "downloadBook") {
    return undefined;
  }

  const bookId = message.bookId;
  if (!bookId) {
    sendResponse({ ok: false, error: "Missing book ID." });
    return false;
  }

  if (pendingDownloads.has(bookId)) {
    sendResponse({ ok: false, error: "Download already in progress." });
    return false;
  }

  const entry = {
    bookId,
    options: {
      theme: message.theme ?? "none",
      kindle: Boolean(message.kindle)
    },
    tabId: sender?.tab?.id ?? null,
    sendResponse
  };

  pendingDownloads.set(bookId, entry);
  startDownload(entry).catch((error) => {
    console.error("[BackgroundDownloader] unexpected failure", error);
    finalizeDownload(entry, { ok: false, error: error.message || String(error) });
  });

  return true;
});

async function startDownload(entry) {
  try {
    await collectSessionCookies();
    await downloader.download(entry.bookId, entry.options);
    finalizeDownload(entry, { ok: true });
  } catch (error) {
    console.error("[BackgroundDownloader] Download failed:", error);
    finalizeDownload(entry, { ok: false, error: error.message || String(error) });
  }
}

function finalizeDownload(entry, response) {
  pendingDownloads.delete(entry.bookId);
  try {
    entry.sendResponse?.(response);
  } catch (error) {
    console.debug("sendResponse failed", error);
  }
}
