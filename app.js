"use strict";

const STORAGE_KEY = "breakFree.v1";
const LEGACY_KEY = "baApp.v1";
const KNOWLEDGE_URL = "knowledge.json";

const WELCOME_TEXT =
  "Hi. I'm here whenever you want company. I'll be a lot more useful once I know you a little — what's heavy, what you care about, and how you like to be spoken to. I'd like to interview you a bit. There's no set number of questions and you can stop me anytime by saying \"enough\". Want to start? Just say yes, or jump into anything that's on your mind.";

const DEFAULT_STATE = {
  createdAt: new Date().toISOString(),
  user: { name: "" },
  goals: [],
  activations: [],
  logs: [],
  preferences: { tone: "warm", reminders: true, theme: "warm" },
  profile: {
    name: "",
    communicationStyle: null,   // 'warm' | 'concise' | 'direct'
    challengeLevel: null,       // 'gentle' | 'moderate' | 'push'
    struggles: [],              // ['depression','anxiety','avoidance','stuck']
    struggleNotes: [],
    avoiding: [],
    values: [],                 // top topics extracted from value answers
    valueNotes: [],
    energizers: [],
    energizerNotes: [],
    pastWins: [],
    bestTimes: [],              // ['morning','afternoon','evening','night','variable']
    interviewNotes: [],
    interviewStarted: false,
    interviewComplete: false,
    interviewSkipped: false,
    interviewProgress: { askedTopics: [], currentTopic: null, openCloseAsked: false }
  },
  coach: {
    mode: "free",               // 'free' | 'interview'
    memory: [
      {
        ts: new Date().toISOString(),
        role: "coach",
        text: WELCOME_TEXT,
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
      profile: Object.assign(
        structuredClone(DEFAULT_STATE.profile),
        parsed.profile || {}
      ),
      coach: Object.assign({}, DEFAULT_STATE.coach, parsed.coach || {})
    });
    if (!merged.coach.mode) merged.coach.mode = "free";
    if (!merged.profile.interviewProgress)
      merged.profile.interviewProgress = { askedTopics: [], currentTopic: null, openCloseAsked: false };
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
  // Prefer an inlined corpus when available — single-file builds (BreakFree.html)
  // ship with `window.__KNOWLEDGE_INLINE` so the app works without any fetch().
  if (typeof window !== "undefined" && window.__KNOWLEDGE_INLINE) {
    KNOWLEDGE = window.__KNOWLEDGE_INLINE;
    return KNOWLEDGE;
  }
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
  const p = STATE.profile;
  const namePart = p.name ? `, ${p.name}` : "";
  const h = new Date().getHours();
  if (h < 5)
    return {
      title: `It's late${namePart}. Be gentle.`,
      lede: "Even a glass of water counts as showing up."
    };
  if (h < 12)
    return {
      title: `Good morning${namePart}.`,
      lede: "One small move can shape the whole day."
    };
  if (h < 17)
    return {
      title: `Hello${namePart}.`,
      lede: "If today's been heavy, the smallest step still counts."
    };
  if (h < 22)
    return {
      title: `Easing into the evening${namePart}.`,
      lede: "What would feel kind to do next?"
    };
  return {
    title: `Quiet hours${namePart}.`,
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
          "I think I'm avoiding something. Help me name it kindly and pick a small in-vivo exposure step.",
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
      sources.innerHTML = `<li class="muted">${
        KNOWLEDGE ? "Knowledge index unavailable." : "Knowledge index loading…"
      }</li>`;
      if (!KNOWLEDGE) KNOWLEDGE_PROMISE.then(() => route === "help" && renderHelp());
    } else {
      docs.forEach((d) => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${escapeHtml(d.label)}</strong> <span class="muted">— used as background, never quoted directly.</span>`;
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
      sub: "If anything is being avoided, a small approach step might widen the day."
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
    log.appendChild(b);
  });
  log.scrollTop = log.scrollHeight;

  const sub = $("#coach-sub");
  if (sub) {
    if (STATE.coach.mode === "interview") {
      sub.textContent = "Interview in progress — say \"enough\" anytime";
    } else if (!STATE.profile.interviewComplete) {
      sub.textContent = STATE.profile.interviewStarted
        ? "Interview paused — say \"continue interview\" to resume"
        : "I learn you best through a short interview — just say \"interview me\"";
    } else {
      const named = STATE.profile.name ? `Knows ${STATE.profile.name}` : "Personalized";
      sub.textContent = `${named} • style: ${STATE.profile.communicationStyle || "warm"}`;
    }
  }

  $("#coach-stat").textContent =
    `${STATE.coach.memory.length} memories • ${Object.keys(STATE.coach.topicCounts).length} topics`;

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
  const p = STATE.profile;
  if (STATE.coach.mode === "interview") {
    return ["skip this one", "enough for now", "ask me something else"];
  }

  const out = [];
  if (!p.interviewStarted) out.push("interview me");
  else if (!p.interviewComplete) out.push("continue interview");

  if (p.values?.length)
    out.push(`suggest an activation around ${p.values[0]}`);
  if (p.avoiding?.length)
    out.push(`build me a small in-vivo exposure step toward ${truncate(p.avoiding[0], 30)}`);
  if (STATE.activations.some((a) => !a.completed))
    out.push("what's the easiest thing I have planned?");
  out.push("summarize my week");
  if (!p.values?.length) out.push("suggest a 10-minute activation tied to a value");
  if (!p.avoiding?.length) out.push("build me a small in-vivo exposure step");
  return out.slice(0, 5);
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function coachSend(rawText, { silent = false } = {}) {
  const text = (rawText || "").trim();
  if (!text) return;
  pushMemory({ role: "user", text });

  await KNOWLEDGE_PROMISE;

  // Interview takes precedence over normal chat.
  if (STATE.coach.mode === "interview") {
    inferProfileFromMessage(text);
    handleInterviewAnswer(text);
    saveState();
    if (route === "home") render();
    else drawCoach();
    return;
  }

  // Allow user to start / resume / abort the interview from free chat.
  const lower = text.toLowerCase();
  if (
    /^(yes|sure|ok(ay)?|let'?s (start|do (it|this))|start interview|interview me|tell me about you|onboard me)/i.test(
      text
    ) &&
    !STATE.profile.interviewStarted
  ) {
    startInterview();
    saveState();
    if (route === "home") render();
    else drawCoach();
    return;
  }
  if (
    /(continue|resume).*interview|interview me( again)?|ask me more about/i.test(
      lower
    )
  ) {
    startInterview();
    saveState();
    if (route === "home") render();
    else drawCoach();
    return;
  }
  if (/^(skip|not now|no thanks|maybe later|skip interview)$/i.test(lower) && !STATE.profile.interviewStarted) {
    STATE.profile.interviewSkipped = true;
    pushMemory({
      role: "coach",
      text:
        "No worries. I'll learn you the slow way — through what you tell me as we go. Whenever you want the structured version, just say \"interview me\"."
    });
    saveState();
    if (route === "home") render();
    else drawCoach();
    return;
  }

  inferProfileFromMessage(text);

  const intent = classify(text);
  const action = await executeIntent(intent, text);
  const retrieved = retrieveKnowledge(text, 3); // used silently for grounding
  const reply = composeReply(intent, action, text, retrieved);
  pushMemory({ role: "coach", text: reply });
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
    topics
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

/* ---------- Interview engine ---------- */

const INTERVIEW_TOPICS = [
  {
    id: "name",
    needs: () => !STATE.profile.name,
    ask: () => "First — what should I call you?",
    parse: (text) => {
      const cleaned = text.trim().replace(/^(i'?m|my name is|call me|it's|im|name's)\s+/i, "");
      const name = cleaned.split(/[\s.,!?]+/)[0];
      if (name && /^[a-z'-]{1,30}$/i.test(name)) STATE.profile.name = capitalize(name);
    },
    confirm: () => STATE.profile.name ? `Nice to meet you, ${STATE.profile.name}.` : "Got it."
  },
  {
    id: "style",
    needs: () => !STATE.profile.communicationStyle,
    ask: () => {
      const n = STATE.profile.name ? `${STATE.profile.name}, h` : "H";
      return `${n}ow do you like being spoken to? Some people want me warm and gentle. Some want me concise and direct. Some want me to actually push them. Which feels closest?`;
    },
    parse: (text) => {
      const t = text.toLowerCase();
      if (/push|challenge|hard|tough|honest|brutal|real with/.test(t))
        STATE.profile.communicationStyle = "direct";
      // `\bless\b` — bare `less` also matches unless/hopeless/blessing and
      // persisted concise (every later reply truncated) after a warm answer.
      else if (/concise|short|brief|\bless\b|quick|to the point|don'?t ramble/.test(t))
        STATE.profile.communicationStyle = "concise";
      else STATE.profile.communicationStyle = "warm";
      STATE.preferences.tone =
        STATE.profile.communicationStyle === "concise" ? "concise" :
        STATE.profile.communicationStyle === "direct" ? "concise" : "warm";
    },
    confirm: () => {
      const s = STATE.profile.communicationStyle;
      if (s === "direct") return "Direct it is. I'll cut the fluff and tell you what I see.";
      if (s === "concise") return "Concise. Got it — short and useful.";
      return "Warm it is. I'll keep it gentle without being saccharine.";
    }
  },
  {
    id: "whats_here",
    needs: () => !STATE.profile.struggles?.length,
    ask: () =>
      "What's making life feel smaller right now? Could be heaviness in the mood, things you're avoiding, both, or something else entirely. However you'd describe it.",
    parse: (text) => {
      const t = text.toLowerCase();
      const s = new Set(STATE.profile.struggles || []);
      if (/depress|sad|heav|low|down|empty|numb|tired|exhaust|no energy|no motivation|hopeless|grief|flat|blah|drained/.test(t)) s.add("depression");
      if (/anxiet|fear|afraid|scared|panic|worry|dread|overwhelm|nervous/.test(t)) s.add("anxiety");
      if (/avoid|can'?t (do|face|go|leave)|don'?t leave|hide/.test(t)) s.add("avoidance");
      if (/stuck|frozen|paralyz|spinning|loop/.test(t)) s.add("stuck");
      STATE.profile.struggles = Array.from(s);
      STATE.profile.struggleNotes = (STATE.profile.struggleNotes || []).concat([text.trim()]).slice(-5);
    },
    confirm: () => {
      const s = STATE.profile.struggles;
      if (!s?.length) return "Thank you for telling me.";
      if (s.includes("depression") && (s.includes("anxiety") || s.includes("avoidance")))
        return "Heavy mood and avoidance — both are in scope here. Activation rebuilds the first; exposure rebuilds the second. We'll use both.";
      if (s.includes("depression")) return "Heaviness gets the activation playbook. Small valued moves that don't wait for motivation.";
      if (s.includes("anxiety") || s.includes("avoidance")) return "Avoidance gets the exposure playbook. Approach in graded steps, long enough to learn something new.";
      return "Thanks. I'll keep your words in mind.";
    }
  },
  {
    id: "avoiding",
    needs: () => {
      const s = STATE.profile.struggles || [];
      return (s.includes("anxiety") || s.includes("avoidance")) && !STATE.profile.avoiding?.length;
    },
    ask: () => "When you say you're avoiding things — what comes up first? Could be small (a phone call, leaving the house) or big (a place, a person, a whole part of life).",
    parse: (text) => {
      STATE.profile.avoiding = (STATE.profile.avoiding || []).concat([text.trim()]).slice(-6);
    },
    confirm: () => "Noted. I won't push that, but I'll have it on my map."
  },
  {
    id: "values",
    needs: () => !STATE.profile.values?.length,
    ask: () => "If today were a little lighter, what would you want to be doing more of? People, places, activities, anything that pulls at you.",
    parse: (text) => {
      const topics = extractTopics(text);
      STATE.profile.values = topics.slice(0, 8);
      STATE.profile.valueNotes = (STATE.profile.valueNotes || []).concat([text.trim()]).slice(-5);
    },
    confirm: () => {
      const v = STATE.profile.values?.slice(0, 3) || [];
      return v.length ? `Okay — I'll bias suggestions toward ${v.join(", ")} when I can.` : "Noted.";
    }
  },
  {
    id: "energizers",
    needs: () => !STATE.profile.energizers?.length,
    ask: () => "When you do feel like yourself — even for a flash — what are you usually doing?",
    parse: (text) => {
      STATE.profile.energizers = extractTopics(text).slice(0, 8);
      STATE.profile.energizerNotes = (STATE.profile.energizerNotes || []).concat([text.trim()]).slice(-5);
    },
    confirm: () => {
      const e = STATE.profile.energizers?.slice(0, 3) || [];
      return e.length ? `Good. ${capitalize(e[0])} is exactly the kind of thing I'll come back to when you're flat.` : "Good to know.";
    }
  },
  {
    id: "past_wins",
    needs: () => !STATE.profile.pastWins?.length,
    ask: () => "Has anything ever helped, even a little? Could be a habit, a person, a place, a routine, an idea you came back to.",
    parse: (text) => {
      STATE.profile.pastWins = (STATE.profile.pastWins || []).concat([text.trim()]).slice(-5);
    },
    confirm: () => "Got it. I'll lean on what's worked for you before the things that worked for someone else."
  },
  {
    id: "best_time",
    needs: () => !STATE.profile.bestTimes?.length,
    ask: () => "When in the day do you most often feel like you could try something? Mornings, afternoons, evenings, late nights — or does it change?",
    parse: (text) => {
      const t = text.toLowerCase();
      const times = [];
      if (/morning|am\b|early|wake/.test(t)) times.push("morning");
      if (/afternoon|midday|lunch/.test(t)) times.push("afternoon");
      if (/evening|dusk|sunset|after work|after dinner/.test(t)) times.push("evening");
      if (/night|late/.test(t)) times.push("night");
      if (/changes|varies|depends|never|random/.test(t)) times.push("variable");
      STATE.profile.bestTimes = times.length ? times : ["variable"];
    },
    confirm: () => {
      const t = STATE.profile.bestTimes;
      if (!t?.length || t.includes("variable")) return "Variable energy. I won't lean on time-of-day too hard then.";
      return `Good — I'll suggest the harder steps in your ${t[0]} window.`;
    }
  },
  {
    id: "challenge",
    needs: () => !STATE.profile.challengeLevel,
    ask: () => "Should I let you set the pace, or should I gently push you when I notice you holding back? You can change this later.",
    parse: (text) => {
      const t = text.toLowerCase();
      if (/push|challenge|hold accountable|tough|harder|don'?t let me|call me out/.test(t))
        STATE.profile.challengeLevel = "push";
      else if (/gentle|soft|slow|my pace|let me|don'?t push|easy/.test(t))
        STATE.profile.challengeLevel = "gentle";
      else STATE.profile.challengeLevel = "moderate";
    },
    confirm: () => {
      const c = STATE.profile.challengeLevel;
      if (c === "push") return "I'll push. If I get it wrong, tell me to ease up.";
      if (c === "gentle") return "Gentle. You set the pace; I won't nudge unless you ask.";
      return "Balanced. I'll nudge sometimes and back off when it doesn't fit.";
    }
  },
  {
    id: "open_close",
    needs: () => !STATE.profile.interviewProgress?.openCloseAsked,
    ask: () => `${STATE.profile.name ? STATE.profile.name + ", t" : "T"}his is enough for me to actually be useful. Anything else you want me to know before we start? Or just say "done" and we'll go.`,
    parse: (text) => {
      if (!/^(done|nope|no|nothing|let'?s go|that'?s it)$/i.test(text.trim()))
        STATE.profile.interviewNotes = (STATE.profile.interviewNotes || []).concat([text.trim()]).slice(-5);
      STATE.profile.interviewProgress.openCloseAsked = true;
    },
    confirm: () => "Okay. I've got you."
  }
];

function capitalize(s) {
  s = String(s || "");
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function nextInterviewTopic() {
  const asked = STATE.profile.interviewProgress.askedTopics || [];
  for (const topic of INTERVIEW_TOPICS) {
    if (asked.includes(topic.id)) continue;
    if (topic.needs && !topic.needs()) {
      asked.push(topic.id);
      continue;
    }
    return topic;
  }
  return null;
}

function startInterview() {
  STATE.coach.mode = "interview";
  STATE.profile.interviewStarted = true;
  STATE.profile.interviewSkipped = false;
  if (!STATE.profile.interviewProgress)
    STATE.profile.interviewProgress = { askedTopics: [], currentTopic: null, openCloseAsked: false };

  const topic = nextInterviewTopic();
  if (!topic) {
    STATE.profile.interviewComplete = true;
    STATE.coach.mode = "free";
    pushMemory({
      role: "coach",
      text: composeInterviewSummary()
    });
    return;
  }
  STATE.profile.interviewProgress.currentTopic = topic.id;
  pushMemory({ role: "coach", text: topic.ask() });
}

function handleInterviewAnswer(text) {
  const lower = text.trim().toLowerCase();

  // Pause / abort signals.
  if (/^(enough|that'?s enough|stop|pause|later|let'?s pick this up later)$/.test(lower)) {
    STATE.coach.mode = "free";
    pushMemory({
      role: "coach",
      text: `Got it. We can pick this up whenever — just say "continue interview". For now I'll work with what I've already learned.`
    });
    return;
  }

  // Skip signal — mark current topic and move on without parsing.
  const skip = /^(skip|next|pass)$/.test(lower);

  const currentId = STATE.profile.interviewProgress.currentTopic;
  const topic = INTERVIEW_TOPICS.find((t) => t.id === currentId);
  let confirmation = "";
  if (topic) {
    if (!skip) {
      try { topic.parse(text); } catch {}
      confirmation = topic.confirm ? topic.confirm() : "";
    }
    const asked = STATE.profile.interviewProgress.askedTopics || [];
    if (!asked.includes(currentId)) asked.push(currentId);
    STATE.profile.interviewProgress.askedTopics = asked;
  }

  const next = nextInterviewTopic();
  if (!next) {
    STATE.profile.interviewComplete = true;
    STATE.coach.mode = "free";
    const head = confirmation ? confirmation + "\n\n" : "";
    pushMemory({ role: "coach", text: head + composeInterviewSummary() });
    return;
  }

  STATE.profile.interviewProgress.currentTopic = next.id;
  const askText = next.ask();
  const text2 = confirmation ? `${confirmation}\n\n${askText}` : askText;
  pushMemory({ role: "coach", text: text2 });
}

function composeInterviewSummary() {
  const p = STATE.profile;
  const lines = [];
  lines.push(`Here's what I have${p.name ? ", " + p.name : ""} — tell me where I'm wrong.`);

  if (p.struggles?.length) {
    const map = { depression: "heaviness in mood", anxiety: "anxiety", avoidance: "avoidance", stuck: "feeling stuck" };
    const labels = p.struggles.map((s) => map[s] || s);
    lines.push(`• What's heavy: ${labels.join(", ")}.`);
  }
  if (p.values?.length) lines.push(`• What pulls at you: ${p.values.slice(0, 4).join(", ")}.`);
  if (p.energizers?.length) lines.push(`• When you feel most you: ${p.energizers.slice(0, 4).join(", ")}.`);
  if (p.avoiding?.length) lines.push(`• On the avoidance map: ${truncate(p.avoiding[0], 60)}.`);
  if (p.bestTimes?.length && !p.bestTimes.includes("variable"))
    lines.push(`• Best windows: ${p.bestTimes.join(", ")}.`);
  if (p.pastWins?.length) lines.push(`• Worth coming back to: ${truncate(p.pastWins[0], 60)}.`);
  if (p.challengeLevel) {
    const cmap = { push: "I'll push when you hold back", gentle: "I'll keep it gentle and let you set the pace", moderate: "I'll nudge when it fits, back off when it doesn't" };
    lines.push(`• My voice: ${cmap[p.challengeLevel]}.`);
  }

  lines.push("");
  lines.push("Want a first small step that fits this, or is there something already on your mind?");
  return lines.join("\n");
}

function inferProfileFromMessage(text) {
  // Quietly enrich profile from free-chat content. Does not overwrite explicit answers.
  const t = text.toLowerCase();
  const p = STATE.profile;
  const newTopics = extractTopics(text);

  if (/i (love|enjoy|like) (to )?\w+/.test(t) || /makes me feel (good|alive|like myself)/.test(t)) {
    p.energizers = Array.from(new Set([...(p.energizers || []), ...newTopics])).slice(0, 12);
  }
  if (/i'?m avoiding|i can'?t (face|go|leave|do)|i keep putting off/.test(t)) {
    p.avoiding = (p.avoiding || []).concat([text.trim()]).slice(-6);
  }
  if (/i want to|hoping to|i'?d like to|my goal is|i wish i could/.test(t)) {
    p.values = Array.from(new Set([...(p.values || []), ...newTopics])).slice(0, 12);
  }
}

const INTENTS = [
  {
    name: "add_exposure",
    test: (s) =>
      /\b(add|schedule|plan|create|build)\b.*\b(exposure|expose|in[\s-]?vivo|hierarchy)\b/i.test(s) ||
      /\bsuds\b/i.test(s)
  },
  {
    name: "add_activation",
    test: (s) =>
      /\b(add|schedule|plan|create)\b.*\b(activation|activity|step|task|walk|run|read|call|stretch|meditate|journal|nap|cook)\b/i.test(s) ||
      /^let'?s plan/i.test(s)
  },
  { name: "add_goal", test: (s) => /\b(add|create|set)\b.*\bgoal\b/i.test(s) },
  { name: "summarize", test: (s) => /\b(summarize|summary|recap|how (have|did) i)\b/i.test(s) },
  {
    name: "suggest",
    test: (s) =>
      /\b(suggest|recommend|what should i|give me|something to do|help me pick|first small step|easiest thing)\b/i.test(s)
  },
  { name: "checkin", test: (s) => /(check[\s-]?in|how am i|mood|feeling)/i.test(s) },
  { name: "tone", test: (s) => /\b(tone|warmer|gentler|shorter|longer|less wordy|more direct|push me)\b/i.test(s) },
  { name: "stuck", test: (s) => /\b(stuck|avoid|avoiding|frozen|paralyz|can'?t start|can'?t do)\b/i.test(s) },
  { name: "help_didnt_help", test: (s) => /\b(didn'?t help|didn'?t work|made it worse)\b/i.test(s) },
  {
    name: "explain_modality",
    test: (s) =>
      /\b(what (is|does)|explain|tell me about|how does)\b.*\b(behavioral activation|in[\s-]?vivo|exposure|graded|the work|this app)\b/i.test(s)
  },
  { name: "thanks", test: (s) => /\b(thanks|thank you|appreciate)\b/i.test(s) }
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
      text.replace(/.*(add|create|set)\s+a?\s*goal( to| of| about)?/i, "").trim() ||
      "a goal that matters to me";
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
    if (/short|less wordy|direct|push/i.test(text)) {
      STATE.preferences.tone = "concise";
      STATE.profile.communicationStyle = /push/i.test(text) ? "direct" : "concise";
    } else if (/long|more|detail/i.test(text)) {
      STATE.preferences.tone = "detailed";
      STATE.profile.communicationStyle = "warm";
    } else {
      STATE.preferences.tone = "warm";
      STATE.profile.communicationStyle = "warm";
    }
    return { kind: "tone", tone: STATE.preferences.tone };
  }
  if (intent === "checkin") return { kind: "checkin" };
  if (intent === "explain_modality") {
    const isIvex = /in[\s-]?vivo|exposure|graded|avoid|fear/i.test(text);
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
  const p = STATE.profile;
  const wantIvex =
    /exposure|in[\s-]?vivo|approach|fear|avoid|anxiety|phobia/i.test(text) ||
    (p.struggles?.includes("anxiety") && !/activation|movement|connection/i.test(text));

  if (wantIvex && p.avoiding?.length) {
    const target = truncate(p.avoiding[p.avoiding.length - 1], 40);
    return {
      id: uid(),
      modality: "ivex",
      title: `5-minute approach toward ${target}`,
      category: "Connection",
      energy: 1,
      duration: 5,
      scheduledFor: null,
      createdAt: new Date().toISOString(),
      completed: false,
      notes: "Coach suggestion — start small, stay long enough to learn."
    };
  }

  if (!wantIvex && p.energizers?.length) {
    return {
      id: uid(),
      modality: "ba",
      title: `5 minutes of ${p.energizers[0]}`,
      category: guessCategory(p.energizers[0]),
      energy: 1,
      duration: 5,
      scheduledFor: null,
      createdAt: new Date().toISOString(),
      completed: false,
      notes: "Coach suggestion — drawn from what tends to make you feel like you."
    };
  }

  if (!wantIvex && p.values?.length) {
    return {
      id: uid(),
      modality: "ba",
      title: `5 minutes around ${p.values[0]}`,
      category: guessCategory(p.values[0]),
      energy: 1,
      duration: 5,
      scheduledFor: null,
      createdAt: new Date().toISOString(),
      completed: false,
      notes: "Coach suggestion — anchored to one of your values."
    };
  }

  return {
    id: uid(),
    modality: wantIvex ? "ivex" : "ba",
    title: wantIvex ? "5-minute approach toward what you've been avoiding" : "a 5 minute walk outside",
    category: "Care",
    energy: 1,
    duration: 5,
    scheduledFor: null,
    createdAt: new Date().toISOString(),
    completed: false,
    notes: "Coach suggestion — start small."
  };
}

function weekSummary() {
  const since = Date.now() - 7 * 86400000;
  const acts = STATE.activations.filter((a) => new Date(a.createdAt).getTime() > since);
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

/* Knowledge retrieval — used silently; never quoted to the user. */

function retrieveKnowledge(query, k = 3) {
  if (!KNOWLEDGE || !KNOWLEDGE.chunks || !KNOWLEDGE.chunks.length) return [];
  const qTopics = extractTopics(query);
  if (!qTopics.length) return [];
  const scored = KNOWLEDGE.chunks.map((c) => {
    const overlap = c.topics.filter((t) => qTopics.includes(t)).length;
    const matches = qTopics.reduce(
      (n, t) => n + (c.text.toLowerCase().includes(t) ? 1 : 0),
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

function dominantModality(retrieved) {
  if (!retrieved.length) return null;
  const tally = retrieved.reduce(
    (acc, r) => ((acc[r.modality] = (acc[r.modality] || 0) + r.score), acc),
    {}
  );
  return Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
}

function composeReply(intent, action, text, retrieved) {
  const p = STATE.profile;
  const nameOpener = openerWithName();
  const groundedAngle = retrieved.length ? dominantModality(retrieved) : null;

  if (action.kind === "added_exposure") {
    return voice(
      `${nameOpener}saved an exposure: "${action.a.title}" (${action.a.duration} min)${
        action.a.scheduledFor ? " for " + fmtDate(action.a.scheduledFor) : ""
      }. Approach gradually. The point isn't to feel better — the point is to stay long enough that something new can land.`,
      { allowChallenge: true }
    );
  }

  if (action.kind === "added_activation") {
    const valueBit =
      p.values?.length && Math.random() < 0.6
        ? ` Tying it to ${p.values[0]} would make it count more.`
        : "";
    return voice(
      `${nameOpener}added "${action.a.title}" (${action.a.duration} min)${
        action.a.scheduledFor ? " for " + fmtDate(action.a.scheduledFor) : ""
      }.${valueBit} Showing up is the work, not feeling motivated about it.`,
      { allowGentle: true }
    );
  }

  if (action.kind === "added_goal") {
    return voice(`${nameOpener}saved a goal: "${action.g.title}". I'll keep it in mind when I suggest steps.`);
  }

  if (action.kind === "summary") {
    const s = action.data;
    const main = `In the last 7 days you planned ${s.planned} step${s.planned === 1 ? "" : "s"} (${s.ba} activation${s.ba === 1 ? "" : "s"}, ${s.ivex} exposure${s.ivex === 1 ? "" : "s"}) and completed ${s.completed}.${
      s.topCategory ? ` Most-completed category: ${s.topCategory}.` : ""
    }`;
    const personal =
      p.values?.length && s.completed > 0
        ? ` That lines up with what you said matters: ${p.values.slice(0, 2).join(" and ")}.`
        : p.struggles?.includes("avoidance") && s.ivex === 0
        ? " Worth noting — no exposures yet this week. Want me to scaffold a small one?"
        : "";
    return voice(nameOpener + main + personal);
  }

  if (action.kind === "suggestion") {
    const a = action.a;
    STATE.activations.push(a);
    const why =
      a.modality === "ivex" && p.avoiding?.length
        ? " It's small on purpose — small enough that you might actually do it."
        : a.modality === "ba" && p.energizers?.length
        ? ` I picked this because you said this is when you feel most you.`
        : " It's small on purpose. Keep it or swap it.";
    return voice(`${nameOpener}try this: ${a.title}.${why} I added it to your plans.`);
  }

  if (action.kind === "tone") {
    return voice(`${nameOpener}got it. I'll keep replies ${action.tone} from now on.`);
  }

  if (action.kind === "checkin") {
    return voice(
      `${nameOpener}quick check-in: on a 1-5 scale, where is your mood right now? Just type the number — I'll log it.`
    );
  }

  if (action.kind === "stuck") {
    const opt =
      p.avoiding?.length
        ? `One option: a tiny approach toward ${truncate(p.avoiding[0], 40)}. Another: a 5-minute valued activation that doesn't ask anything hard.`
        : `One option: a 5-minute valued activation. Another: a tiny step toward something you've been avoiding.`;
    return voice(`${nameOpener}stuck is information, not failure. ${opt} Which one?`, {
      allowChallenge: true
    });
  }

  if (action.kind === "help_didnt_help") {
    return voice(
      `${nameOpener}two angles. If your mood didn't lift, the action might need to be tied to something you actually value (not just something you "should" do). If avoidance didn't shrink, the question is whether you stayed long enough for new learning, or whether a safety behavior blocked it. Which fits closer?`
    );
  }

  if (action.kind === "explain") {
    if (action.modality === "ivex") {
      return voice(
        `${nameOpener}graded exposure rebuilds approach to what's been avoided. You build a hierarchy from easiest to hardest, then start in the middle-low — somewhere a little uncomfortable but doable. You stay long enough that the feared thing has a chance to not happen, which is what actually rewires the response. Safety behaviors (the things you do to "make it bearable") block that learning, so you drop one at a time as you go.`,
        { preserve: true }
      );
    }
    return voice(
      `${nameOpener}behavioral activation rebuilds contact with what matters. The trick is that motivation comes after action, not before. You schedule a small valued thing, do it whether or not you feel like it, then notice what changed. Repetition is the lever, not intensity.`,
      { preserve: true }
    );
  }

  if (action.kind === "thanks") {
    return voice(`${nameOpener}anytime. I'm here.`);
  }

  if (/^[1-5]$/.test(text.trim())) {
    STATE.logs.push({
      id: uid(),
      type: "mood",
      content: `Mood logged: ${text.trim()}/5`,
      moodAfter: Number(text.trim()),
      ts: new Date().toISOString()
    });
    const n = Number(text.trim());
    const reaction =
      n <= 2 ? "Heavy. Want a tiny step that tends to lift the floor a little?"
        : n === 3 ? "Middle. A small activation can sometimes tilt this either way."
        : "Up. Worth noticing what's working today, so you can do it again.";
    return voice(`${nameOpener}logged ${text.trim()}/5. ${reaction}`);
  }

  // Open / unclassified — synthesize a response that honors profile + grounded angle.
  const recall = recallSnippets(text);
  const recallBit = recall.length ? ` I remember you mentioned: ${recall.join(" • ")}.` : "";

  const angleBit =
    groundedAngle === "ivex"
      ? " This sounds more like an avoidance pattern than a mood pattern — exposure tools fit better here."
      : groundedAngle === "ba"
      ? " This sounds more like a mood/energy pattern than an avoidance one — activation tools fit better here."
      : "";

  return voice(
    `${nameOpener}I hear you.${angleBit}${recallBit} Want me to add a small activation, build a small in-vivo exposure step, or just sit with this for a minute?`
  );
}

/* ---------- Voice helpers ---------- */

function openerWithName() {
  const p = STATE.profile;
  if (!p.name) return "";
  // Use the name with about 35% probability so it doesn't feel performative.
  return Math.random() < 0.35 ? `${p.name} — ` : "";
}

function voice(text, opts = {}) {
  const p = STATE.profile;
  const tone = STATE.preferences.tone || "warm";
  let out = opts.preserve ? text : tonal(text, tone);

  if (p.challengeLevel === "push" && opts.allowChallenge) {
    out += " You can do harder than that — I'll trust you to call the limit.";
  } else if (p.challengeLevel === "gentle" && opts.allowGentle) {
    out += " Take your time with this. The smallest version is enough.";
  }
  return out;
}

function tonal(text, tone) {
  if (tone === "concise") {
    // Keep the first 2 sentences when concise; drop the rest.
    const parts = text.split(/(?<=[.!?])\s+/);
    return parts.slice(0, 2).join(" ").trim();
  }
  if (tone === "detailed") return text + " Take what helps and leave the rest.";
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

  function submitCoach() {
    const input = $("#coach-input");
    const text = input.value;
    input.value = "";
    if (text && text.trim()) coachSend(text);
  }

  $("#coach-form").addEventListener("submit", (e) => {
    e.preventDefault();
    submitCoach();
  });

  // Enter to send, Shift+Enter for newline.
  $("#coach-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitCoach();
    }
  });

  $("#coach-reset").addEventListener("click", () => {
    if (!confirm("Forget the recent conversation only? (Goals, plans, and your interview profile stay.)"))
      return;
    STATE.coach.memory = STATE.coach.memory.slice(-1);
    saveState();
    drawCoach();
  });

  const interviewBtn = $("#coach-interview");
  if (interviewBtn) {
    interviewBtn.addEventListener("click", () => {
      if (STATE.coach.mode === "interview") {
        // Force-finish current question and pause
        STATE.coach.mode = "free";
        pushMemory({ role: "coach", text: 'Paused. Say "continue interview" anytime.' });
        saveState();
        drawCoach();
        return;
      }
      startInterview();
      saveState();
      drawCoach();
    });
  }
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
