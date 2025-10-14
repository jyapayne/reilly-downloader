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
