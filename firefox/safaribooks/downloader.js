import {
  makeFolderFriendlyName,
  makeFileFriendlyName,
  escapeXml,
  isAbsoluteUrl,
  isDocLink,
  isImageLink,
  makeValidId,
  resolveStylesRelativePath,
  ensureForwardSlashes,
  uniqPush,
  dataFromString,
  isFontUrl,
  isLikelyImageAsset
} from "./utils.js";
import { SimpleZip } from "./zip.js";
import { collectSessionCookies, updateRequestContext } from "./cookies.js";

const SAFARI_BASE_URL = "https://learning.oreilly.com";
const API_V2_TEMPLATE = `${SAFARI_BASE_URL}/api/v2/epubs/urn:orm:book:`;
const API_V1_TEMPLATE = `${SAFARI_BASE_URL}/api/v1/book/`;
const PROFILE_URL = `${SAFARI_BASE_URL}/profile/`;
const IMAGES_BASE = "Images/";

const THEME_CSS = {
  white: ".ucvMode-white{background:#ffffff;color:#101010;}",
  sepia: ".ucvMode-sepia{background:#f4ecd8;color:#523f2a;} .ucvMode-sepia a{color:#274060;}",
  black: ".ucvMode-black{background:#070707;color:#f4f4f5;} .ucvMode-black a{color:#60a5fa;}"
};

const KINDLE_CSS =
  "#sbo-rt-content *{word-wrap:break-word!important;word-break:break-word!important;}" +
  "#sbo-rt-content table,#sbo-rt-content pre{overflow-x:unset!important;overflow:unset!important;" +
  "overflow-y:unset!important;white-space:pre-wrap!important;}";

function formatTwoDigits(value) {
  return value.toString().padStart(2, "0");
}

function buildXhtml(pageCss, innerHtml, themeMode, includeKindleCss, extraThemeCss = "") {
  const kindleRule = includeKindleCss ? KINDLE_CSS : "";
  const themeRule = THEME_CSS[themeMode] || "";
  const additional = [themeRule, extraThemeCss].filter(Boolean).join("\n");
  return (
    `<!DOCTYPE html>
<html lang="en" xml:lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.w3.org/2002/06/xhtml2/ http://www.w3.org/MarkUp/SCHEMA/xhtml2.xsd" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<meta charset="utf-8">
${pageCss}
<style type="text/css">
body{margin:1em;background-color:transparent!important;}
#sbo-rt-content *{text-indent:0pt!important;}
#sbo-rt-content .bq{margin-right:1em!important;}
img{height:auto;max-width:100%;}
pre {background-color:#EEF2F6!important;padding:0.75em 1.5em!important;}
${kindleRule}
${additional}
</style>
</head>
<body><div class="ucvMode-${themeMode}"><div id="book-content">${innerHtml}</div></div></body>
</html>`
  );
}

function isProbablySvgImage(element) {
  return element.tagName?.toLowerCase() === "svg";
}

function toAbsoluteUrl(link, base) {
  try {
    return new URL(link, base).toString();
  } catch (_) {
    return link;
  }
}

export class SafariBooksDownloader {
  constructor(log = console.log) {
    this.log = (message) => {
      const timestamp = new Date().toISOString();
      log(`[${timestamp}] ${message}`);
    };
    this.reset();
  }

  reset() {
    this.bookInfo = null;
    this.bookId = null;
    this.bookChapters = [];
    this.chapterDocuments = [];
    this.cleanTitle = "";
    this.primaryAuthors = "";
    this.outputFileName = "download";
    this.baseUrl = "";
    this.coverPath = "";
    this.themeMode = "white";
    this.options = { theme: "none", kindle: false };
    this.referrerUrl = SAFARI_BASE_URL;
    this.baseRequestSpacingMs = 200;
    this.nextRequestTime = Date.now();
    this.rateLimitPenaltyMs = 0;
    this.sessionRefreshCooldownMs = 30000;
    this.lastSessionRefresh = 0;

    this.cssSources = [];
    this.cssFilenameMap = new Map();
    this.cssContentMap = new Map();

    this.fontDownloads = new Map(); // local path -> absolute url
    this.imageDownloads = new Map(); // relative path -> absolute url
    this.cssImageDownloads = new Map(); // path within Styles -> absolute url
    this.imagesFromLinks = new Set();
  }

  getReferrerUrl() {
    return this.referrerUrl || SAFARI_BASE_URL;
  }

  updateReferrer(url) {
    if (typeof url === "string" && url.startsWith("http")) {
      this.referrerUrl = url;
    }
  }

