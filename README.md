# Reilly SafariBooks Downloader (Chrome, Edge & Firefox)

This extension ports the `safaribooks.py` script into a browser workflow so you can download EPUBs directly from [learning.oreilly.com](https://learning.oreilly.com) in Chrome, Edge, or Firefox.

## Installation (Chrome or Edge)

1. **Clone / download** this repository to your computer and note the folder path (e.g. `C:\Users\joey\Projects\reilly-extension`).
2. Open the browser's extensions page:
   - **Chrome**: `chrome://extensions/`
   - **Edge**: `edge://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this project folder.
5. The "Reilly SafariBooks Downloader" icon should appear in the toolbar.


## Installation (Firefox)

The packaged `.xpi` is unsigned, so the Firefox release channel blocks it. Pick the approach that matches your setup:

- **Temporary load (any Firefox build)**
  1. Open `about:debugging#/runtime/this-firefox`.
  2. Click **Load Temporary Add-on...** and select `firefox-extension.xpi`.
  3. Keep the tab open while testing; Firefox unloads temporary add-ons after a restart.

- **Persistent install for testing (Firefox Developer Edition or Nightly)**
  1. Switch to Developer Edition or Nightly—only these builds allow signing to be disabled.
  2. In `about:config`, set `xpinstall.signatures.required` to `false`.
  3. Open `about:addons`, click the gear icon, and choose **Install Add-on From File...**.
  4. Pick `firefox-extension.xpi`, confirm the prompts, then flip the preference back to `true` when you return to normal browsing.

- **Permanent install on Firefox Release**
  1. Sign the add-on through Mozilla’s Add-on Developer Hub (https://addons.mozilla.org/developers/) or `web-ext sign`.
  2. Use the signed `.xpi` that Mozilla returns; only signed builds will install on stable Firefox.
## Usage

1. Log into [learning.oreilly.com](https://learning.oreilly.com) in the same browser profile.
2. Open any book page (URL containing `/library/view/`).
3. Open the extension popup:
   - The book ID is auto-detected and pre-filled when possible.
   - Adjust theme or Kindle tweaks if desired.
4. Click **Verify Session & Download**. The EPUB saves using the title, author, and ID.
5. A “Download EPUB” button is also injected beside the book title (and as a floating action button) on each book page for quick access.

## Notes

- The extension uses your authenticated cookies; ensure you are signed in before downloading.
- If an image fetch fails, the downloader logs each attempt and tries alternate URLs.
- Placeholder icons live in the `images/` directory—swap them out with custom artwork if you prefer.

