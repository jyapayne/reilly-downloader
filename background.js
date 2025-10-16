const pendingResponses = new Map();
const executionContext = {
  mode: null,
  windowId: null,
  tabId: null
};
let contextReadyPromise = null;
let contextReadyResolver = null;
let preferWindowContext = true;

function forwardProgressToClient(pending, message) {
  if (!pending || pending.tabId == null) {
    return;
  }
  const payload = {
    type: "download-progress",
    requestId: message.requestId,
    payload: message.payload
  };
  if (pending.frameId != null) {
    chrome.tabs.sendMessage(pending.tabId, payload, { frameId: pending.frameId }).catch(() => {});
  } else {
    chrome.tabs.sendMessage(pending.tabId, payload).catch(() => {});
  }
}

function createReadyPromise() {
  contextReadyPromise = new Promise((resolve) => {
    contextReadyResolver = resolve;
  });
}

function resolveReadyPromise() {
  if (contextReadyResolver) {
    contextReadyResolver();
    contextReadyResolver = null;
  }
  if (!contextReadyPromise) {
    contextReadyPromise = Promise.resolve();
  }
}

function resetContextState() {
  executionContext.windowId = null;
  executionContext.tabId = null;
  executionContext.mode = null;
  contextReadyPromise = null;
  contextReadyResolver = null;
}

async function closeOffscreenDocumentIfSupported() {
  if (chrome.offscreen?.closeDocument) {
    try {
      await chrome.offscreen.closeDocument();
    } catch (_) {
      // ignore - document might already be gone
    }
  }
}

async function ensureWindowContext() {
  if (executionContext.mode === "window" && executionContext.tabId != null) {
    try {
      await chrome.tabs.get(executionContext.tabId);
      if (!contextReadyPromise) {
        contextReadyPromise = Promise.resolve();
      }
      await contextReadyPromise;
      return;
    } catch (_) {
      resetContextState();
    }
  }

  const popupUrl = chrome.runtime.getURL("offscreen.html#window");
  const createdWindow = await chrome.windows.create({
    url: popupUrl,
    type: "popup",
    focused: false,
    width: 420,
    height: 520
  });

  executionContext.mode = "window";
  executionContext.windowId = createdWindow.id;
  executionContext.tabId = createdWindow.tabs && createdWindow.tabs.length ? createdWindow.tabs[0].id : null;
  createReadyPromise();
  await contextReadyPromise;
}

async function ensureDocumentContext() {
  if (!preferWindowContext) {
    const hasOffscreenApi = Boolean(chrome.offscreen?.createDocument);
    if (hasOffscreenApi) {
      try {
        if (chrome.offscreen.hasDocument) {
          const exists = await chrome.offscreen.hasDocument();
          if (exists) {
            executionContext.mode = "offscreen";
            if (!contextReadyPromise) {
              contextReadyPromise = Promise.resolve();
            }
            await contextReadyPromise;
            return;
          }
        }
      } catch (_) {
        // ignore - we'll attempt to create a fresh document below
      }

      try {
        createReadyPromise();
        await chrome.offscreen.createDocument({
          url: chrome.runtime.getURL("offscreen.html"),
          reasons: ["DOM_PARSER"],
          justification: "Process O'Reilly pages to build EPUB downloads"
        });
        executionContext.mode = "offscreen";
        await contextReadyPromise;
        return;
      } catch (error) {
        const alreadyExists = String(error?.message || "").includes("already exists");
        if (alreadyExists) {
          executionContext.mode = "offscreen";
          if (!contextReadyPromise) {
            contextReadyPromise = Promise.resolve();
          }
          await contextReadyPromise;
          return;
        }
        console.warn("SafariBooks Downloader: Offscreen document unavailable, using hidden window instead.", error);
        preferWindowContext = true;
        await closeOffscreenDocumentIfSupported();
        resetContextState();
      }
    } else {
      preferWindowContext = true;
    }
  }

  await ensureWindowContext();
}

function cleanupWindowIfIdle() {
  if (executionContext.mode === "window" && pendingResponses.size === 0 && executionContext.windowId != null) {
    chrome.windows
      .remove(executionContext.windowId)
      .catch(() => {})
      .finally(() => {
        resetContextState();
      });
  }
}

function shouldRetryInWindow(error, pending) {
  if (!error || pending.attempt >= 1) {
    return false;
  }
  if (pending.contextMode !== "offscreen") {
    return false;
  }
  const message = typeof error === "string" ? error : String(error);
  return message.toLowerCase().includes("domparser");
}

async function startDownloadTask(bookId, options, sendResponse, attempt = 0, clientInfo = {}) {
  try {
    await ensureDocumentContext();
  } catch (error) {
    sendResponse({ ok: false, error: error?.message || String(error) });
    return;
  }

  const requestId = crypto.randomUUID();
  const contextMode = executionContext.mode ?? (preferWindowContext ? "window" : "offscreen");
  const tabId = typeof clientInfo.tabId === "number" ? clientInfo.tabId : null;
  const frameId = typeof clientInfo.frameId === "number" ? clientInfo.frameId : null;

  const pendingEntry = {
    sendResponse,
    bookId,
    options,
    attempt,
    contextMode,
    tabId,
    frameId,
    clientInfo
  };

  pendingResponses.set(requestId, pendingEntry);

  if (tabId != null) {
    forwardProgressToClient(pendingEntry, {
      requestId,
      payload: {
        stage: "starting",
        bookId
      }
    });
  }

  try {
    await chrome.runtime.sendMessage({
      type: "offscreen-download",
      requestId,
      bookId,
      options
    });
  } catch (error) {
    const pending = pendingResponses.get(requestId);
    if (pending) {
      pendingResponses.delete(requestId);
      pending.sendResponse({ ok: false, error: error?.message || String(error) });
      cleanupWindowIfIdle();
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "downloadBook") {
    const bookId = message.bookId;
    if (!bookId) {
      sendResponse({ ok: false, error: "Missing book ID." });
      return false;
    }

    const options = {
      theme: message.theme ?? "none",
      kindle: Boolean(message.kindle)
    };

    const clientInfo = {
      tabId: sender?.tab?.id ?? null,
      frameId: typeof sender?.frameId === "number" ? sender.frameId : null
    };

    startDownloadTask(bookId, options, sendResponse, 0, clientInfo);
    return true;
  }

  if (message?.type === "offscreen-ready") {
    resolveReadyPromise();
    return false;
  }

  if (message?.type === "offscreen-download-complete") {
    const { requestId, ok, error } = message;
    const pending = pendingResponses.get(requestId);
    if (!pending) {
      return false;
    }

    if (!ok && shouldRetryInWindow(error, pending)) {
      pendingResponses.delete(requestId);
      preferWindowContext = true;
      closeOffscreenDocumentIfSupported()
        .catch(() => {})
        .finally(() => {
          resetContextState();
          startDownloadTask(
            pending.bookId,
            pending.options,
            pending.sendResponse,
            pending.attempt + 1,
            pending.clientInfo || {}
          );
        });
      return false;
    }

    pendingResponses.delete(requestId);
    pending.sendResponse({ ok, error });
    cleanupWindowIfIdle();
    return false;
  }

  if (message?.type === "offscreen-download-progress") {
    const { requestId } = message;
    const pending = requestId ? pendingResponses.get(requestId) : null;
    if (pending) {
      forwardProgressToClient(pending, message);
    }
    return false;
  }

  return undefined;
});
