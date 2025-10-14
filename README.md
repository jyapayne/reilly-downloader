# Reilly SafariBooks Downloader (Chrome & Edge)

This extension ports the `safaribooks.py` script into a browser workflow so you can download EPUBs directly from [learning.oreilly.com](https://learning.oreilly.com).

## Installation (Chrome or Edge)

1. **Clone / download** this repository to your computer and note the folder path (e.g. `C:\Users\joey\Projects\reilly-extension`).
2. Open the browser's extensions page:
   - **Chrome**: `chrome://extensions/`
   - **Edge**: `edge://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this project folder.
5. The “Reilly SafariBooks Downloader” icon should appear in the toolbar.

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
