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

A personalized, retrieval-augmented assistant that:

1. **Interviews** — when the user is new (or asks to be re-interviewed), runs an open-ended adaptive interview that captures name, communication style, current struggles, avoidances, values, energizers, past wins, best windows, and challenge tolerance. There is no fixed number of questions; the user can pause, skip, or finish at any time. Answers go into `state.profile` and shape every subsequent response. See "Interview engine" below.
2. **Personalizes** — every reply, suggestion chip, and home greeting reads from `state.profile`. Examples: replies occasionally open with the user's name; suggestions reference their stated values, energizers, and avoidances by name; the `voice()` helper applies the user's `communicationStyle` (warm / concise / direct) and `challengeLevel` (gentle / moderate / push).
3. **Remembers** — appends every exchange into `state.coach.memory`, plus a topic-frequency table and a short fact log. Light opportunistic profile inference also runs on free-chat messages (`inferProfileFromMessage`).
4. **Retrieves silently** — on each user message, ranks chunks from `knowledge.json` by topic overlap and substring matches. The retrieved chunks are used to pick the **angle** of the reply (e.g. "this sounds more like avoidance — exposure tools fit better") and to ground the bot's reasoning. They are **never quoted verbatim** to the user, and there are no source pills in the chat.
5. **Acts** — parses intents (add activation, add exposure, add goal, summarize, suggest, explain modality, change tone, check in) and mutates app state directly.

### No-source-quoting policy

The Coach treats `knowledge.json` as silent context. Replies must be in the bot's own voice. Concretely:
- No verbatim chunk text in any reply.
- No "From X:" prefixes, no quotation marks around source content.
- No source pills under bubbles.
- Knowledge can shape: which modality angle to emphasize (`dominantModality`), how to phrase advice for an "explain" intent (synthesized paraphrase, not quote), and whether to suggest activation vs exposure tools.

This is a real product constraint — the workbooks are clinical material; the user's experience is a friend who has read them, not a search engine that hands back excerpts.

### Interview engine

Defined in `app.js` as an array of `INTERVIEW_TOPICS`. Each topic declares:
- `id` — stable identifier persisted in `profile.interviewProgress.askedTopics`
- `needs()` — predicate gating whether the topic is asked at all (e.g. only ask the "what are you avoiding" follow-up if the user reports anxiety/avoidance)
- `ask()` — open question phrased in the bot's voice, often referencing the user's name once known
- `parse(text)` — extracts structured fields onto `state.profile`
- `confirm()` — short acknowledgment that gets prepended to the next question, so each handoff feels like a conversation, not a survey

Control:
- `startInterview()` flips `coach.mode = "interview"` and pushes the first eligible question.
- `handleInterviewAnswer(text)` parses the current topic, advances, and either pushes the next question or — when `nextInterviewTopic()` returns null — flips `coach.mode = "free"` and pushes a personalized summary via `composeInterviewSummary()`.
- The user can interrupt at any time with phrases like "enough", "stop", "pause", "later" → mode becomes `free`, progress is preserved, and "continue interview" resumes from the next eligible topic.
- The Interview button in the drawer footer toggles start/pause directly without going through chat.
- Suggestions adapt: in interview mode the chips become {skip this one, enough for now, ask me something else}.

## Data model (browser localStorage)

Storage key: `breakFree.v1` (legacy `baApp.v1` is migrated on load).

```jsonc
{
  "user":        { "name": "" },
  "preferences": { "tone", "reminders", "theme" },
  "profile": {
    "name":               "first name as the user gave it",
    "communicationStyle": "warm | concise | direct",
    "challengeLevel":     "gentle | moderate | push",
    "struggles":          ["depression", "anxiety", "avoidance", "stuck"],
    "struggleNotes":      ["raw answers, last 5"],
    "avoiding":           ["raw avoidance descriptions, last 6"],
    "values":             ["topics extracted from values answer"],
    "valueNotes":         ["raw values answers, last 5"],
    "energizers":         ["topics extracted from energizers answer"],
    "energizerNotes":     ["raw energizer answers, last 5"],
    "pastWins":           ["raw past-wins answers, last 5"],
    "bestTimes":          ["morning", "afternoon", "evening", "night", "variable"],
    "interviewNotes":     ["open-close answers, last 5"],
    "interviewStarted":   true,
    "interviewComplete":  true,
    "interviewSkipped":   false,
    "interviewProgress": {
      "askedTopics":     ["name", "style", ...],
      "currentTopic":    "topic id during interview",
      "openCloseAsked":  false
    }
  },
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
    "mode":        "free | interview",
    "memory":      [{ "ts", "role", "text", "topics" }],
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
- **Never quote sources verbatim in chat.** Retrieved knowledge informs the bot's reasoning; the bot's voice does the talking. If you add a new intent that benefits from source content, paraphrase or synthesize — don't paste.
- **Treat the interview as the primary learning path.** When you add a new piece of personalization (e.g. preferred reminder cadence), prefer to add a topic to `INTERVIEW_TOPICS` with `needs()` / `parse()` / `confirm()` rather than asking the user inline at point-of-use. Free-chat inference (`inferProfileFromMessage`) is supplementary.

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
