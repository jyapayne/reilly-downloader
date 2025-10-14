import { SafariBooksDownloader } from "./safaribooks/downloader.js";
import { collectSessionCookies } from "./safaribooks/cookies.js";

const runtime = typeof browser !== "undefined" ? browser : chrome;

const downloader = new SafariBooksDownloader((message) => {
  console.log(`[BackgroundDownloader] ${message}`);
});

runtime.runtime.onMessage.addListener(async (message) => {
  if (message?.type !== "downloadBook") {
    return undefined;
  }

  const { bookId, theme = "none", kindle = false } = message;
  if (!bookId) {
    return { ok: false, error: "Missing book ID." };
  }

  try {
    await collectSessionCookies();
    await downloader.download(bookId, { theme, kindle });
    return { ok: true };
  } catch (error) {
    console.error("[BackgroundDownloader] Download failed:", error);
    return { ok: false, error: error.message };
  }
});
