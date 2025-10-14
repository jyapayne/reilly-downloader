const runtime = typeof browser !== "undefined" ? browser : chrome;
const rawChrome = typeof chrome !== "undefined" ? chrome : null;

const PROFILE_URL = "https://learning.oreilly.com/profile/";
const COOKIE_DOMAINS = ["learning.oreilly.com", ".oreilly.com", "www.oreilly.com"];

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
  const collected = {};
  for (const domain of COOKIE_DOMAINS) {
    const cookies = await callCookiesGetAll({ domain });
    cookies.forEach((cookie) => {
      collected[cookie.name] = cookie.value;
    });
  }
  return collected;
}

export async function collectSessionCookies() {
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

  const jar = await gatherCookies();
  const count = Object.keys(jar).length;
  if (!count) {
    throw new Error("No O'Reilly cookies detected. Make sure you visited learning.oreilly.com in this profile.");
  }

  return {
    status: response.status,
    count,
    cookies: jar
  };
}

