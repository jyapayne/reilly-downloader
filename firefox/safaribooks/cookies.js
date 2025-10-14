const runtime = typeof browser !== "undefined" ? browser : chrome;
const rawChrome = typeof chrome !== "undefined" ? chrome : null;

const PROFILE_URL = "https://learning.oreilly.com/profile/";
const COOKIE_DOMAINS = ["learning.oreilly.com", ".oreilly.com", "www.oreilly.com"];
const COOKIE_URL_FILTERS = [
  "https://learning.oreilly.com/*",
  "https://www.oreilly.com/*",
  "https://api.oreilly.com/*"
];

let cookieHeader = "";
let refererHeader = "";
let originHeader = "";
let webRequestHookReady = false;

function callCookiesGetAll(filter) {
  const result = runtime.cookies.getAll(filter);
  if (result && typeof result.then === "function") {
    return result;
  }

  return new Promise((resolve, reject) => {
    runtime.cookies.getAll(filter, (cookies) => {
      const err = rawChrome?.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
      } else {
        resolve(cookies);
      }
    });
  });
}

async function gatherCookies() {
  const collected = new Map();
  let stores = [];
  try {
    if (typeof runtime.cookies.getAllCookieStores === "function") {
      stores = await runtime.cookies.getAllCookieStores();
    }
  } catch (_) {
    stores = [];
  }

  const storeIds = stores.length ? stores.map((store) => store.id) : [undefined];

  for (const domain of COOKIE_DOMAINS) {
    for (const storeId of storeIds) {
      const filter = storeId ? { domain, storeId } : { domain };
      const cookies = await callCookiesGetAll(filter);
      cookies.forEach((cookie) => {
        collected.set(cookie.name, cookie.value);
      });
    }
  }
  return collected;
}

function buildCookieHeader(jar) {
  if (!jar || jar.size === 0) {
    return "";
  }
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function ensureWebRequestHook() {
  if (webRequestHookReady || !runtime.webRequest?.onBeforeSendHeaders) {
    return;
  }

  runtime.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const isExtensionRequest =
        details.tabId === -1 ||
        (typeof details.initiator === "string" && details.initiator.startsWith("moz-extension://"));
      if (!isExtensionRequest) {
        return {};
      }

      const headers = details.requestHeaders ? [...details.requestHeaders] : [];
      const lower = (name) => name.toLowerCase();

      if (cookieHeader) {
        const existingCookie = headers.find((header) => lower(header.name) === "cookie");
        if (existingCookie) {
          existingCookie.value = cookieHeader;
        } else {
          headers.push({ name: "Cookie", value: cookieHeader });
        }
      }

      if (refererHeader) {
        const existingReferer = headers.find((header) => lower(header.name) === "referer");
        if (existingReferer) {
          existingReferer.value = refererHeader;
        } else {
          headers.push({ name: "Referer", value: refererHeader });
        }
      }

      if (originHeader) {
        const existingOrigin = headers.find((header) => lower(header.name) === "origin");
        if (existingOrigin) {
          existingOrigin.value = originHeader;
        } else {
          headers.push({ name: "Origin", value: originHeader });
        }
      }
      return { requestHeaders: headers };
    },
    { urls: COOKIE_URL_FILTERS, types: ["xmlhttprequest", "other"] },
    ["blocking", "requestHeaders"]
  );

  webRequestHookReady = true;
}

export async function collectSessionCookies() {
  const jar = await gatherCookies();
  const count = jar.size;
  if (!count) {
    throw new Error("No O'Reilly cookies detected. Make sure you visited learning.oreilly.com in this profile.");
  }

  cookieHeader = buildCookieHeader(jar);
  ensureWebRequestHook();

  let response;
  try {
    response = await fetch(PROFILE_URL, { credentials: "include" });
  } catch (error) {
    throw new Error(`Unable to reach O'Reilly profile page: ${error.message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("You must be logged into learning.oreilly.com in this profile before downloading.");
  }

  if (!response.ok) {
    throw new Error(`Profile check failed (status ${response.status}).`);
  }

  return {
    status: response.status,
    count,
    cookies: Object.fromEntries(jar.entries())
  };
}

export function updateRequestContext({ referer } = {}) {
  if (!referer) {
    return;
  }
  try {
    refererHeader = referer;
    const url = new URL(referer);
    originHeader = `${url.protocol}//${url.host}`;
  } catch (_) {
    // ignore invalid referrer values
  }
}
