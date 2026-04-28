"use strict";

const STORAGE_KEY = "breakFree.v1";
const LEGACY_KEY = "baApp.v1";
const KNOWLEDGE_URL = "knowledge.json";

const DEFAULT_STATE = {
  createdAt: new Date().toISOString(),
  user: { name: "" },
  goals: [],
  activations: [],
  logs: [],
  preferences: { tone: "warm", reminders: true, theme: "warm" },
  coach: {
    memory: [
      {
        ts: new Date().toISOString(),
        role: "coach",
        text:
          "Welcome to Break Free. I'm trained on Behavioral Activation and Graded (In-Vivo) Exposure. Tell me what you noticed today, ask me to plan an activation, or build a small exposure step.",
        topics: ["welcome"]
      }
    ],
    topicCounts: {},
    facts: []
  }
};

const STOPWORDS = new Set(
  "a an and the to of in for on at with is am are was were be been being i me my you your we us our it its this that those these so but or if then than just very really maybe might can could would should do does did doing have has had not no yes ok okay over under up down out off again still more less because about into onto from as by what when where why how which who whose all any some many few each every other their them they he she him her his hers".split(
    " "
  )
);

const STATE = loadState();
let route = "home";
let calendarCursor = startOfMonth(new Date());
let calendarSelected = todayKey();
let createModality = "ba";

let KNOWLEDGE = null;
let KNOWLEDGE_PROMISE = loadKnowledge();

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function loadState() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        raw = legacy;
        localStorage.setItem(STORAGE_KEY, raw);
      }
    }
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    const merged = Object.assign(structuredClone(DEFAULT_STATE), parsed, {
      coach: Object.assign({}, DEFAULT_STATE.coach, parsed.coach || {})
    });
    merged.activations = (merged.activations || []).map((a) =>
      Object.assign({ modality: "ba" }, a)
    );
    return merged;
  } catch (e) {
    console.warn("Could not load state, starting fresh", e);
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
}

async function loadKnowledge() {
  try {
    const r = await fetch(KNOWLEDGE_URL, { cache: "no-store" });
    if (!r.ok) throw new Error("knowledge fetch failed " + r.status);
    KNOWLEDGE = await r.json();
    return KNOWLEDGE;
  } catch (e) {
    console.warn("knowledge.json not loaded:", e);
    KNOWLEDGE = { modalities: {}, docs: [], chunks: [] };
    return KNOWLEDGE;
  }
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function fmtDate(d, opts = {}) {
  return new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...opts
  });
}

