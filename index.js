import { SafariBooksDownloader } from "./safaribooks/downloader.js";
import { collectSessionCookies } from "./safaribooks/cookies.js";

const form = document.getElementById("download-form");
const bookIdInput = document.getElementById("book-id");
const themeSelect = document.getElementById("theme");
const kindleCheckbox = document.getElementById("kindle");
const logView = document.getElementById("log");
const downloadButton = document.getElementById("start-download");

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  logView.textContent += `[${timestamp}] ${message}\n`;
  logView.scrollTop = logView.scrollHeight;
}

const downloader = new SafariBooksDownloader(appendLog);

function setDisabled(disabled) {
  downloadButton.disabled = disabled;
  bookIdInput.disabled = disabled;
  themeSelect.disabled = disabled;
  kindleCheckbox.disabled = disabled;
}

function extractBookIdFromUrl(url) {
  try {
    const { pathname } = new URL(url);
    const segments = pathname.split("/").filter(Boolean).reverse();
    return segments.find((segment) => /^[0-9]{9,}$/.test(segment)) || null;
  } catch (_) {
    return null;
  }
}

async function detectActiveBook() {
  if (!chrome.tabs?.query) {
    return;
  }

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.url || !activeTab.url.includes("/library/view/")) {
      return;
    }

    const detectedBookId = extractBookIdFromUrl(activeTab.url);
    if (!detectedBookId) {
      return;
    }

    if (bookIdInput.value !== detectedBookId) {
      bookIdInput.value = detectedBookId;
      appendLog(`Detected book ID ${detectedBookId} from the active tab.`);
    }
  } catch (error) {
    console.warn("SafariBooks Downloader: unable to detect active book.", error);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const bookId = bookIdInput.value.trim();
  if (!bookId) {
    appendLog("Please enter a book ID.");
    return;
  }
  setDisabled(true);
  appendLog("Verifying O'Reilly session...");
  try {
    const session = await collectSessionCookies();
    appendLog(`Session OK (cookies detected: ${session.count}).`);
    appendLog(`Starting EPUB download for ${bookId}...`);
    await downloader.download(bookId, {
      theme: themeSelect.value,
      kindle: kindleCheckbox.checked
    });
    appendLog("Download completed.");
  } catch (error) {
    console.error(error);
    appendLog(`Download failed: ${error.message}`);
  } finally {
    setDisabled(false);
  }
});

detectActiveBook();
