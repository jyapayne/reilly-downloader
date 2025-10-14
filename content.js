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

  function handleDownload(button, bookId) {
    if (!bookId) {
      return;
    }
    const originalText = button.textContent;
    button.disabled = true;
    button.style.opacity = "0.7";
    button.textContent = "Downloading…";

    chrome.runtime.sendMessage({ type: "downloadBook", bookId }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        console.error("SafariBooks Downloader:", error);
        button.textContent = "Failed (extension error)";
      } else if (response?.ok) {
        button.textContent = "Download started";
      } else {
        button.textContent = response?.error ? `Failed: ${response.error}` : "Download failed";
      }

      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
        button.style.opacity = "";
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

    const button = createButton();
    button.dataset.bookId = bookId;
    button.addEventListener("click", () => handleDownload(button, bookId));

    const wrapperId = `${BUTTON_ID}-wrapper`;
    let wrapper = document.getElementById(wrapperId);
    if (!wrapper) {
      wrapper = document.createElement("span");
      wrapper.id = wrapperId;
      wrapper.style.display = "inline-flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "12px";
      wrapper.style.marginLeft = "12px";
      wrapper.appendChild(button);

      if (titleElement.parentElement) {
        titleElement.parentElement.insertBefore(wrapper, titleElement.nextSibling);
      } else {
        titleElement.insertAdjacentElement("afterend", wrapper);
      }
    } else if (!wrapper.contains(button)) {
      wrapper.appendChild(button);
    }
  }

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
