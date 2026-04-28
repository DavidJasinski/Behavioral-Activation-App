# Sharing Break Free

Two ways to give Break Free to a friend on Android. Pick whichever is easier
for you. They both run the same app, with the same warmth, and store all the
friend's data on their own device.

---

## Option A — Send a single file (easiest, no internet needed after delivery)

Use this when you just want to text or email someone the app and have them
open it. No hosting, no setup.

**You do this once:**

1. Take `BreakFree.html` from this folder.
2. Send it to your friend any way you like:
   - Email it as an attachment.
   - Drop it in Google Drive / Dropbox / iCloud / Signal / WhatsApp and share
     the file (not a streaming link).
   - Put it on a USB stick and copy it to their phone's `Download` folder.

**Your friend does this once on their Android:**

1. Save `BreakFree.html` to the phone (most messaging apps have a "save" or
   "download" option).
2. Open the phone's Files app and tap `BreakFree.html`. Choose **Chrome** (or
   any browser) when prompted.
3. The app loads. Everything they type — name, goals, plans, the interview —
   is stored only on their phone, in that browser's local storage.
4. To find it again later, they can:
   - Bookmark the page in Chrome (long-press the URL bar → bookmark), or
   - Re-open the file from the Files app any time.

**Caveats with this option:**

- Their data lives in the *browser's* storage tied to that specific file.
  If they later open a re-downloaded copy from a different folder, Chrome may
  treat it as a new origin and they'll see a fresh app. So tell them: open
  it from the same place each time, or use Option B below.
- "Add to Home Screen" works inconsistently for `file://` URLs across
  Android browsers. If they want a real app icon, use Option B.

---

## Option B — Host it on the web (best UX, installs as a home-screen app)

Use this when you want the friend to have a real app icon on their home
screen, persistent storage that survives re-downloads, and the ability to
update later by re-uploading.

**You do this once:**

1. Unzip `break-free-hosted.zip` somewhere (it expands to a `break-free/`
   folder).
2. Pick any static host. Free options:
   - **GitHub Pages** — push the folder's contents to a repo's `main`
     branch, then enable Pages in the repo's Settings → Pages → Deploy
     from a branch → `main` → `/ (root)`. Wait ~1 minute. You'll get a URL
     like `https://yourname.github.io/repo-name/`.
   - **Netlify Drop** — drag the `break-free/` folder onto
     <https://app.netlify.com/drop>. Get an instant URL.
   - **Cloudflare Pages**, **Vercel**, etc. — same idea.
3. Send your friend the URL.

**Your friend does this once on their Android:**

1. Open the URL in **Chrome** on Android.
2. Tap the **⋮ menu** in the top-right corner.
3. Tap **Add to Home screen** (or **Install app** if it's offered — newer
   Chrome versions surface a real install button because Break Free ships a
   PWA manifest).
4. Confirm. A "Break Free" icon appears on the home screen.
5. Tap it. The app opens full-screen, just like a native app. All their data
   stays on their phone.

This option survives a phone reboot, gives them a proper icon, hides the
browser chrome when launched from the home screen, and is the path the app
was actually designed for.

---

## What's in this folder

- `BreakFree.html` — single-file build. Self-contained: app + styles + app
  logic + the entire knowledge corpus + the icon are all inlined into one
  HTML file. ~210 KB. Works offline forever.
- `break-free-hosted.zip` — multi-file build. The same app split into
  `index.html`, `styles.css`, `app.js`, `knowledge.json`, `icon.svg`, and
  `manifest.webmanifest`. ~58 KB zipped. Designed for static hosting and
  PWA install.

Both come from the same source. Use whichever fits the moment.

---

## Privacy reminder for your friend

Break Free does not phone home. There is no analytics, no telemetry, no
account, no cloud. Everything they tell the Coach — the interview answers,
their goals, their avoidances, what they've completed — lives in their
phone's browser storage. Closing the browser doesn't lose it. Uninstalling
Chrome (or wiping site data) does. There's no "forgot my password" because
there's no password and no server.
