(function () {
  const BUTTON_ID = "reilly-safaribooks-download";
  const BOOK_PATH_PART = "/library/view/";
  let observerInstance = null;
  let ensureIntervalId = null;
  let initialized = false;

  const TITLE_SELECTORS = [
    '[data-test="book-header-title"]',
    '[data-testid="book-title"]',
    '[data-testid="content-header-title"]',
    '[data-testid="content-header"] h1',
    '[data-testid="book-detail-header"] h1',
    '[data-ui-test="book-title"]',
    '[role="heading"][aria-level="1"]',
    "main h1",
    "article h1",
    "section h2",
    "article h2", 
    "header h1",
    "h1",
    "h2"
  ];

  function extractBookId() {
    const segments = window.location.pathname.split("/").filter(Boolean).reverse();
    const match = segments.find((segment) => /^[0-9]{9,}$/.test(segment));
    return match || null;
  }

  function isBookPage() {
    return window.location.pathname.includes(BOOK_PATH_PART);
  }

  function findTitleElement() {
    for (const selector of TITLE_SELECTORS) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim().length > 0) {
        return element;
      }
    }
    const allHeadings = Array.from(document.querySelectorAll("h1"))
      .concat(Array.from(document.querySelectorAll('[role="heading"][aria-level="1"]')));
    return allHeadings.find((element) => element.textContent.trim().length > 0) || null;
  }

  function ensureFloatingButton(bookId) {
    const floatingId = `${BUTTON_ID}-floating`;
    let floating = document.getElementById(floatingId);
    if (!floating) {
      floating = document.createElement("button");
      floating.id = floatingId;
      floating.type = "button";
      floating.textContent = "Download EPUB";
      floating.style.position = "fixed";
      floating.style.top = "96px";
      floating.style.right = "24px";
      floating.style.zIndex = "2147483647";
      floating.style.padding = "8px 14px";
      floating.style.borderRadius = "999px";
      floating.style.border = "none";
      floating.style.background = "#3a7bd5";
      floating.style.color = "#fff";
      floating.style.fontSize = "0.95rem";
      floating.style.cursor = "pointer";
      floating.style.boxShadow = "0 10px 25px rgba(58,123,213,0.35)";
      floating.addEventListener("mouseenter", () => {
        floating.style.background = "#255ca0";
      });
      floating.addEventListener("mouseleave", () => {
        floating.style.background = "#3a7bd5";
      });
      document.body.appendChild(floating);
    }

    floating.dataset.bookId = bookId;
    floating.onclick = () => handleDownload(floating, bookId);
  }

  function createButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "Download EPUB";
    button.style.padding = "6px 12px";
    button.style.borderRadius = "4px";
    button.style.border = "none";
    button.style.background = "#3a7bd5";
    button.style.color = "#fff";
    button.style.fontSize = "0.9rem";
    button.style.cursor = "pointer";
    button.style.display = "inline-flex";
    button.style.alignItems = "center";
    button.style.gap = "4px";
    button.style.boxShadow = "0 1px 2px rgba(0,0,0,0.12)";
    button.style.transition = "background 0.2s ease";
    button.addEventListener("mouseenter", () => {
      button.style.background = "#2f6bbd";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "#3a7bd5";
    });
    return button;
  }

  function setButtonState(button, state, message) {
    if (!button) {
      return;
    }
    switch (state) {
      case "busy":
        button.disabled = true;
        button.style.opacity = "0.7";
        break;
      case "idle":
        button.disabled = false;
        button.style.opacity = "";
        break;
      case "error":
        button.disabled = false;
        button.style.opacity = "";
        break;
      default:
        break;
    }
    if (message) {
      button.textContent = message;
    }
  }

  function setProgressMessage(wrapper, message) {
    if (!wrapper) {
      return;
    }
    let status = wrapper.querySelector(".reilly-progress-status");
    if (!status) {
      return;
    }
    status.textContent = message;
  }

  function handleDownload(button, bookId, wrapper, frameId) {
    if (!bookId) {
      return;
    }
    const originalText = button.textContent;
    setButtonState(button, "busy", "Downloading…");
    setProgressMessage(wrapper, "Starting download...");

    chrome.runtime.sendMessage({ type: "downloadBook", bookId, frameId }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.error("SafariBooks Downloader:", error);
        setButtonState(button, "error", "Failed (extension error)");
        setProgressMessage(wrapper, "Failed: extension error.");
      } else if (response?.ok) {
        setButtonState(button, "busy", "Download started");
        setProgressMessage(wrapper, "Packaging and saving EPUB...");
      } else {
        const errorMessage = response?.error ? `Failed: ${response.error}` : "Download failed";
        setButtonState(button, "error", errorMessage);
        setProgressMessage(wrapper, errorMessage);
      }

      setTimeout(() => {
        button.textContent = originalText;
        setButtonState(button, "idle");
      }, response?.ok ? 2000 : 4000);
    });
  }

  function injectButton() {
    const bookId = extractBookId();
    if (!bookId) {
      return;
    }

    const titleElement = findTitleElement();
    if (!titleElement) {
      ensureFloatingButton(bookId);
      return;
    }

    const floating = document.getElementById(`${BUTTON_ID}-floating`);
    if (floating) {
      floating.remove();
    }

    const existing = document.getElementById(BUTTON_ID);
    if (existing) {
      existing.dataset.bookId = bookId;
      return;
    }

    const wrapperId = `${BUTTON_ID}-wrapper`;
    let wrapper = document.getElementById(wrapperId);
    if (!wrapper) {
      wrapper = document.createElement("span");
      wrapper.id = wrapperId;
      wrapper.style.display = "inline-flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "12px";
      wrapper.style.marginLeft = "12px";

      const button = createButton();
      button.dataset.bookId = bookId;
      button.addEventListener("click", () => handleDownload(button, bookId, wrapper));

      wrapper.appendChild(button);
      const progressContainer = document.createElement("span");
      progressContainer.className = "reilly-progress";
      progressContainer.style.display = "inline-flex";
      progressContainer.style.flexDirection = "column";
      progressContainer.style.background = "#e2e8f0";
      progressContainer.style.borderRadius = "4px";
      progressContainer.style.padding = "6px 8px";
      progressContainer.style.minWidth = "160px";
      progressContainer.style.border = "1px solid #cbd5e1";
      progressContainer.style.fontSize = "0.75rem";
      progressContainer.style.color = "#1e293b";
      progressContainer.style.lineHeight = "1.4";

      const progressLabel = document.createElement("span");
      progressLabel.textContent = "Progress";
      progressLabel.style.fontSize = "0.7rem";
      progressLabel.style.textTransform = "uppercase";
      progressLabel.style.fontWeight = "700";
      progressLabel.style.color = "#475569";
      progressLabel.style.letterSpacing = "0.05em";

      const progressStatus = document.createElement("span");
      progressStatus.className = "reilly-progress-status";
      progressStatus.textContent = "Waiting";

      progressContainer.appendChild(progressLabel);
      progressContainer.appendChild(progressStatus);
      wrapper.appendChild(progressContainer);

      if (titleElement.parentElement) {
        titleElement.parentElement.insertBefore(wrapper, titleElement.nextSibling);
      } else {
        titleElement.insertAdjacentElement("afterend", wrapper);
      }
    } else {
      const button = wrapper.querySelector(`#${BUTTON_ID}`) || createButton();
      button.dataset.bookId = bookId;
      if (!wrapper.contains(button)) {
        wrapper.appendChild(button);
      }
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "download-progress") {
      return;
    }
    const wrapper = document.getElementById(`${BUTTON_ID}-wrapper`);
    if (!wrapper) {
      return;
    }
    const button = wrapper.querySelector(`#${BUTTON_ID}`);
    const { payload = {} } = message;
    if (!payload.stage) {
      return;
    }
    switch (payload.stage) {
      case "starting":
        setButtonState(button, "busy", "Preparing...");
        setProgressMessage(wrapper, "Preparing download...");
        break;
      case "session-check":
        setProgressMessage(wrapper, "Verifying session...");
        break;
      case "session-ok":
        setProgressMessage(wrapper, "Session verified.");
        break;
      case "metadata":
        setProgressMessage(wrapper, payload.title ? `Metadata: ${payload.title}` : "Metadata loaded.");
        break;
      case "chapters-discovered":
        setProgressMessage(
          wrapper,
          `Chapters: ${payload.total ?? "?"}${payload.total === 1 ? "" : " chapters"}`
        );
        break;
      case "chapter-start":
        setProgressMessage(
          wrapper,
          `Chapter ${payload.index}/${payload.total}: ${payload.title || ""}`
        );
        break;
      case "images-start":
        setProgressMessage(
          wrapper,
          `Images: 0/${payload.total} (max ${payload.concurrency})`
        );
        break;
      case "images-progress":
        setProgressMessage(
          wrapper,
          `Images: ${payload.completed}/${payload.total} (${payload.elapsedSeconds ?? 0}s)`
        );
        break;
      case "images-complete":
        setProgressMessage(wrapper, `Images complete (${payload.completed})`);
        break;
      case "css-images-start":
        setProgressMessage(wrapper, `CSS assets: ${payload.total}`);
        break;
      case "packaging-complete":
        setProgressMessage(wrapper, `Packaging done (${payload.durationMs}ms)`);
        break;
      case "download-start":
        setProgressMessage(wrapper, "Saving EPUB...");
        break;
      case "complete":
        setButtonState(button, "idle", "Download Complete");
        setProgressMessage(wrapper, "Download complete." );
        setTimeout(() => {
          if (button) {
            button.textContent = "Download EPUB";
          }
          setProgressMessage(wrapper, "Waiting");
        }, 4000);
        break;
      default:
        break;
    }
  });

  function observeForTitle() {
    if (observerInstance) {
      return;
    }

    observerInstance = new MutationObserver(() => {
      if (!isBookPage()) {
        return;
      }
      injectButton();
    });

    observerInstance.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    if (!isBookPage()) {
      return;
    }
    console.debug("[SafariBooks Downloader] content script active on", window.location.href);
    if (initialized) {
      injectButton();
      return;
    }

    initialized = true;
    injectButton();
    observeForTitle();
    window.addEventListener("popstate", injectButton);
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      setTimeout(injectButton, 50);
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      setTimeout(injectButton, 50);
    };
    ensureIntervalId = window.setInterval(() => {
      if (isBookPage()) {
        injectButton();
      }
    }, 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
