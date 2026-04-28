# Behavioral Activation App

A warm, gentle, multi-level web app for behavioral activation. It is designed to feel safe and inviting: the goal is to make small, kind action easier to choose, plan, and reflect on.

The app runs entirely in the browser — no backend, no accounts, no telemetry. All data stays in your browser's `localStorage` under the key `baApp.v1`.

## Levels

- **Home** — a calm dashboard with previews of every other level: a glance at the calendar, the current count of plans, a help quote, recent reflections, and the latest message from your Coach.
- **Calendar** — full month grid with prev/next navigation. Days are dotted with markers per activation (open, completed, goal). Clicking a day shows its agenda alongside your active goals.
- **Create** — a behavioral activation plan builder: action, value, category, energy, when, duration, an optional linked goal, and a kind note to your future self. Plans and goals are listed below the form.
- **Help** — gentle scaffolding for the harder days: low-energy, avoidance, and "it didn't help" cards each open the Coach with a prefilled prompt. A "patterns we're noticing" panel summarizes what your data is showing.

## Coach

A personal, learning companion in a side drawer. The Coach:

- **Indexes** what you say into a topic-frequency table and a short fact log.
- **Recalls** relevant past snippets when topics overlap with the current message.
- **Acts** on the app — for example, "add an activation to walk for 10 minutes tomorrow" parses an action title, duration, and time, then saves the plan and routes it onto the calendar.
- **Adapts tone** — say "shorter", "more detailed", or "warmer" and the Coach will follow.
- **Suggests next steps** that adapt to your current data (e.g. "What's the easiest thing I have planned?" only appears when something is unfinished).

The learning is sequential: each new message updates topic counts and recent facts, which in turn shape future suggestions and recalls.

## Data

All state lives in `localStorage` under `baApp.v1` with the shape:

```jsonc
{
  "user": { "name": "" },
  "goals":       [{ "id", "title", "value", "targetDate", "createdAt", "status" }],
  "activations": [{ "id", "title", "value", "category", "energy", "duration",
                    "scheduledFor", "linkedGoalId", "notes", "createdAt", "completed" }],
  "logs":        [{ "id", "type", "content", "ts", "moodAfter?" }],
  "preferences": { "tone", "reminders", "theme" },
  "coach": {
    "memory":      [{ "ts", "role", "text", "topics" }],
    "topicCounts": { "topic": count },
    "facts":       [{ "ts", "fact" }]
  }
}
```

There is no network call anywhere in the app.

## Run it locally

The app is plain HTML, CSS, and JavaScript — no build step.

```bash
# from the project root
python -m http.server 8787
# then open http://localhost:8787/
```

Any static file server works (e.g. `npx serve`, `caddy file-server`, etc.).

## Project layout

```
.
├── index.html   # shell + level templates
├── styles.css   # warm visual system
├── app.js       # router, state, persistence, Coach
└── README.md
```

## Roadmap

- Per-day activation creation directly from the calendar
- Mood charts over time
- Coach-driven theme controls ("make it softer", "warmer")
- Optional weekly recap from the Coach
- Optional encrypted export / import for moving data between devices

## License

Personal project. Use freely; modify kindly.