function fmtTime(d) {
  return new Date(d).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

function relTime(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function navigate(next) {
  route = next;
  $$(".nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.route === next)
  );
  render();
}

function render() {
  const main = $("#app");
  const tpl = $(`#tpl-${route}`);
  if (!tpl) {
    main.innerHTML = `<p>Unknown view: ${route}</p>`;
    return;
  }
  main.innerHTML = "";
  main.appendChild(tpl.content.cloneNode(true));

  if (route === "home") renderHome();
  if (route === "calendar") renderCalendar();
  if (route === "create") renderCreate();
  if (route === "help") renderHelp();
}

function renderHome() {
  const greetings = greetingsByHour();
  $("#home-greeting").textContent = greetings.title;
  $("#home-lede").textContent = greetings.lede;

  const today = new Date();
  const cal = $("#home-calendar");
  cal.innerHTML = "";
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const cell = document.createElement("div");
    if (todayKey(d) === todayKey()) cell.classList.add("today");
    const acts = activationsOnDay(d);
    if (acts.some((a) => a.modality === "ba") || goalsOnDay(d).length)
      cell.classList.add("has", "ba");
    if (acts.some((a) => a.modality === "ivex"))
      cell.classList.add("has-ivex", "ivex");
    cell.title = fmtDate(d);
    cal.appendChild(cell);
  }

  const baCount = STATE.activations.filter((a) => a.modality === "ba").length;
  const ivexCount = STATE.activations.filter((a) => a.modality === "ivex").length;
  $("#home-create-stat").textContent = (baCount + ivexCount)
    ? `${baCount} activation${baCount===1?"":"s"} • ${ivexCount} exposure${ivexCount===1?"":"s"}`
    : "No plans yet — start with one tiny step.";
  $("#home-modality-stat").textContent = baCount + ivexCount
    ? `${baCount + ivexCount} total steps planned`
    : "";

  const recent = $("#home-recent");
  recent.innerHTML = "";
  const items = recentActivity().slice(0, 4);
  if (!items.length) {
    recent.innerHTML = `<div class="stream-empty">Nothing logged yet. Anything counts.</div>`;
  } else {
    items.forEach((it) => recent.appendChild(streamItem(it)));
  }

  const note = STATE.coach.memory.filter((m) => m.role === "coach").slice(-1)[0];
  if (note) $("#home-coach-note").textContent = note.text;

  const chipRow = $("#home-coach-chips");
  chipRow.innerHTML = "";
  topUserTopics(5).forEach((t) => {
    const c = document.createElement("span");
    c.className = "chip";
    c.textContent = t;
    chipRow.appendChild(c);
  });

  $("#home-open-coach").addEventListener("click", openCoach);
  $("[data-action='quick-checkin']").addEventListener("click", () => {
    openCoach();
    coachSend("let's do a quick check-in", { silent: true });
  });

  $$(".card.preview").forEach((card) =>
    card.addEventListener("click", () => navigate(card.dataset.route))
  );
}

function greetingsByHour() {
  const h = new Date().getHours();
  if (h < 5)
    return {
      title: "It's late. Be gentle.",
      lede: "Even a glass of water counts as showing up."
    };
  if (h < 12)
    return {
      title: "Good morning.",
      lede: "One small move can shape the whole day."
    };
  if (h < 17)
    return {
      title: "Hello, afternoon.",
      lede: "If today's been heavy, the smallest step still counts."
    };
  if (h < 22)
    return {
      title: "Easing into the evening.",
      lede: "What would feel kind to do next?"
    };
  return {
    title: "Quiet hours.",
    lede: "Anything restful counts as activation."
  };
}

function activationsOnDay(d) {
  const key = todayKey(d);
  return STATE.activations.filter(
    (a) => a.scheduledFor && todayKey(new Date(a.scheduledFor)) === key
  );
}

function goalsOnDay(d) {
  const key = todayKey(d);
  return STATE.goals.filter(
    (g) => g.targetDate && todayKey(new Date(g.targetDate)) === key
  );
}

function recentActivity() {
  const items = [];
  STATE.activations.forEach((a) =>
    items.push({
      kind: a.modality === "ivex" ? "ivex" : "activation",
      modality: a.modality || "ba",
      id: a.id,
      title: a.title,
      sub: subFor(a),
      ts: a.createdAt,
      completed: !!a.completed
    })
  );
  STATE.logs.forEach((l) =>
    items.push({
      kind: l.type,
      id: l.id,
      title: l.content,
      sub: relTime(l.ts),
      ts: l.ts
    })
  );
  return items.sort((a, b) => new Date(b.ts) - new Date(a.ts));
}

function subFor(a) {
  const tag = a.modality === "ivex" ? "Exposure" : "Activation";
  const energy = a.modality === "ivex" && a.energy
    ? ` • SUDS ~${Number(a.energy) * 20}`
    : "";
  return `${tag} • ${a.category} • ${a.duration || "?"} min${energy}${
    a.scheduledFor ? " • " + fmtDate(a.scheduledFor) : ""
  }`;
}

function topUserTopics(n) {
  const counts = STATE.coach.topicCounts || {};
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}

function streamItem(item) {
  const el = document.createElement("div");
  const cls = item.kind === "ivex" ? "ivex" : (item.kind || "");
  el.className = `stream-item ${cls}${item.completed ? " completed" : ""}`;
  el.innerHTML = `
    <div>
      <div class="title">${escapeHtml(item.title || "")}</div>
      <div class="sub">${escapeHtml(item.sub || "")}</div>
    </div>
    <div class="actions"></div>
  `;
  if ((item.kind === "activation" || item.kind === "ivex") && !item.completed && item.id) {
    const btn = document.createElement("button");
    btn.className = "ghost small";
    btn.textContent = "Mark done";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      completeActivation(item.id);
    });
    $(".actions", el).appendChild(btn);
  }
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[c]));
}

function completeActivation(id) {
  const a = STATE.activations.find((x) => x.id === id);
  if (!a) return;
  a.completed = true;
  a.completedAt = new Date().toISOString();
  STATE.logs.push({
    id: uid(),
    type: "complete",
    content: `Did "${a.title}"`,
    ts: a.completedAt
  });
  saveState();
  render();
}

function renderCalendar() {
  $("#cal-prev").addEventListener("click", () => {
    calendarCursor = new Date(
      calendarCursor.getFullYear(),
      calendarCursor.getMonth() - 1,
      1
    );
    drawCalendar();
  });
  $("#cal-next").addEventListener("click", () => {
    calendarCursor = new Date(
      calendarCursor.getFullYear(),
      calendarCursor.getMonth() + 1,
      1
    );
    drawCalendar();
  });
  drawCalendar();
}

