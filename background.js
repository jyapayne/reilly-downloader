const pendingResponses = new Map();
const executionContext = {
  mode: null,
  windowId: null,
  tabId: null
};
let contextReadyPromise = null;
let contextReadyResolver = null;

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

async function ensureDocumentContext() {
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
    } catch (error) {
      // ignore and fall back
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
      if (!alreadyExists) {
        console.warn("SafariBooks Downloader: Offscreen document failed, falling back to hidden window.", error);
      } else {
        executionContext.mode = "offscreen";
        if (!contextReadyPromise) {
          contextReadyPromise = Promise.resolve();
        }
        await contextReadyPromise;
        return;
      }
    }
  }

  if (executionContext.mode === "window") {
    if (executionContext.tabId != null) {
      try {
        await chrome.tabs.get(executionContext.tabId);
        if (!contextReadyPromise) {
          contextReadyPromise = Promise.resolve();
        }
        await contextReadyPromise;
        return;
      } catch (_) {
        executionContext.tabId = null;
      }
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "downloadBook") {
    ensureDocumentContext()
      .then(() => {
        const requestId = crypto.randomUUID();
        pendingResponses.set(requestId, sendResponse);
        chrome.runtime
          .sendMessage({
            type: "offscreen-download",
            requestId,
            bookId: message.bookId,
            options: {
              theme: message.theme ?? "none",
              kindle: Boolean(message.kindle)
            }
          })
          .catch((error) => {
            const responder = pendingResponses.get(requestId);
            if (responder) {
              responder({ ok: false, error: error.message });
              pendingResponses.delete(requestId);
            }
          });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message?.type === "offscreen-ready") {
    resolveReadyPromise();
    return false;
  }

  if (message?.type === "offscreen-download-complete") {
    const { requestId, ok, error } = message;
    const responder = pendingResponses.get(requestId);
    if (responder) {
      responder({ ok, error });
      pendingResponses.delete(requestId);
    }

    if (executionContext.mode === "window" && pendingResponses.size === 0 && executionContext.windowId != null) {
      chrome.windows
        .remove(executionContext.windowId)
        .catch(() => {})
        .finally(() => {
          executionContext.windowId = null;
          executionContext.tabId = null;
          executionContext.mode = null;
          contextReadyPromise = null;
          contextReadyResolver = null;
        });
    }

    return false;
  }

  return undefined;
});
