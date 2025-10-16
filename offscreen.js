import { SafariBooksDownloader } from "./safaribooks/downloader.js";
import { collectSessionCookies } from "./safaribooks/cookies.js";

const downloader = new SafariBooksDownloader((message) => {
  console.info(`[SafariBooksDownloader] ${message}`);
}, (payload) => {
  try {
    chrome.runtime.sendMessage({
      type: "offscreen-download-progress",
      requestId: currentRequestId,
      payload
    });
  } catch (_) {
    // ignore communication errors
  }
});

let currentRequestId = null;

async function handleOffscreenDownload(message) {
  const { requestId, bookId, options = {} } = message;
  if (!bookId) {
    chrome.runtime.sendMessage({
      type: "offscreen-download-complete",
      requestId,
      ok: false,
      error: "Missing book ID."
    });
    return;
  }

  try {
    currentRequestId = requestId;
    await collectSessionCookies();
    await downloader.download(bookId, {
      theme: options.theme ?? "none",
      kindle: Boolean(options.kindle)
    });
    chrome.runtime.sendMessage({
      type: "offscreen-download-complete",
      requestId,
      ok: true
    });
  } catch (error) {
    chrome.runtime.sendMessage({
      type: "offscreen-download-complete",
      requestId,
      ok: false,
      error: error.message
    });
  }
  currentRequestId = null;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "offscreen-download") {
    handleOffscreenDownload(message);
  }
});

chrome.runtime
  .sendMessage({ type: "offscreen-ready" })
  .catch(() => {
    // ignore errors if background not ready yet
  });