function drawCalendar() {
  $("#cal-label").textContent = calendarCursor.toLocaleString(undefined, {
    month: "long",
    year: "numeric"
  });

  const grid = $("#cal-grid");
  grid.innerHTML = "";
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => {
    const h = document.createElement("div");
    h.className = "cal-cell head";
    h.textContent = d;
    grid.appendChild(h);
  });

  const first = startOfMonth(calendarCursor);
  const startDay = first.getDay();
  const daysInMonth = new Date(
    calendarCursor.getFullYear(),
    calendarCursor.getMonth() + 1,
    0
  ).getDate();
  const total = Math.ceil((startDay + daysInMonth) / 7) * 7;

  for (let i = 0; i < total; i++) {
    const d = new Date(first);
    d.setDate(1 + (i - startDay));
    const cell = document.createElement("div");
    cell.className = "cal-cell";
    if (d.getMonth() !== calendarCursor.getMonth()) cell.classList.add("dim");
    if (todayKey(d) === todayKey()) cell.classList.add("today");
    if (todayKey(d) === calendarSelected) cell.classList.add("selected");

    const num = document.createElement("div");
    num.className = "num";
    num.textContent = d.getDate();
    cell.appendChild(num);

    const marks = document.createElement("div");
    marks.className = "marks";
    activationsOnDay(d).forEach((a) => {
      const m = document.createElement("span");
      const klass = a.completed
        ? "done"
        : a.modality === "ivex"
        ? "ivex"
        : "";
      m.className = "mark" + (klass ? " " + klass : "");
      marks.appendChild(m);
    });
    goalsOnDay(d).forEach(() => {
      const m = document.createElement("span");
      m.className = "mark goal";
      marks.appendChild(m);
    });
    cell.appendChild(marks);

    cell.addEventListener("click", () => {
      calendarSelected = todayKey(d);
      drawCalendar();
    });
    grid.appendChild(cell);
  }

  const list = $("#cal-day-list");
  list.innerHTML = "";
  const items = activationsOnDay(new Date(calendarSelected));
  $("#cal-day-title").textContent = `${new Date(
    calendarSelected
  ).toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric"
  })}`;

  if (!items.length) {
    list.innerHTML = `<div class="stream-empty">Nothing scheduled. Want to add a small step?</div>`;
  } else {
    items.forEach((a) =>
      list.appendChild(
        streamItem({
          kind: a.modality === "ivex" ? "ivex" : "activation",
          modality: a.modality || "ba",
          id: a.id,
          title: a.title,
          sub: subFor(a),
          ts: a.createdAt,
          completed: !!a.completed
        })
      )
    );
  }

  const goalsBox = $("#cal-goals");
  goalsBox.innerHTML = "";
  if (!STATE.goals.length) {
    goalsBox.innerHTML = `<div class="stream-empty">No goals yet. Goals give your steps meaning.</div>`;
  } else {
    STATE.goals.forEach((g) =>
      goalsBox.appendChild(
        streamItem({
          kind: "goal",
          id: g.id,
          title: g.title,
          sub: `${g.value || ""}${
            g.targetDate ? " • by " + fmtDate(g.targetDate) : ""
          }`,
          ts: g.createdAt
        })
      )
    );
  }
}

function renderCreate() {
  refreshGoalSelect();
  applyCreateModality(createModality);

  $$(".seg-btn[data-modality]").forEach((b) =>
    b.addEventListener("click", () => {
      createModality = b.dataset.modality;
      $$(".seg-btn[data-modality]").forEach((x) =>
        x.classList.toggle("active", x.dataset.modality === createModality)
      );
      applyCreateModality(createModality);
    })
  );

  $("#create-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const data = Object.fromEntries(new FormData(f).entries());
    if (!data.title) return;
    const a = {
      id: uid(),
      modality: createModality,
      title: data.title.trim(),
      value: data.value?.trim() || "",
      category: data.category,
      energy: Number(data.energy || 3),
      duration: Number(data.duration || 15),
      scheduledFor: data.when || null,
      linkedGoalId: data.goalId || null,
      safety: data.safety?.trim() || "",
      notes: data.notes?.trim() || "",
      createdAt: new Date().toISOString(),
      completed: false
    };
    STATE.activations.push(a);
    STATE.logs.push({
      id: uid(),
      type: "reflection",
      content: `Planned ${
        createModality === "ivex" ? "exposure" : "activation"
      } "${a.title}"`,
      ts: a.createdAt
    });
    saveState();
    f.reset();
    render();
    toast(`Added "${a.title}". You're showing up.`);
  });

  $("#create-add-goal").addEventListener("click", () => {
    const title = prompt(
      "What's a goal you're moving toward? Keep it warm and human."
    );
    if (!title) return;
    const value = prompt("Why does this goal matter to you?") || "";
    const targetDate =
      prompt("Optional: target date (YYYY-MM-DD)") || null;
    const g = {
      id: uid(),
      title: title.trim(),
      value: value.trim(),
      targetDate: targetDate?.trim() || null,
      createdAt: new Date().toISOString(),
      status: "open"
    };
    STATE.goals.push(g);
    saveState();
    render();
  });

  const list = $("#create-list");
  list.innerHTML = "";
  $("#create-count").textContent = `${STATE.activations.length} saved`;
  if (!STATE.activations.length) {
    list.innerHTML = `<div class="stream-empty">No steps yet. Even a 5-minute step is a real step.</div>`;
  } else {
    [...STATE.activations]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .forEach((a) =>
        list.appendChild(
          streamItem({
            kind: a.modality === "ivex" ? "ivex" : "activation",
            modality: a.modality || "ba",
            id: a.id,
            title: a.title,
            sub: subFor(a),
            ts: a.createdAt,
            completed: !!a.completed
          })
        )
      );
  }

  const goalsBox = $("#create-goals");
  goalsBox.innerHTML = "";
  if (!STATE.goals.length) {
    goalsBox.innerHTML = `<div class="stream-empty">No goals yet.</div>`;
  } else {
    STATE.goals.forEach((g) =>
      goalsBox.appendChild(
        streamItem({
          kind: "goal",
          id: g.id,
          title: g.title,
          sub: `${g.value || ""}${
            g.targetDate ? " • by " + fmtDate(g.targetDate) : ""
          }`,
          ts: g.createdAt
        })
      )
    );
  }
}