  async ensureSessionRefreshed({ force = false } = {}) {
    if (typeof collectSessionCookies !== "function") {
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastSessionRefresh < this.sessionRefreshCooldownMs) {
      return;
    }
    try {
      await collectSessionCookies();
      this.lastSessionRefresh = Date.now();
    } catch (error) {
      this.log(`Warning: unable to refresh session cookies (${error.message}).`);
    }
  }

  async applyRateLimit() {
    const waitTime = this.nextRequestTime - Date.now();
    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  registerRequestOutcome(status) {
    const penalizedStatuses = new Set([0, 401, 403, 429, 500, 502, 503, 504]);
    if (penalizedStatuses.has(status)) {
      if (status === 429 || status === 503) {
        this.rateLimitPenaltyMs = Math.min(Math.max(this.rateLimitPenaltyMs * 2, 500), 8000);
      } else {
        this.rateLimitPenaltyMs = Math.min(this.rateLimitPenaltyMs + 250, 6000);
      }
    } else {
      this.rateLimitPenaltyMs = Math.max(Math.floor(this.rateLimitPenaltyMs * 0.5), 0);
    }
    const delay = this.baseRequestSpacingMs + this.rateLimitPenaltyMs;
    this.nextRequestTime = Date.now() + delay;
  }

  shouldRetryResponse(response, attempt, maxAttempts, options = {}) {
    if (attempt >= maxAttempts - 1) {
      return false;
    }
    const status = response?.status ?? 0;
    if (status === 0) {
      return true;
    }
    if ([429, 500, 502, 503, 504].includes(status)) {
      return true;
    }
    if ((status === 401 || status === 403) && options.retryOnForbidden !== false) {
      return true;
    }
    return false;
  }

  computeRetryDelay(response, attempt, options = {}) {
    const status = response?.status ?? 0;
    const base = options.baseRetryDelay ?? 750;
    const cap = options.maxRetryDelay ?? 8000;
    const growth = Math.min(cap, base * Math.pow(2, attempt));
    const jitter = Math.random() * 250;
    if (status === 429 || status === 503) {
      return Math.min(cap, growth + 1000 + jitter);
    }
    return Math.min(cap, growth + jitter);
  }

  buildFetchInit(init = {}, { requireDocument = false } = {}) {
    const { headers, ...rest } = init || {};
    const mergedHeaders = new Headers(headers || {});
    if (!mergedHeaders.has("X-Requested-With")) {
      mergedHeaders.set("X-Requested-With", "XMLHttpRequest");
    }
    if (requireDocument && !mergedHeaders.has("Accept")) {
      mergedHeaders.set(
        "Accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      );
    }
    if (!mergedHeaders.has("Accept-Language")) {
      mergedHeaders.set("Accept-Language", "en-US,en;q=0.9");
    }

    const initWithDefaults = {
      credentials: "include",
      mode: "cors",
      ...rest,
      headers: mergedHeaders
    };

    if (!initWithDefaults.referrer) {
      initWithDefaults.referrer = this.getReferrerUrl();
    }
    if (!initWithDefaults.referrerPolicy) {
      initWithDefaults.referrerPolicy = "strict-origin-when-cross-origin";
    }
    return initWithDefaults;
  }

  async fetchWithSession(url, init = {}, options = {}) {
    const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
    let lastError = null;
    let lastResponse = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.applyRateLimit();

      try {
        const response = await fetch(url, this.buildFetchInit(init, options));
        lastResponse = response;
        this.registerRequestOutcome(response.status);

        if (response.ok) {
          return response;
        }

        const shouldRetry = this.shouldRetryResponse(response, attempt, maxAttempts, options);
        if (!shouldRetry) {
          return response;
        }

        if ((response.status === 401 || response.status === 403) && options.retryOnForbidden !== false) {
          await this.ensureSessionRefreshed({ force: true });
        }

        const retryDelay = this.computeRetryDelay(response, attempt, options);
        const targetTime = Date.now() + retryDelay;
        if (targetTime > this.nextRequestTime) {
          this.nextRequestTime = targetTime;
        }
      } catch (error) {
        lastError = error;
        this.registerRequestOutcome(0);
        if (attempt >= maxAttempts - 1) {
          throw error;
        }

        const retryDelay = this.computeRetryDelay(null, attempt, options);
        const targetTime = Date.now() + retryDelay;
        if (targetTime > this.nextRequestTime) {
          this.nextRequestTime = targetTime;
        }
      }
    }

    if (lastResponse) {
      return lastResponse;
    }
    throw lastError ?? new Error(`Request to ${url} failed without a response.`);
  }

  async download(bookId, options = {}) {
    this.reset();
    this.bookId = bookId;
    this.options = {
      theme: options.theme ?? "none",
      kindle: Boolean(options.kindle)
    };
    this.themeMode = this.options.theme === "none" ? "white" : this.options.theme;
    this.updateReferrer(`${SAFARI_BASE_URL}/library/view/${this.bookId}/`);
    updateRequestContext({ referer: this.getReferrerUrl() });

    this.log(`Verifying session by loading profile page...`);
    await this.checkLogin();

    this.log(`Retrieving book metadata for ${bookId}...`);
    this.bookInfo = await this.fetchBookInfo(bookId);
    this.baseUrl = this.bookInfo.web_url || this.bookInfo.url;
    this.updateReferrer(this.bookInfo.web_url || this.bookInfo.url);
    updateRequestContext({ referer: this.getReferrerUrl() });
    this.cleanTitle = makeFolderFriendlyName(this.bookInfo.title, this.bookId);
    const authorNames = (this.bookInfo.authors || []).map((author) => author.name).filter(Boolean);
    this.primaryAuthors = authorNames.join(", ") || "Unknown Author";
    this.outputFileName = makeFileFriendlyName(this.bookInfo.title, this.primaryAuthors, this.bookId);

    this.log(`Fetching table of chapters...`);
    this.bookChapters = await this.fetchChapters(this.bookInfo.chapters);
    this.log(`Chapters discovered: ${this.bookChapters.length}`);

    await this.processChapters();

    await this.fetchCssSources();
    await this.fetchFonts();
    await this.fetchImages();
    await this.fetchCssImages();

    const zip = await this.assembleEpub();

    const blob = new Blob([zip.generate()], { type: "application/epub+zip" });
    const url = URL.createObjectURL(blob);

    const filename = `${this.cleanTitle}/${this.outputFileName}.epub`;
    await chrome.downloads.download({ url, filename, saveAs: false });
    this.log(`EPUB saved as ${filename}`);
  }

  async checkLogin() {
    const response = await this.fetchWithSession(PROFILE_URL, {}, { requireDocument: true });
    if (!response.ok) {
      throw new Error(`Authentication failed (status ${response.status}) when accessing ${PROFILE_URL}`);
    }
    const text = await response.text();
    if (text.includes('user_type":"Expired"')) {
      throw new Error("Authentication issue: account subscription expired.");
    }
  }

  async fetchBookInfo(bookId) {
    const infoResponse = await this.fetchJson(`${API_V2_TEMPLATE}${bookId}/`);
    const v1Response = await this.fetchJson(`${API_V1_TEMPLATE}${bookId}/`);
    const merged = { ...infoResponse };

    for (const key of ["authors", "subjects", "topics", "rights", "publishers", "web_url"]) {
      if (v1Response[key]) {
        merged[key] = v1Response[key];
      }
    }
    if (!merged.url && merged.web_url) {
      merged.url = merged.web_url;
    }
    return merged;
  }

  async fetchChapters(initialUrl) {
    if (!initialUrl) {
      throw new Error("Missing chapter list URL in book metadata.");
    }
    const chapters = [];
    let next = initialUrl;
    while (next) {
      const data = await this.fetchJson(next);
      if (!Array.isArray(data.results)) {
        throw new Error("Chapter response missing results array.");
      }
      chapters.push(...data.results);
      next = data.next;
    }
    return chapters;
  }

  async fetchJson(url) {
    const response = await this.fetchWithSession(url, {
      headers: {
        Accept: "application/json, text/plain, */*"
      }
    });
    if (!response.ok) {
      throw new Error(`Request to ${url} failed with status ${response.status}`);
    }
    return response.json();
  }

  getChapterFilename(chapter) {
    if (chapter.ourn) {
      const lastPart = chapter.ourn.split("chapter:").pop();
      return lastPart.split("%2f").pop();
    }
    return chapter.filename || `${chapter.title || "chapter"}.xhtml`;
  }

  registerCssSource(url) {
    const key = ensureForwardSlashes(url);
    if (!this.cssFilenameMap.has(key)) {
      const index = uniqPush(this.cssSources, key);
      const filename = `Style${formatTwoDigits(index)}.css`;
      this.cssFilenameMap.set(key, filename);
    }
    return this.cssFilenameMap.get(key);
  }

  registerFont(baseUrl, relativePath) {
    const localPath = resolveStylesRelativePath(relativePath);
    if (!this.fontDownloads.has(localPath)) {
      const absolute = toAbsoluteUrl(relativePath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
      this.fontDownloads.set(localPath, absolute);
    }
  }

  registerImage(fullUrl) {
    if (!fullUrl) {
      return null;
    }
    const absoluteUrl = isAbsoluteUrl(fullUrl)
      ? fullUrl
      : toAbsoluteUrl(fullUrl, `${this.bookInfo.url.replace(/\/$/, "")}/files/`);
    const local = this.localImagePath(absoluteUrl);
    if (!local.fileName) {
      return null;
    }
    const relative = local.folder ? `${local.folder}/${local.fileName}` : local.fileName;
    if (!this.imageDownloads.has(relative)) {
      this.imageDownloads.set(relative, absoluteUrl);
    }
    return `${IMAGES_BASE}${relative}`;
  }

  localImagePath(url) {
    const normalized = url.split("?")[0];
    const imageDirs = ["images/", "graphics/", "assets/"];
    if (!this.bookInfo?.url) {
      const fileName = normalized.split("/").pop();
      return { fileName, folder: "" };
    }
    const bookUrl = this.bookInfo.url.replace(/\/$/, "");
    const components = bookUrl.split("/");
    const bookIdSegment = components.pop();
    const base = `${bookIdSegment}/files/`;
    const relCandidate = normalized.includes(base)
      ? normalized.split(base).pop()
      : normalized.split("/").slice(-1)[0];
    let trimmed = relCandidate.replace(/^\/+/, "");
    for (const dir of imageDirs) {
      if (trimmed.startsWith(dir)) {
        trimmed = trimmed.slice(dir.length);
        break;
      }
    }
    const parts = trimmed.split("/");
    const fileName = parts.pop();
    return {
      fileName,
      folder: parts.join("/")
    };
  }

  rewriteLink(link) {
    if (!link || link.startsWith("mailto")) {
      return link;
    }
    if (!isAbsoluteUrl(link)) {
      if (!isDocLink(link) && isImageLink(link)) {
        const base = `${this.bookInfo.url.replace(/\/$/, "")}/files/`;
        const absolute = toAbsoluteUrl(link, base);
        const updated = this.registerImage(absolute);
        if (updated) {
          this.imagesFromLinks.add(absolute);
          return updated;
        }
      }
      return link.split("/").pop().replace(".html", ".xhtml");
    }
    if (typeof this.bookInfo.url === "string" && link.includes(this.bookInfo.url)) {
      const partial = link.replace(this.bookInfo.url, "").replace(/^\/+/, "");
      return this.rewriteLink(partial);
    }
    return link;
  }

  async processChapters() {
    for (let index = 0; index < this.bookChapters.length; index++) {
      const chapter = this.bookChapters[index];
      const filename = this.getChapterFilename(chapter).replace(".html", ".xhtml");
      const assets = chapter.related_assets || {};

      if (Array.isArray(assets.images)) {
        assets.images.forEach((img) => {
          const url = isAbsoluteUrl(img) ? img : `${this.baseUrl}/files/${img}`;
          this.registerImage(url);
        });
      }

      const chapterStyles = [];
      if (Array.isArray(assets.stylesheets)) {
        chapterStyles.push(
          ...assets.stylesheets.map((cssUrl) => (isAbsoluteUrl(cssUrl) ? cssUrl : `${this.baseUrl}${cssUrl}`))
        );
      }
      if (Array.isArray(assets.site_styles)) {
        chapterStyles.push(
          ...assets.site_styles.map((cssUrl) => (isAbsoluteUrl(cssUrl) ? cssUrl : `${this.baseUrl}${cssUrl}`))
        );
      }

      const htmlRoot = await this.loadChapterDocument(chapter.content_url);
      const firstPage = index === 0;
      const { cssMarkup, xhtml, detectedCover } = this.parseHtml(htmlRoot, chapterStyles, firstPage);
      if (detectedCover && !this.coverPath) {
        const coverRegistered = this.registerImage(detectedCover);
        if (coverRegistered) {
          this.coverPath = coverRegistered;
        }
      }
      this.chapterDocuments.push({
        title: chapter.title || `Chapter ${index + 1}`,
        filename,
        cssMarkup,
        xhtml
      });
    }

    if (!this.coverPath && typeof this.bookInfo.cover === "string") {
      this.log("Falling back to book metadata cover image.");
      const registered = this.registerImage(this.bookInfo.cover);
      if (registered) {
        this.coverPath = registered;
      }
    }

    const hasCoverChapter = this.chapterDocuments.some(
      (chapter) =>
        chapter.filename.toLowerCase().includes("cover") || chapter.title.toLowerCase().includes("cover")
    );
    if (!hasCoverChapter && this.coverPath) {
      const coverMarkup = `<div id="Cover"><img src="${escapeXml(this.coverPath)}" alt="Book cover"/></div>`;
      const coverDocument = buildXhtml("", coverMarkup, this.themeMode, this.options.kindle);
      this.chapterDocuments.unshift({
        title: "Cover",
        filename: "default_cover.xhtml",
        cssMarkup: "",
        xhtml: coverDocument
      });
    }
  }

  async loadChapterDocument(url) {
    const response = await this.fetchWithSession(
      url,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      },
      { requireDocument: true }
    );
    if (!response.ok) {
      throw new Error(`Failed to download chapter at ${url} (status ${response.status})`);
    }
    const htmlText = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(htmlText, "text/html");
  }

  parseHtml(rootDocument, chapterStylesheets, firstPage) {
    const bookContent = rootDocument.querySelector("#sbo-rt-content");
    if (!bookContent) {
      throw new Error("Chapter markup missing #sbo-rt-content node.");
    }

    const pageCssBlocks = [];

    for (const cssUrl of chapterStylesheets) {
      const filename = this.registerCssSource(cssUrl);
      pageCssBlocks.push(`<link href="Styles/${filename}" rel="stylesheet" type="text/css" />`);
    }

    const stylesheetLinks = rootDocument.querySelectorAll("link[rel='stylesheet']");
    stylesheetLinks.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) {
        return;
      }
      const cssUrl = href.startsWith("//") ? `https:${href}` : toAbsoluteUrl(href, this.baseUrl);
      const filename = this.registerCssSource(cssUrl);
      pageCssBlocks.push(`<link href="Styles/${filename}" rel="stylesheet" type="text/css" />`);
    });

    const inlineStyles = rootDocument.querySelectorAll("style");
    inlineStyles.forEach((styleEl) => {
      if (styleEl.hasAttribute("data-template")) {
        styleEl.textContent = styleEl.getAttribute("data-template");
        styleEl.removeAttribute("data-template");
      }
      pageCssBlocks.push(styleEl.outerHTML);
    });

    this.rewriteLinksInNode(bookContent);
    this.fixOverconstrainedImages(bookContent);

    let detectedCover = null;
    if (firstPage) {
      detectedCover = this.detectCoverImage(bookContent);
    }

    const serializer = new XMLSerializer();
    const xhtml = serializer.serializeToString(bookContent);
    const documentHtml = buildXhtml(
      pageCssBlocks.join("\n"),
      xhtml,
      this.themeMode,
      this.options.kindle,
      this.options.theme !== "none" ? THEME_CSS[this.options.theme] : ""
    );

    return {
      cssMarkup: pageCssBlocks.join("\n"),
      xhtml: documentHtml,
      detectedCover
    };
  }

  rewriteLinksInNode(node) {
    const elements = node.querySelectorAll("*");
    elements.forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name === "href" || attr.name === "src" || attr.name.endsWith(":href")) {
          const rewritten = this.rewriteLink(attr.value);
          if (rewritten) {
            el.setAttribute(attr.name, rewritten);
          }
        }
      }
    });
  }

  fixOverconstrainedImages(node) {
    const images = node.querySelectorAll("img");
    images.forEach((img) => {
      const style = img.getAttribute("style");
      if (style && (style.includes("width") || style.includes("height"))) {
        img.removeAttribute("width");
        img.removeAttribute("height");
      }
    });
    const svgImages = node.querySelectorAll("svg image");
    svgImages.forEach((imageEl) => {
      const hrefAttr = Array.from(imageEl.attributes).find((attr) => attr.name.endsWith("href"));
      if (hrefAttr) {
        const img = node.ownerDocument.createElement("img");
        img.setAttribute("src", this.rewriteLink(hrefAttr.value));
        const parent = imageEl.parentElement?.parentElement;
        if (parent) {
          parent.appendChild(img);
        }
      }
    });
  }

  detectCoverImage(node) {
    const selector =
      "img[id*='cover' i], img[class*='cover' i], img[name*='cover' i], img[src*='cover' i], img[alt*='cover' i]";
    const coverImg = node.querySelector(selector);
    if (coverImg) {
      return coverImg.getAttribute("src");
    }
    const fallback = node.querySelector("img");
    return fallback ? fallback.getAttribute("src") : null;
  }

  async fetchCssSources() {
    for (const source of this.cssSources) {
      if (this.cssContentMap.has(source)) {
        continue;
      }
      const response = await this.fetchWithSession(source, {
        headers: {
          Accept: "text/css,*/*;q=0.1"
        }
      });
      if (!response.ok) {
        this.log(`Warning: unable to retrieve CSS from ${source} (status ${response.status})`);
        continue;
      }
      let cssContent = await response.text();
      cssContent = cssContent.replace(/display\s*:\s*none/gi, "visibility: hidden");
      this.cssContentMap.set(source, cssContent);

      this.registerFontsAndCssImages(source, cssContent);
    }
  }

  registerFontsAndCssImages(sourceUrl, cssContent) {
    try {
      const url = new URL(sourceUrl);
      const base = `${url.origin}${url.pathname.substring(0, url.pathname.lastIndexOf("/") + 1)}`;
      const urlRegex = /url\(([^)]+)\)/gi;
      let match = urlRegex.exec(cssContent);
      while (match) {
        let raw = match[1].trim().replace(/^['"]|['"]$/g, "");
        if (raw.startsWith("data:") || raw.startsWith("about:")) {
          match = urlRegex.exec(cssContent);
          continue;
        }
        const absolute = toAbsoluteUrl(raw, base);
        if (isFontUrl(raw)) {
          this.registerFont(base, raw);
        } else if (isLikelyImageAsset(raw)) {
          const localPath = resolveStylesRelativePath(raw);
          if (!this.cssImageDownloads.has(localPath)) {
            this.cssImageDownloads.set(localPath, absolute);
          }
        }
        match = urlRegex.exec(cssContent);
      }
    } catch (_) {
      // ignore malformed css urls
    }
  }

  async fetchFonts() {
    for (const [localPath, url] of this.fontDownloads.entries()) {
      if (this.cssImageDownloads.has(localPath)) {
        continue;
      }
      const response = await this.fetchWithSession(url, {
        headers: {
          Accept: "font/woff2,application/font-woff,application/octet-stream,*/*"
        }
      });
      if (!response.ok) {
        this.log(`Warning: unable to retrieve font ${url} (status ${response.status})`);
        continue;
      }
      const data = new Uint8Array(await response.arrayBuffer());
      this.cssImageDownloads.set(localPath, { data, inline: false, sourceUrl: url });
    }
  }

  async fetchImages() {
    for (const [relative, url] of this.imageDownloads.entries()) {
      const result = await this.fetchImageWithFallback(relative, url);
      if (result) {
        this.imageDownloads.set(relative, result);
      }
    }
  }

  async fetchImageWithFallback(relative, primaryUrl) {
    const attempts = [];
    const tried = new Set();

    const queue = [primaryUrl, ...this.buildImageFallbackUrls(relative, primaryUrl)];
    for (const candidate of queue) {
      if (!candidate || tried.has(candidate)) {
        continue;
      }
      tried.add(candidate);
      try {
        const response = await this.fetchWithSession(candidate, {
          headers: {
            Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
          }
        });
        if (!response.ok) {
          attempts.push(`${candidate} (status ${response.status})`);
          continue;
        }
        const data = new Uint8Array(await response.arrayBuffer());
        if (candidate !== primaryUrl) {
          this.log(`Info: fetched image ${relative} via fallback ${candidate}`);
        }
        return { data, sourceUrl: candidate };
      } catch (error) {
        attempts.push(`${candidate} (${error.message})`);
      }
    }

    if (attempts.length) {
      this.log(
        `Warning: unable to fetch image ${primaryUrl}. Attempts: ${attempts.join("; ")}`
      );
    }
    return null;
  }

  buildImageFallbackUrls(relative, url) {
    const candidates = new Set();

    if (url.includes("/Images/")) {
      candidates.add(url.replace("/Images/", "/images/"));
    }
    if (url.includes("/images/")) {
      candidates.add(url.replace("/images/", "/Images/"));
    }

    if (url.includes("/files/Images/")) {
      const base = url.replace(/Images\/[^/]*$/i, "Images/");
      ["cover.jpg", "cover.jpeg", "cover.png", "cover-large.jpg"].forEach((file) => {
        candidates.add(`${base}${file}`);
      });
    }

    const isbnMatch = url.match(/Images\/(\d{10,13})\.(jpg|jpeg|png|gif)$/i);
    if (isbnMatch) {
      const isbn = isbnMatch[1];
      const sizes = ["600w", "400w", "250w", ""];
      sizes.forEach((size) => {
        const trimmedSize = size ? `/${size}` : "";
        candidates.add(`https://learning.oreilly.com/library/cover/${isbn}${trimmedSize}/`);
      });
    }

    if (this.bookInfo?.cover && url !== this.bookInfo.cover) {
      candidates.add(this.bookInfo.cover);
    }

    if (relative && this.bookInfo?.cover_url) {
      candidates.add(this.bookInfo.cover_url);
    }

    return Array.from(candidates).filter(Boolean);
  }

  async fetchCssImages() {
    for (const [path, entry] of this.cssImageDownloads.entries()) {
      if (entry?.data) {
        continue;
      }
      const response = await this.fetchWithSession(entry, {
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        }
      });
      if (!response.ok) {
        this.log(`Warning: unable to fetch CSS image ${entry} (status ${response.status})`);
        continue;
      }
      const data = new Uint8Array(await response.arrayBuffer());
      this.cssImageDownloads.set(path, { data, sourceUrl: entry });
    }
  }

  createManifestAndSpine() {
    const manifestEntries = [];
    const spineEntries = [];
    this.chapterDocuments.forEach((chapter) => {
      const itemId = escapeXml(chapter.filename.replace(/\.xhtml$/i, ""));
      manifestEntries.push(
        `<item id="${itemId}" href="${escapeXml(chapter.filename)}" media-type="application/xhtml+xml" />`
      );
      spineEntries.push(`<itemref idref="${itemId}" />`);
    });

    for (const [relative, image] of this.imageDownloads.entries()) {
      if (!image?.data) {
        continue;
      }
      const ext = relative.split(".").pop().toLowerCase();
      const media = ext.includes("jp") ? "image/jpeg" : `image/${ext}`;
      const itemId = escapeXml(`img_${relative.replace(/[\\/]/g, "_").split(".")[0]}`);
      manifestEntries.push(
        `<item id="${itemId}" href="Images/${escapeXml(relative)}" media-type="${media}" />`
      );
    }

    for (const [source, filename] of this.cssFilenameMap.entries()) {
      const cssContent = this.cssContentMap.get(source);
      if (!cssContent) {
        continue;
      }
      manifestEntries.push(
        `<item id="${escapeXml(filename)}" href="Styles/${escapeXml(filename)}" media-type="text/css" />`
      );
    }

    for (const [path] of this.cssImageDownloads.entries()) {
      const ext = path.split(".").pop().toLowerCase();
      if (isFontUrl(path)) {
        const mediaType = ext === "otf" ? "font/otf" : ext === "ttf" ? "font/ttf" : `font/${ext}`;
        const id = escapeXml(path.replace(/[\\/]/g, "_"));
        manifestEntries.push(
          `<item id="${id}" href="${escapeXml(path)}" media-type="${mediaType}" />`
        );
      } else if (isLikelyImageAsset(path)) {
        const media = ext.includes("jp") ? "image/jpeg" : `image/${ext}`;
        const id = escapeXml(path.replace(/[\\/]/g, "_"));
        manifestEntries.push(`<item id="${id}" href="${escapeXml(path)}" media-type="${media}" />`);
      }
    }

    return {
      manifest: manifestEntries.join("\n"),
      spine: spineEntries.join("\n")
    };
  }

  getCoverId() {
    if (!this.coverPath) {
      return "cover";
    }
    const withoutPrefix = this.coverPath.replace(/^Images\//, "");
    const base = withoutPrefix.includes(".") ? withoutPrefix.split(".")[0] : withoutPrefix;
    return `img_${base.replace(/[\\/]/g, "_")}`;
  }

  createContentOpf(manifest, spine) {
    const authors = (this.bookInfo.authors || [])
      .map((author) => `<dc:creator opf:file-as="${escapeXml(author.name)}" opf:role="aut">${escapeXml(author.name)}</dc:creator>`)
      .join("\n");
    const subjects = (this.bookInfo.subjects || [])
      .map((subject) => `<dc:subject>${escapeXml(subject.name)}</dc:subject>`)
      .join("\n");

    const descriptionContainer = this.bookInfo.descriptions || {};
    const description = typeof descriptionContainer === "object" ? descriptionContainer["text/plain"] || "" : "";
    const publishers = (this.bookInfo.publishers || []).map((publisher) => escapeXml(publisher.name)).join(", ");

    return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0" >
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"  xmlns:opf="http://www.idpf.org/2007/opf">
<dc:title>${escapeXml(this.bookInfo.title)}</dc:title>
${authors}
<dc:description>${escapeXml(description)}</dc:description>
${subjects}
<dc:publisher>${publishers}</dc:publisher>
<dc:rights>${escapeXml(this.bookInfo.rights || "")}</dc:rights>
<dc:language>en-US</dc:language>
<dc:date>${escapeXml(this.bookInfo.publication_date || "")}</dc:date>
<dc:identifier id="bookid">${escapeXml(this.bookInfo.isbn || this.bookId)}</dc:identifier>
<meta name="cover" content="${escapeXml(this.getCoverId())}"/>
</metadata>
<manifest>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
${manifest}
</manifest>
<spine toc="ncx">
${spine}
</spine>
<guide><reference href="${escapeXml(this.chapterDocuments[0]?.filename || "chapter.xhtml")}" title="Cover" type="cover" /></guide>
</package>`;
  }

  createTocNavMap(entries, count = { value: 0 }, maxDepth = { value: 0 }) {
    if (!Array.isArray(entries)) {
      return { navMap: "", maxDepth: maxDepth.value };
    }
    let navMap = "";
    for (const entry of entries) {
      count.value += 1;
      const depth = Number(entry.depth || 0);
      if (depth > maxDepth.value) {
        maxDepth.value = depth;
      }
      const href = this.getChapterHref(entry);
      const title = escapeXml(entry.title || entry.label || "Chapter");
      const referenceId = entry.reference_id ? escapeXml(makeValidId(entry.reference_id)) : "";
      const fragment = entry.fragment ? entry.fragment : referenceId;
      let childrenXml = "";
      if (Array.isArray(entry.children) && entry.children.length) {
        const childResult = this.createTocNavMap(entry.children, count, maxDepth);
        childrenXml = childResult.navMap;
        maxDepth.value = Math.max(maxDepth.value, childResult.maxDepth);
      }
      navMap += `<navPoint id="${fragment}" playOrder="${count.value}"><navLabel><text>${title}</text></navLabel><content src="${href}"/>${childrenXml}</navPoint>`;
    }
    return { navMap, maxDepth: maxDepth.value };
  }

  getChapterHref(entry) {
    if (entry.href) {
      return escapeXml(entry.href.replace(".html", ".xhtml"));
    }
    if (entry.ourn) {
      const filename = entry.ourn.split("chapter:").pop().split("%2f").pop();
      return escapeXml(filename.replace(".html", ".xhtml"));
    }
    return escapeXml(this.chapterDocuments[0]?.filename || "chapter.xhtml");
  }

  createToc() {
    const sourceToc = this.bookInfo.table_of_contents || [];
    const { navMap, maxDepth } = this.createTocNavMap(sourceToc);
    const authors = (this.bookInfo.authors || []).map((author) => author.name).join(", ");
    return `<?xml version="1.0" encoding="utf-8" standalone="no" ?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta content="ID:ISBN:${escapeXml(this.bookInfo.isbn || this.bookId)}" name="dtb:uid"/>
<meta content="${maxDepth}" name="dtb:depth"/>
<meta content="0" name="dtb:totalPageCount"/>
<meta content="0" name="dtb:maxPageNumber"/>
</head>
<docTitle><text>${escapeXml(this.bookInfo.title)}</text></docTitle>
<docAuthor><text>${escapeXml(authors)}</text></docAuthor>
<navMap>${navMap}</navMap>
</ncx>`;
  }

  async assembleEpub() {
    const zip = new SimpleZip();
    zip.addFile("mimetype", dataFromString("application/epub+zip"));
    zip.addFile("META-INF/container.xml", dataFromString('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>'));

    const { manifest, spine } = this.createManifestAndSpine();
    const contentOpf = this.createContentOpf(manifest, spine);
    zip.addFile("OEBPS/content.opf", dataFromString(contentOpf));
    const toc = this.createToc();
    zip.addFile("OEBPS/toc.ncx", dataFromString(toc));

    for (const chapter of this.chapterDocuments) {
      zip.addFile(`OEBPS/${chapter.filename}`, dataFromString(chapter.xhtml));
    }

    for (const [source, filename] of this.cssFilenameMap.entries()) {
      const content = this.cssContentMap.get(source);
      if (!content) {
        continue;
      }
      zip.addFile(`OEBPS/Styles/${filename}`, dataFromString(content));
    }

    for (const [path, entry] of this.cssImageDownloads.entries()) {
      if (!entry?.data) {
        continue;
      }
      zip.addFile(`OEBPS/${path}`, entry.data);
    }

    for (const [relative, entry] of this.imageDownloads.entries()) {
      if (!entry?.data) {
        continue;
      }
      zip.addFile(`OEBPS/Images/${relative}`, entry.data);
    }

    return zip;
  }
}
