# Break Free

A warm, multi-level web app for moving a stuck life forward. Two evidence-based modalities, treated as equals:

- **Behavioral Activation (BA)** — rebuild contact with rewarding, valued activity. Action precedes motivation.
- **In-Vivo Exposure (IVEX) / Graded Exposure** — rebuild approach to feared situations, gradually. Approach precedes safety.

Break Free runs entirely in your browser. No backend, no accounts, no telemetry. All data stays in `localStorage` under the key `breakFree.v1`.

> For deeper technical context (architecture, data model, agent conventions), see [`CONTEXT.md`](./CONTEXT.md).

## Levels

- **Home** — calm dashboard with a 14-day mini calendar, split BA/IVEX counts, recent moves, and the latest Coach message.
- **Calendar** — full month grid; days are dotted with markers per step (terracotta = activation, moss green = exposure, cocoa = done, amber = goal). Tap a day to see/add steps.
- **Create** — modality-aware plan builder. A segmented control flips the form between Activation and Exposure: labels, placeholders, and the "drop a safety behavior" field adapt.
- **Help** — side-by-side BA and IVEX explainers, three "if today is X" scaffolding cards, a patterns panel from your data, and the Coach's source list.

## Coach

A personalized, retrieval-augmented companion in a side drawer:

- **Interviews you** on first use (and any time you ask). Open-ended questions, no fixed length, fully resumable. Learns your name, communication style, what's heavy, what you're avoiding, what you value, what energizes you, when you have most energy in the day, and how much challenge you want.
- **Personalizes** every reply, suggestion chip, and home greeting based on that profile. Push if you asked to be pushed; gentle if you asked for gentle.
- **Indexes** what you say into a topic-frequency table and a fact log.
- **Retrieves silently** from `knowledge.json` (built from the workbooks in `sources/`). Used to ground the Coach's reasoning — never quoted verbatim. The bot speaks in its own voice.
- **Acts** on messages like *"add an activation to walk for 10 minutes tomorrow"* or *"build me a small in-vivo exposure step toward phone calls"* and saves them.
- **Adapts tone** — say "shorter", "more detailed", "warmer", or "push me".

Suggestions reference your actual values, energizers, and avoidances by name.

## Knowledge corpus

The Coach reads from `knowledge.json`, generated from the PDFs in `sources/`:

```bash
python scripts/ingest_pdfs.py
```

Currently indexed:

- *Behavioral Activation for Depression* (BA)
- *Graded Exposure* (IVEX)

To add a source, drop the PDF into `sources/`, list it in `SOURCES` inside `scripts/ingest_pdfs.py` with its modality, and re-run.

## Run it locally

```bash
# from project root
python -m http.server 8787
# then open http://localhost:8787/
```

Any static file server works.

## Share it with a friend (Android-friendly)

The repo includes a build script that produces two distributable bundles:

```bash
python scripts/build_bundle.py
```

Outputs in `dist/`:

- **`BreakFree.html`** — single self-contained file (~210 KB). HTML, CSS, JS,
  knowledge corpus, and the icon are all inlined. Email it, drop it in a chat,
  or copy it to a USB stick. The recipient saves it to their Android phone and
  taps it to open in Chrome. No internet, no setup. All data stays on their
  device.
- **`break-free-hosted.zip`** — multi-file build (~58 KB). Drop the contents
  on any static host (GitHub Pages, Netlify Drop, Cloudflare Pages, etc.).
  Includes a PWA manifest, so the recipient can use Chrome's **Add to Home
  Screen** / **Install app** to get a real app icon and launch full-screen.

See [`dist/SHARE.md`](./dist/SHARE.md) for step-by-step instructions you can
forward to your friend.

## Project layout

```
.
├── index.html
├── styles.css
├── app.js
├── knowledge.json
├── manifest.webmanifest         # PWA install metadata
├── icon.svg                     # warm orb app icon
├── sources/                     # PDFs + extracted .txt
├── scripts/
│   ├── ingest_pdfs.py
│   └── build_bundle.py          # builds dist/BreakFree.html + dist/break-free-hosted.zip
├── dist/                        # generated; share these with a friend
│   ├── BreakFree.html
│   ├── break-free-hosted.zip
│   └── SHARE.md
├── CONTEXT.md                   # durable agent context
└── README.md
```

## Roadmap

- Per-day step creation directly from the calendar
- Mood charts over time, split by modality
- IVEX hierarchy builder with linked SUDS steps
- Coach-driven theme controls ("make it softer", "warmer")
- Optional encrypted export/import between devices
- Optional weekly recap from the Coach, citing both modalities

## License

Personal project. Use freely; modify kindly.