function applyCreateModality(modality) {
  const form = $("#create-form");
  if (!form) return;
  form.querySelector("input[name='modality']").value = modality;
  $("#create-submit").textContent =
    modality === "ivex" ? "Save exposure" : "Save activation";

  $$("[data-label-for]", form).forEach((el) => {
    el.textContent = el.dataset[modality] || el.textContent;
  });
  $$("[data-ba][placeholder]", form).forEach((el) => {
    el.setAttribute(
      "placeholder",
      el.dataset[modality] || el.getAttribute("placeholder")
    );
  });

  $$(".ivex-only", form).forEach((el) => {
    const show = modality === "ivex";
    el.hidden = !show;
    el.style.display = show ? "" : "none";
  });
}

function refreshGoalSelect() {
  const sel = $("#create-goal-select");
  if (!sel) return;
  sel.innerHTML = `<option value="">—</option>`;
  STATE.goals.forEach((g) => {
    const o = document.createElement("option");
    o.value = g.id;
    o.textContent = g.title;
    sel.appendChild(o);
  });
}

function renderHelp() {
  $$("[data-help]").forEach((b) =>
    b.addEventListener("click", () => {
      openCoach();
      const k = b.dataset.help;
      const prompts = {
        "low-energy":
          "I'm low energy right now. Help me shrink today's plan into the smallest possible step.",
        avoidance:
          "I think I'm avoiding something. Help me name it kindly and pick a SUDS 30-40 in-vivo exposure step.",
        "didnt-help":
          "What I tried didn't help. Help me look at the data without judging it, and decide whether to change category, shrink the step, or stay with it longer."
      };
      coachSend(prompts[k] || "Help me get unstuck.", { silent: false });
    })
  );

  const patterns = derivePatterns();
  const box = $("#help-patterns");
  box.innerHTML = "";
  if (!patterns.length) {
    box.innerHTML = `<div class="stream-empty">Once you've logged a few steps, patterns will show up here.</div>`;
  } else {
    patterns.forEach((p) =>
      box.appendChild(
        streamItem({
          kind: "reflection",
          title: p.title,
          sub: p.sub,
          ts: new Date().toISOString()
        })
      )
    );
  }

  const sources = $("#help-sources");
  if (sources) {
    sources.innerHTML = "";
    const docs = (KNOWLEDGE && KNOWLEDGE.docs) || [];
    if (!docs.length) {
      sources.innerHTML = `<li class="muted">Knowledge index loading…</li>`;
      KNOWLEDGE_PROMISE.then(() => route === "help" && renderHelp());
    } else {
      docs.forEach((d) => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${escapeHtml(d.label)}</strong> <span class="muted">— ${d.modality.toUpperCase()} • ${d.chars.toLocaleString()} chars</span>`;
        sources.appendChild(li);
      });
    }
  }
}

function derivePatterns() {
  const out = [];
  if (!STATE.activations.length) return out;

  const completed = STATE.activations.filter((a) => a.completed);
  if (completed.length) {
    const byCat = {};
    completed.forEach((a) => (byCat[a.category] = (byCat[a.category] || 0) + 1));
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
    if (top)
      out.push({
        title: `You follow through most often on "${top[0]}" steps`,
        sub: `${top[1]} completed in this category.`
      });
  }

  const ba = STATE.activations.filter((a) => (a.modality || "ba") === "ba").length;
  const iv = STATE.activations.filter((a) => a.modality === "ivex").length;
  if (ba && iv) {
    out.push({
      title: `Your plan mixes ${ba} activations and ${iv} exposures`,
      sub: "Mixing modalities is a sign of a more flexible week."
    });
  } else if (ba && !iv) {
    out.push({
      title: "Lots of activations, no exposures yet",
      sub: "If anything is being avoided, a SUDS 30 step might widen the day."
    });
  } else if (!ba && iv) {
    out.push({
      title: "Lots of exposures, no activations yet",
      sub: "A small valued activation can refill the well between exposures."
    });
  }

  const lowEnergyCompleted = completed.filter((a) => Number(a.energy) <= 2)
    .length;
  if (lowEnergyCompleted >= 2) {
    out.push({
      title: "Small steps land best for you",
      sub: `${lowEnergyCompleted} low-energy steps completed.`
    });
  }

  const recentMoods = STATE.logs.filter((l) => l.type === "mood").slice(-7);
  if (recentMoods.length >= 3) {
    const avg =
      recentMoods.reduce((s, l) => s + (Number(l.moodAfter) || 0), 0) /
      recentMoods.length;
    out.push({
      title: `Recent mood after activity averages ${avg.toFixed(1)} / 5`,
      sub: "Try one more in your top category and see where it lands."
    });
  }

  const topTopics = topUserTopics(3);
  if (topTopics.length)
    out.push({
      title: `You've been thinking about: ${topTopics.join(", ")}`,
      sub: "The Coach uses these to ground its suggestions."
    });

  return out;
}

function toast(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = `
    position: fixed; left: 50%; bottom: 28px;
    transform: translateX(-50%);
    background: var(--cocoa); color: var(--cream-2);
    padding: 10px 16px; border-radius: 999px;
    box-shadow: var(--shadow); font-weight: 700;
    z-index: 80;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

/* ---------- Coach ---------- */

function openCoach() {
  const drawer = $("#coach");
  drawer.hidden = false;
  drawCoach();
  $("#coach-input").focus();
}

function closeCoach() {
  $("#coach").hidden = true;
}

function drawCoach() {
  const log = $("#coach-log");
  log.innerHTML = "";
  STATE.coach.memory.slice(-80).forEach((m) => {
    const b = document.createElement("div");
    b.className = `bubble ${m.role}`;
    b.textContent = m.text;
    if (m.role === "coach" && m.sources && m.sources.length) {
      m.sources.forEach((s) => {
        const pill = document.createElement("span");
        pill.className = "source-pill" + (s.modality === "ivex" ? " ivex" : "");
        pill.textContent = s.label;
        b.appendChild(document.createElement("br"));
        b.appendChild(pill);
      });
    }
    log.appendChild(b);
  });
  log.scrollTop = log.scrollHeight;

  $("#coach-stat").textContent = `indexing ${STATE.coach.memory.length} memories • ${
    Object.keys(STATE.coach.topicCounts).length
  } topics${KNOWLEDGE && KNOWLEDGE.chunks ? " • " + KNOWLEDGE.chunks.length + " source chunks" : ""}`;

  drawSuggestions();
}

function drawSuggestions() {
  const box = $("#coach-suggestions");
  if (!box) return;
  box.innerHTML = "";
  const suggestions = generateSuggestions();
  suggestions.forEach((s) => {
    const b = document.createElement("button");
    b.className = "suggestion";
    b.type = "button";
    b.textContent = s;
    b.addEventListener("click", () => coachSend(s));
    box.appendChild(b);
  });
}

function generateSuggestions() {
  const base = [
    "Suggest a 10-minute activation tied to a value",
    "Build me a small SUDS 30 in-vivo exposure step",
    "Summarize my week",
    "What does Behavioral Activation say about low motivation?",
    "What does Graded Exposure say about safety behaviors?"
  ];
  const top = topUserTopics(2);
  if (top.length)
    base.unshift(`Tie my next step to ${top.join(" and ")}`);
  if (STATE.activations.some((a) => !a.completed))
    base.unshift("What's the easiest thing I have planned?");
  return base.slice(0, 5);
}

async function coachSend(rawText, { silent = false } = {}) {
  const text = (rawText || "").trim();
  if (!text) return;
  if (!silent) pushMemory({ role: "user", text });
  else pushMemory({ role: "user", text });

  await KNOWLEDGE_PROMISE;

  const intent = classify(text);
  const action = await executeIntent(intent, text);
  const retrieved = retrieveKnowledge(text, 3);
  const reply = composeReply(intent, action, text, retrieved);
  pushMemory({
    role: "coach",
    text: reply,
    sources: retrieved.map((r) => ({
      modality: r.modality,
      label: r.label
    }))
  });
  saveState();

  if (route === "home") render();
  else drawCoach();
}

function pushMemory(entry) {
  const topics = extractTopics(entry.text);
  STATE.coach.memory.push({
    ts: new Date().toISOString(),
    role: entry.role,
    text: entry.text,
    topics,
    sources: entry.sources || null
  });
  if (entry.role === "user") {
    topics.forEach(
      (t) =>
        (STATE.coach.topicCounts[t] = (STATE.coach.topicCounts[t] || 0) + 1)
    );
    if (entry.text.length > 14)
      STATE.coach.facts.push({
        ts: new Date().toISOString(),
        fact: entry.text
      });
    if (STATE.coach.facts.length > 80)
      STATE.coach.facts = STATE.coach.facts.slice(-80);
  }
}

function extractTopics(text) {
  return Array.from(
    new Set(
      String(text)
        .toLowerCase()
        .replace(/[^a-z0-9'\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w && w.length > 2 && !STOPWORDS.has(w))
    )
  ).slice(0, 8);
}

const INTENTS = [
  {
    name: "add_exposure",
    test: (s) =>
      /\b(add|schedule|plan|create|build)\b.*\b(exposure|expose|in[\s-]?vivo|hierarchy)\b/i.test(
        s
      ) || /\bsuds\b/i.test(s)
  },
  {
    name: "add_activation",
    test: (s) =>
      /\b(add|schedule|plan|create)\b.*\b(activation|activity|step|task|walk|run|read|call|stretch|meditate|journal|nap|cook)\b/i.test(
        s
      ) || /^let'?s plan/i.test(s)
  },
  {
    name: "add_goal",
    test: (s) => /\b(add|create|set)\b.*\bgoal\b/i.test(s)
  },
  {
    name: "summarize",
    test: (s) => /\b(summarize|summary|recap|how (have|did) i)\b/i.test(s)
  },
  {
    name: "suggest",
    test: (s) =>
      /\b(suggest|recommend|what should i|give me|something to do|help me pick)\b/i.test(
        s
      )
  },
  {
    name: "checkin",
    test: (s) => /(check[\s-]?in|how am i|mood|feeling)/i.test(s)
  },
  {
    name: "tone",
    test: (s) =>
      /\b(tone|warmer|gentler|shorter|longer|less wordy|more direct)\b/i.test(s)
  },
  {
    name: "stuck",
    test: (s) =>
      /\b(stuck|avoid|avoiding|frozen|paralyz|can'?t start|can'?t do)\b/i.test(
        s
      )
  },
  {
    name: "help_didnt_help",
    test: (s) => /\b(didn'?t help|didn'?t work|made it worse)\b/i.test(s)
  },
  {
    name: "explain_modality",
    test: (s) =>
      /\b(what (is|does)|explain|tell me about)\b.*\b(behavioral activation|in[\s-]?vivo|exposure|graded)\b/i.test(
        s
      )
  },
  {
    name: "thanks",
    test: (s) => /\b(thanks|thank you|appreciate)\b/i.test(s)
  }
];

function classify(text) {
  for (const i of INTENTS) if (i.test(text)) return i.name;
  return "open";
}

async function executeIntent(intent, text) {
  if (intent === "add_exposure") {
    const title = extractActionTitle(text) || "small exposure step";
    const minutes = extractMinutes(text) || 15;
    const when = extractWhen(text);
    const suds = extractSuds(text);
    const a = {
      id: uid(),
      modality: "ivex",
      title,
      value: "",
      category: guessCategory(text),
      energy: suds ? Math.max(1, Math.min(5, Math.round(suds / 20))) : 2,
      duration: minutes,
      scheduledFor: when,
      linkedGoalId: null,
      safety: "",
      notes: "Added by Coach (graded exposure)",
      createdAt: new Date().toISOString(),
      completed: false
    };
    STATE.activations.push(a);
    STATE.logs.push({
      id: uid(),
      type: "reflection",
      content: `Coach added exposure "${title}"`,
      ts: a.createdAt
    });
    return { kind: "added_exposure", a };
  }

  if (intent === "add_activation") {
    const title = extractActionTitle(text) || "small kind step";
    const minutes = extractMinutes(text) || 15;
    const when = extractWhen(text);
    const a = {
      id: uid(),
      modality: "ba",
      title,
      value: "",
      category: guessCategory(text),
      energy: 2,
      duration: minutes,
      scheduledFor: when,
      linkedGoalId: null,
      notes: "Added by Coach",
      createdAt: new Date().toISOString(),
      completed: false
    };
    STATE.activations.push(a);
    STATE.logs.push({
      id: uid(),
      type: "reflection",
      content: `Coach added "${title}"`,
      ts: a.createdAt
    });
    return { kind: "added_activation", a };
  }

  if (intent === "add_goal") {
    const title =
      text
        .replace(/.*(add|create|set)\s+a?\s*goal( to| of| about)?/i, "")
        .trim() || "a goal that matters to me";
    const g = {
      id: uid(),
      title,
      value: "",
      targetDate: extractDate(text),
      createdAt: new Date().toISOString(),
      status: "open"
    };
    STATE.goals.push(g);
    return { kind: "added_goal", g };
  }

  if (intent === "summarize") return { kind: "summary", data: weekSummary() };
  if (intent === "suggest") return { kind: "suggestion", a: suggestActivation(text) };
  if (intent === "tone") {
    if (/short|less wordy|direct/i.test(text)) STATE.preferences.tone = "concise";
    else if (/long|more|detail/i.test(text)) STATE.preferences.tone = "detailed";
    else STATE.preferences.tone = "warm";
    return { kind: "tone", tone: STATE.preferences.tone };
  }
  if (intent === "checkin") return { kind: "checkin" };
  if (intent === "explain_modality") {
    const isIvex = /in[\s-]?vivo|exposure|graded/i.test(text);
    return { kind: "explain", modality: isIvex ? "ivex" : "ba" };
  }
  return { kind: intent };
}

function extractActionTitle(text) {
  const m = text.match(
    /(?:to\s+)?(walk|run|stretch|read|call|journal|meditate|cook|clean|tidy|shower|breathe|step outside|drink water|nap|message|ride|approach|enter|go to|stand near|sit in|attend)\s*([a-z0-9 '-]{0,40})/i
  );
  if (!m) return null;
  return (m[1] + (m[2] ? " " + m[2] : "")).trim();
}

function extractMinutes(text) {
  const m = text.match(/(\d{1,3})\s*(min|minute|m\b)/i);
  return m ? Number(m[1]) : null;
}

function extractSuds(text) {
  const m = text.match(/\bsuds\D{0,8}(\d{1,3})\b/i);
  return m ? Math.min(100, Number(m[1])) : null;
}

function extractWhen(text) {
  const now = new Date();
  if (/tonight/i.test(text)) {
    const d = new Date(now); d.setHours(20, 0, 0, 0); return d.toISOString();
  }
  if (/tomorrow/i.test(text)) {
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d.toISOString();
  }
  if (/today/i.test(text)) {
    const d = new Date(now); d.setHours(d.getHours() + 1, 0, 0, 0); return d.toISOString();
  }
  return null;
}

function extractDate(text) {
  const m = text.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function guessCategory(text) {
  if (/walk|run|stretch|move|breath|yoga|ride|bus|drive/i.test(text)) return "Movement";
  if (/call|message|friend|family|reach out|crowd|party|talk/i.test(text)) return "Connection";
  if (/shower|water|sleep|nap|cook|eat/i.test(text)) return "Care";
  if (/read|game|music|art|garden/i.test(text)) return "Pleasure";
  if (/learn|study|build|plan|practice/i.test(text)) return "Mastery";
  if (/meaning|values|reflect|journal/i.test(text)) return "Meaning";
  return "Care";
}

function suggestActivation(text) {
  const wantIvex = /exposure|in[\s-]?vivo|approach|fear|avoid|anxiety|phobia/i.test(text);
  const top = topUserTopics(3);
  const cat =
    (STATE.activations.filter((a) => a.completed).map((a) => a.category)[0]) ||
    "Care";
  const title = wantIvex
    ? `5-minute approach toward what you've been avoiding around ${top[0] || "today"}`
    : top.length
    ? `5 minutes around ${top[0]}`
    : "a 5 minute walk outside";
  return {
    id: uid(),
    modality: wantIvex ? "ivex" : "ba",
    title,
    category: cat,
    energy: 1,
    duration: 5,
    scheduledFor: null,
    createdAt: new Date().toISOString(),
    completed: false,
    notes: "Coach suggestion - start small."
  };
}

function weekSummary() {
  const since = Date.now() - 7 * 86400000;
  const acts = STATE.activations.filter(
    (a) => new Date(a.createdAt).getTime() > since
  );
  const done = acts.filter((a) => a.completed);
  const ba = acts.filter((a) => (a.modality || "ba") === "ba").length;
  const iv = acts.filter((a) => a.modality === "ivex").length;
  const cats = {};
  done.forEach((a) => (cats[a.category] = (cats[a.category] || 0) + 1));
  const topCat = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  const topics = topUserTopics(3);
  return {
    planned: acts.length,
    completed: done.length,
    ba,
    ivex: iv,
    topCategory: topCat ? topCat[0] : null,
    topics
  };
}

/* Knowledge retrieval */

function retrieveKnowledge(query, k = 3) {
  if (!KNOWLEDGE || !KNOWLEDGE.chunks || !KNOWLEDGE.chunks.length) return [];
  const qTopics = extractTopics(query);
  if (!qTopics.length) return [];
  const scored = KNOWLEDGE.chunks.map((c) => {
    const overlap = c.topics.filter((t) => qTopics.includes(t)).length;
    const matches = qTopics.reduce(
      (n, t) =>
        n + (c.text.toLowerCase().includes(t) ? 1 : 0),
      0
    );
    return { c, score: overlap * 2 + matches };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => ({
      modality: x.c.modality,
      label: x.c.label,
      text: x.c.text,
      score: x.score
    }));
}

function knowledgeSnippet(retrieved) {
  if (!retrieved.length) return "";
  const r = retrieved[0];
  let snip = r.text;
  const cut = snip.indexOf(". ");
  if (cut > 80 && cut < 320) snip = snip.slice(0, cut + 1);
  if (snip.length > 320) snip = snip.slice(0, 317) + "…";
  return snip.trim();
}

function composeReply(intent, action, text, retrieved) {
  const tone = STATE.preferences.tone || "warm";
  const memBits = recallSnippets(text);
  const recall = memBits.length ? `\n\nI remember you mentioned: ${memBits.join(" • ")}.` : "";
  const fromSource = knowledgeSnippet(retrieved);
  const sourceTag = retrieved.length
    ? `\n\nFrom ${retrieved[0].label}: "${fromSource}"`
    : "";

  if (action.kind === "added_exposure") {
    return tonal(
      `Saved an in-vivo exposure: "${action.a.title}" (${action.a.duration} min)${
        action.a.scheduledFor ? " for " + fmtDate(action.a.scheduledFor) : ""
      }. Approach gradually; stay long enough for new learning, not just relief.`,
      tone
    ) + recall + sourceTag;
  }
  if (action.kind === "added_activation") {
    return tonal(
      `Added activation "${action.a.title}" (${action.a.duration} min)${
        action.a.scheduledFor ? " for " + fmtDate(action.a.scheduledFor) : ""
      }. Action precedes motivation - showing up is the work.`,
      tone
    ) + recall + sourceTag;
  }
  if (action.kind === "added_goal") {
    return tonal(
      `Saved a goal: "${action.g.title}". I'll keep it in mind when suggesting steps from either modality.`,
      tone
    ) + recall;
  }
  if (action.kind === "summary") {
    const s = action.data;
    const main = `In the last 7 days you planned ${s.planned} step${s.planned===1?"":"s"} (${s.ba} activation${s.ba===1?"":"s"}, ${s.ivex} exposure${s.ivex===1?"":"s"}) and completed ${s.completed}.${s.topCategory ? " Your most-completed category was " + s.topCategory + "." : ""}${s.topics.length ? " You've been talking about: " + s.topics.join(", ") + "." : ""}`;
    return tonal(main, tone) + recall;
  }
  if (action.kind === "suggestion") {
    const a = action.a;
    STATE.activations.push(a);
    return tonal(
      `Try this ${a.modality === "ivex" ? "exposure" : "activation"}: ${a.title}. It's small on purpose. I added it to your plans - keep it or swap it.`,
      tone
    ) + recall + sourceTag;
  }
  if (action.kind === "tone") {
    return tonal(`Got it. I'll keep replies ${action.tone} from now on.`, tone);
  }
  if (action.kind === "checkin") {
    return tonal(
      `Quick check-in: on a 1-5 scale, where is your mood right now? You can just type the number, and I'll log it.`,
      tone
    );
  }
  if (action.kind === "stuck") {
    return tonal(
      `Stuck is information. Want a small valued activation (Behavioral Activation), or a SUDS 30 step toward what's avoided (In-Vivo Exposure)?`,
      tone
    ) + recall + sourceTag;
  }
  if (action.kind === "help_didnt_help") {
    return tonal(
      `Thanks for telling me. Two angles: BA says try a different category or shrink the action. Exposure says check whether you stayed long enough for new learning, or whether a safety behavior blocked it. Which fits?`,
      tone
    ) + sourceTag;
  }
  if (action.kind === "explain") {
    const m = (KNOWLEDGE && KNOWLEDGE.modalities && KNOWLEDGE.modalities[action.modality]) || null;
    if (m)
      return tonal(`${m.label}: ${m.summary} Key principles: ${m.principles.join("; ")}.`, tone) + sourceTag;
  }
  if (action.kind === "thanks") {
    return tonal(`Anytime. I'm here.`, tone);
  }

  if (/^[1-5]$/.test(text.trim())) {
    STATE.logs.push({
      id: uid(),
      type: "mood",
      content: `Mood logged: ${text.trim()}/5`,
      moodAfter: Number(text.trim()),
      ts: new Date().toISOString()
    });
    return tonal(
      `Logged mood ${text.trim()}/5. That's useful. Want me to suggest a small step that tends to help?`,
      tone
    );
  }

  return tonal(
    `I hear you. Want me to add an activation, build a small in-vivo exposure step, or just sit with this for a minute?`,
    tone
  ) + recall + sourceTag;
}

function tonal(text, tone) {
  if (tone === "concise") return text.split(". ")[0] + ".";
  if (tone === "detailed")
    return text + " Take what helps and leave the rest.";
  return text;
}

function recallSnippets(text) {
  const topics = extractTopics(text);
  if (!topics.length) return [];
  const scored = STATE.coach.facts
    .map((f) => ({
      f,
      score: extractTopics(f.fact).filter((t) => topics.includes(t)).length
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  return scored.map((x) =>
    x.f.fact.length > 80 ? x.f.fact.slice(0, 77) + "…" : x.f.fact
  );
}

/* ---------- Wire up ---------- */

function wire() {
  $$(".nav-item").forEach((b) =>
    b.addEventListener("click", () => navigate(b.dataset.route))
  );
  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-route]");
    if (t && !t.closest(".nav-item")) {
      navigate(t.dataset.route);
    }
  });

  $("#open-coach").addEventListener("click", openCoach);
  $("#close-coach").addEventListener("click", closeCoach);

  $("#coach-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#coach-input");
    const text = input.value;
    input.value = "";
    coachSend(text);
  });

  $("#coach-reset").addEventListener("click", () => {
    if (!confirm("Forget the recent conversation only? (Goals and plans stay.)"))
      return;
    STATE.coach.memory = STATE.coach.memory.slice(-1);
    saveState();
    drawCoach();
  });
}

function init() {
  wire();
  navigate("home");
  KNOWLEDGE_PROMISE.then(() => {
    if (route === "help") renderHelp();
    drawCoach();
  });
}

document.addEventListener("DOMContentLoaded", init);
