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

A retrieval-augmented companion in a side drawer:

- **Indexes** — what you say into a topic-frequency table and a fact log.
- **Recalls** — relevant past snippets when topics overlap with the current message.
- **Retrieves** — top chunks from `knowledge.json` (built from the workbooks in `sources/`) and pins the source pill onto the reply.
- **Acts** — parses messages like *"add an activation to walk for 10 minutes tomorrow"* or *"build me a SUDS 30 in-vivo exposure step"* and saves them.
- **Adapts tone** — say "shorter", "more detailed", or "warmer".

Suggestions adapt to your current data and topics. Source citations are colored: terracotta for BA, moss for IVEX.

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

## Project layout

```
.
├── index.html
├── styles.css
├── app.js
├── knowledge.json
├── sources/                     # PDFs + extracted .txt
├── scripts/ingest_pdfs.py
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
