const INVALID_DIR_CHARS = /[~#%&*{}\\<>?/`'"|+:]/g;
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "svg", "webp"]);
const FONT_EXTENSIONS = new Set(["otf", "ttf", "woff", "woff2", "eot"]);

export function cleanDirectoryName(name) {
  let sanitized = name;
  if (sanitized.includes(":")) {
    if (sanitized.indexOf(":") > 15) {
      sanitized = sanitized.split(":")[0];
    } else {
      sanitized = sanitized.replace(/:/g, ",");
    }
  }
  sanitized = sanitized.replace(INVALID_DIR_CHARS, "_");
  return sanitized.replace(/\s+/g, " ").trim();
}

export function makeFolderFriendlyName(title, bookId) {
  const safeTitle = cleanDirectoryName(title);
  const prefix = safeTitle.split(",").slice(0, 2).join(",");
  return `${prefix || safeTitle} (${bookId})`.trim();
}

export function makeFileFriendlyName(...segments) {
  const cleaned = segments
    .map((segment) => segment ?? "")
    .map((segment) => cleanDirectoryName(String(segment)))
    .filter((segment) => segment.length > 0);

  if (!cleaned.length) {
    return "download";
  }

  return cleaned.join(" - ").replace(/\s+/g, " ").trim();
}

export function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function isAbsoluteUrl(url) {
  try {
    const parsed = new URL(url);
    return Boolean(parsed.protocol);
  } catch (_) {
    return false;
  }
}

export function isDocLink(url) {
  return [".html", ".xhtml", ".pdf"].some((ext) => url.includes(ext));
}

export function isImageLink(url) {
  const lowered = url.toLowerCase();
  if (lowered.includes("cover") || lowered.includes("images") || lowered.includes("graphics")) {
    return true;
  }
  const ext = lowered.split(".").pop();
  return IMAGE_EXTENSIONS.has(ext);
}

export function isFontUrl(url) {
  const ext = url.toLowerCase().split(".").pop().split("?")[0];
  return FONT_EXTENSIONS.has(ext);
}

export function isLikelyImageAsset(url) {
  const ext = url.toLowerCase().split(".").pop().split("?")[0];
  return IMAGE_EXTENSIONS.has(ext);
}

export function makeValidId(value) {
  const sanitized = value.replace(/\W|^(?=\d)/g, "_");
  return sanitized[0]?.match(/\d/) ? `_${sanitized}` : sanitized;
}

export function resolveStylesRelativePath(relativePath) {
  const baseParts = ["Styles"];
  const segments = relativePath.split("/").filter(Boolean);
  const resolved = [];
  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (resolved.length) {
        resolved.pop();
      } else if (baseParts.length) {
        baseParts.pop();
      }
      continue;
    }
    resolved.push(segment);
  }
  return [...baseParts, ...resolved].join("/");
}

export function ensureForwardSlashes(path) {
  return path.replace(/\\/g, "/");
}

export function uniqPush(collection, value) {
  if (!collection.includes(value)) {
    collection.push(value);
  }
  return collection.indexOf(value);
}

export function dataFromString(value) {
  const encoder = new TextEncoder();
  return encoder.encode(value);
}

export function toHex(value, width = 8) {
  return value.toString(16).padStart(width, "0");
}
