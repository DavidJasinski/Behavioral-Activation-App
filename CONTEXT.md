# Break Free — Project Context

This file is the durable context for any AI agent or contributor working on Break Free. Read it first; it tells you what this app is, what it deliberately is and isn't, and how the moving parts fit together.

## What Break Free is

A self-contained, browser-only web app that supports two co-equal evidence-based modalities for moving a stuck life forward:

- **Behavioral Activation (BA)** — rebuilds contact with rewarding, valued activity to lift mood and break depressive inertia. Action precedes motivation.
- **In-Vivo Exposure (IVEX) / Graded Exposure** — rebuilds approach to feared situations to reduce anxiety and avoidance. Approach precedes safety.

Neither modality is "primary"; the app is built to weight them equally in UI affordances, the Coach's reasoning, and the source corpus.

## What it is not

- Not a clinical record, EHR, or HIPAA-grade system.
- Not a replacement for a therapist.
- Not a backend/cloud product. There is no network call. All user data stays in the browser's `localStorage`.
- Not a single-use prototype. The codebase is intentionally simple but production-shaped: clear separation of concerns, persistent state versioning, and an explicit knowledge index.

## High-level architecture

```
Break Free/
├── index.html           # shell + level templates (Home, Calendar, Create, Help)
├── styles.css           # warm, safe, inviting visual system
├── app.js               # router, state, persistence, Coach engine
├── knowledge.json       # chunked, indexed corpus from sources/ (consumed by Coach)
├── sources/             # raw PDFs + extracted .txt
│   ├── Behavioral-Activation-for-Depression.pdf  (BA)
│   ├── Behavioral-Activation-for-Depression.txt
│   ├── Graded-Exposure.pdf                       (IVEX)
│   └── Graded-Exposure.txt
├── scripts/
│   └── ingest_pdfs.py   # extracts text, chunks, writes knowledge.json
├── CONTEXT.md           # this file
└── README.md            # user-facing intro
```

### Levels (top-nav routes)

- **Home** — calm dashboard with previews of every other level: a 14-day mini calendar (BA dot bottom-right, IVEX dot bottom-left), Create card with split counts, Help quote, recent moves, latest Coach message, and topic chips.
- **Calendar** — full month grid with prev/next navigation. Each day shows colored dots for activations (terracotta), exposures (moss green), completions (cocoa), and goals (amber). Clicking a day reveals its agenda and the active goals.
- **Create** — modality-aware plan builder with a segmented control to switch between Activation and Exposure. Labels, placeholders, and the visible "drop a safety behavior" field adapt accordingly.
- **Help** — two prominent warm cards explaining BA and IVEX side-by-side, three "if X is happening" scaffolding cards (low energy, avoidance, didn't help), a patterns panel derived from logs, and a Sources panel listing the indexed corpus.

### Coach (drawer)

A retrieval-augmented assistant that:

1. **Remembers** — appends every exchange into `state.coach.memory`, plus a topic-frequency table and a short fact log.
2. **Retrieves** — on each user message, ranks chunks from `knowledge.json` by topic overlap and substring matches, and pins the top hit into the reply with a source pill.
3. **Acts** — parses intents (add activation, add exposure, add goal, summarize, suggest, explain modality, change tone, check in) and mutates the app state directly. Source citations appear as colored pills below the bubble (terracotta = BA, moss = IVEX).
4. **Adapts** — tone preference (`warm` / `concise` / `detailed`), suggestion chips driven by current topics and unfinished plans.

## Data model (browser localStorage)

Storage key: `breakFree.v1` (legacy `baApp.v1` is migrated on load).

```jsonc
{
  "user":        { "name": "" },
  "preferences": { "tone", "reminders", "theme" },
  "goals":       [{ "id", "title", "value", "targetDate", "createdAt", "status" }],
  "activations": [{
    "id", "modality" /* "ba" | "ivex" */,
    "title", "value", "category",
    "energy",       /* 1-5; for IVEX, ~SUDS/20 */
    "duration",     /* minutes */
    "scheduledFor", /* ISO datetime or null */
    "linkedGoalId", "safety", "notes",
    "createdAt", "completed", "completedAt"
  }],
  "logs": [{ "id", "type", "content", "ts", "moodAfter?" }],
  "coach": {
    "memory":      [{ "ts", "role", "text", "topics", "sources?" }],
    "topicCounts": { "topic": count },
    "facts":       [{ "ts", "fact" }]
  }
}
```

## Knowledge corpus

`knowledge.json` is the Coach's read-only context. It is regenerated from PDFs in `sources/` by:

```
python scripts/ingest_pdfs.py
```

Each entry includes `modality` ("ba" | "ivex"), `label`, normalized text, and per-chunk top topics for cheap relevance ranking. Adding a new source means dropping a PDF into `sources/`, listing it in `SOURCES` inside `scripts/ingest_pdfs.py` with its modality, and re-running.

The Coach treats both modalities as authoritative. When extending the corpus, preserve modality balance — adding only BA material would skew the Coach's reasoning toward activation even when exposure would fit better.

## Visual + tonal direction

- **Warm**: cream/peach/amber background, terracotta + moss accents, cocoa text.
- **Safe**: rounded cards, soft shadows, generous spacing, no harsh red anywhere. Errors and alerts use rose, never crimson.
- **Inviting**: copy uses second-person, lowercase emotional words ("kind", "gentle", "small"), and never frames anything as failure.
- **Two-modality parity**: terracotta consistently means BA, moss green consistently means IVEX. Anywhere one appears, the other should be visible too unless the user has explicitly chosen.

## Conventions for future agents

- Edits should keep both modalities at parity in UI, copy, and the Coach. If you add a feature for BA, add the equivalent for IVEX.
- Do not add network calls. The user has explicit data-locality preferences. If a future feature requires server-side, gate it behind an explicit user toggle.
- Persist all new state additions through `STATE` and bump the storage key only on breaking schema changes; otherwise migrate on load.
- Any new source PDF must be ingested via `scripts/ingest_pdfs.py` rather than hand-pasted into `knowledge.json`.
- Avoid clinical-sounding language in user-facing copy; reserve precision for `CONTEXT.md`, code comments, and source citations.

## Run / deploy

```bash
# from project root
python -m http.server 8787
# then http://localhost:8787/
```

No build step. Any static host works. The Coach's knowledge is fetched from `knowledge.json` at the same origin.

## Roadmap (current)

- Per-day step creation directly from the calendar.
- Mood charts over time, split by modality.
- Hierarchy builder for IVEX (linked steps with SUDS).
- Coach-driven theme controls ("make it softer", "warmer").
- Optional encrypted export/import for moving local data between devices.
- Optional weekly recap from the Coach, citing both modalities.

## Provenance

Sources currently indexed:

- *Behavioral Activation for Depression* — clinical workbook chapter, used as the BA corpus.
- *Graded Exposure* — Psychological Wellbeing Practitioner workbook, used as the IVEX corpus.

Both PDFs live in `sources/` alongside their normalized `.txt` extractions for inspection.
