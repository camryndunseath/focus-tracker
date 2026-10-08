/* Focus Tracker
 * Times study and work sessions, records where you were, distractions and time
 * away from the tab, asks for a 1–5 focus rating at the end, and keeps a short
 * daily check-in (wake-up time, first thing you did, food, other plans).
 * It then looks for patterns between all of that and your focus.
 * Everything is stored in this browser's localStorage.
 */
(() => {
  "use strict";

  const STORE_KEY = "focus-tracker.sessions.v1";
  const ACTIVE_KEY = "focus-tracker.active.v1";
  const KIND_KEY = "focus-tracker.kind.v1"; // remembers Studying/Working between visits
  const PLACE_KEY = "focus-tracker.place.v1"; // remembers the last place
  const DAYS_KEY = "focus-tracker.days.v1"; // daily check-ins, keyed by YYYY-MM-DD
  const DAY_STARTS_AT = 4; // sessions before 4am count toward the previous day
  const FULL_BAND_MINUTES = 50; // highlighter under the clock is full after this long
  const MIN_SESSIONS_FOR_INSIGHTS = 1;
  const MIN_SESSIONS_PER_GROUP = 2; // a time block needs this many sessions to be called "best"
  const LOG_PAGE = 20;

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const BLOCKS = [
    { key: "early", label: "Early", range: "6–9am", from: 6, to: 9, phrase: "early morning (6–9am)" },
    { key: "morning", label: "Morning", range: "9–noon", from: 9, to: 12, phrase: "late morning (9am–noon)" },
    { key: "midday", label: "Midday", range: "noon–3", from: 12, to: 15, phrase: "early afternoon (noon–3pm)" },
    { key: "afternoon", label: "Afternoon", range: "3–6pm", from: 15, to: 18, phrase: "late afternoon (3–6pm)" },
    { key: "evening", label: "Evening", range: "6–9pm", from: 18, to: 21, phrase: "evening (6–9pm)" },
    { key: "night", label: "Night", range: "9–mid", from: 21, to: 24, phrase: "night (9pm–midnight)" },
    { key: "late", label: "Late", range: "mid–6am", from: 0, to: 6, phrase: "late night (midnight–6am)" },
  ];
  const LENGTHS = [
    { label: "Under 25 min", max: 25 },
    { label: "25–50 min", max: 50 },
    { label: "50–90 min", max: 90 },
    { label: "90+ min", max: Infinity },
  ];
  const RATING_WORDS = ["", "Barely", "Scattered", "Okay", "Solid", "Locked in"];
  const KINDS = { study: { label: "Studying", noun: "studying" }, work: { label: "Working", noun: "working" } };
  const DEFAULT_PLACES = ["Home", "Library", "Café", "Campus", "Work"];
  const WAKES = [
    { label: "Before 7am", phrase: "before 7am", before: 7 * 60 },
    { label: "7–9am", phrase: "between 7 and 9am", before: 9 * 60 },
    { label: "9–11am", phrase: "between 9 and 11am", before: 11 * 60 },
    { label: "11am or later", phrase: "at 11am or later", before: Infinity },
  ];
  const BUSY = [
    { label: "Nothing else", phrase: "nothing else on", max: 0 },
    { label: "1–2 things", phrase: "1 or 2 other things on", max: 2 },
    { label: "3–4 things", phrase: "3 or 4 other things on", max: 4 },
    { label: "5 or more", phrase: "5 or more other things on", max: Infinity },
  ];
  // Sessions saved before the Studying/Working choice existed count as studying
  const kindOf = (s) => (s.kind === "work" ? "work" : "study");

  // ---------- Storage ----------
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      toast("Couldn't save. Your browser may be blocking storage.");
    }
  }

  let sessions = load(STORE_KEY, []).filter(isValidSession);
  let active = load(ACTIVE_KEY, null); // { start, kind, distractions: [ms], awayMs, hiddenAt }
  let logShown = LOG_PAGE;
  let filter = "all"; // which sessions the insights cover: all, study or work
  let days = load(DAYS_KEY, {});
  if (!days || typeof days !== "object" || Array.isArray(days)) days = {};
  let editingToday = false;
  function saveDays() { store(DAYS_KEY, days); }

  function saveSessions() { store(STORE_KEY, sessions); }
  function saveActive() { store(ACTIVE_KEY, active); }

  function isValidSession(s) {
    return s && typeof s.start === "number" && typeof s.end === "number" &&
      s.end > s.start && s.rating >= 1 && s.rating <= 5;
  }

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    activity: $("activity"), filter: $("filter"),
    location: $("location"), placeChips: $("place-chips"),
    todayForm: $("today-form"), todaySummary: $("today-summary"), todayEdit: $("today-edit"), todayCancel: $("today-cancel"),
    wake: $("wake"), firstChips: $("first-chips"), firstOther: $("first-other"), food: $("food"), plans: $("plans"),
    places: $("places"), wakes: $("wakes"), firsts: $("firsts"), busy: $("busy"),
    timer: $("timer"), band: $("clock-band"), status: $("status"), hint: $("hint"),
    start: $("start"), distract: $("distract"), distractCount: $("distract-count"), finish: $("finish"),
    insightsEmpty: $("insights-empty"), insightsBody: $("insights-body"),
    sample: $("sample"), sampleBanner: $("sample-banner"), clearSample: $("clear-sample"),
    headlines: $("headlines"), stats: $("stats"), heatmap: $("heatmap"),
    lengths: $("lengths"), kinds: $("kinds"),
    log: $("log"), logEmpty: $("log-empty"),
    exportCsv: $("export-csv"), exportJson: $("export-json"), importInput: $("import"),
    dialog: $("rate"), rateForm: $("rate-form"), rateSummary: $("rate-summary"),
    toast: $("toast"),
  };

  // ---------- Formatting ----------
  const pad = (n) => String(n).padStart(2, "0");
  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }
  function duration(min) {
    min = Math.round(min);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} hr ${m} min` : `${h} hr`;
  }
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const one = (n) => (Math.round(n * 10) / 10).toFixed(1);
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- Session derived values ----------
  const minutesOf = (s) => (s.end - s.start) / 60000;
  const focusedMinutesOf = (s) => Math.max(0, minutesOf(s) - (s.awayMs || 0) / 60000);
  const distractionsOf = (s) => (s.distractions ? s.distractions.length : 0);
  const weekdayOf = (s) => (new Date(s.start).getDay() + 6) % 7; // Monday = 0
  function blockOf(s) {
    const h = new Date(s.start).getHours();
    return BLOCKS.findIndex((b) => h >= b.from && h < b.to);
  }
  const lengthOf = (s) => LENGTHS.findIndex((l) => minutesOf(s) < l.max);

  // ---------- Days and places ----------
  // Which day a moment belongs to. A 1am session still counts as part of the day before.
  function dayKeyOf(ms) {
    const d = new Date(ms);
    if (d.getHours() < DAY_STARTS_AT) d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const todayKey = () => dayKeyOf(Date.now());
  const dateFromKey = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };
  const dayOf = (s) => days[dayKeyOf(s.start)];

  const tidy = (v) => String(v || "").trim().replace(/\s+/g, " ");
  const keyText = (v) => tidy(v).toLowerCase();
  function wakeMinutes(wake) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(wake || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function wakeLabel(wake) {
    const mins = wakeMinutes(wake);
    if (mins === null) return "";
    const d = new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60);
    return timeFmt.format(d);
  }

  // Grouping keys for the charts. Returning "" leaves a session out of that chart.
  const placeKeyOf = (s) => keyText(s.place);
  function wakeOf(s) {
    const mins = wakeMinutes(dayOf(s)?.wake);
    return mins === null ? "" : WAKES.findIndex((w) => mins < w.before);
  }
  const firstKeyOf = (s) => keyText(dayOf(s)?.first);
  function busyOf(s) {
    const d = dayOf(s);
    if (!d) return "";
    const n = Array.isArray(d.plans) ? d.plans.length : 0;
    return BUSY.findIndex((b) => n <= b.max);
  }
  // Shows text the way the user first typed it, while grouping "library" with "Library"
  function labelsFor(list, getter) {
    const labels = new Map();
    for (const s of list) {
      const v = tidy(getter(s));
      if (v && !labels.has(v.toLowerCase())) labels.set(v.toLowerCase(), v);
    }
    return labels;
  }

  // ---------- Running a session ----------
  let ticker = null;

  function chosenKind() {
    const checked = el.activity.querySelector("input:checked");
    return checked && checked.value === "work" ? "work" : "study";
  }
  function setChosenKind(kind) {
    const input = el.activity.querySelector(`input[value="${kind}"]`);
    if (input) input.checked = true;
  }
  el.activity.addEventListener("change", () => store(KIND_KEY, chosenKind()));

  function startSession() {
    active = {
      start: Date.now(),
      kind: chosenKind(),
      place: tidy(el.location.value),
      distractions: [],
      awayMs: 0,
      hiddenAt: document.hidden ? Date.now() : null,
    };
    saveActive();
    renderActive();
  }

  function logDistraction() {
    if (!active) return;
    active.distractions.push(Date.now());
    saveActive();
    renderActive();
    toast("Noted. Back to it.");
  }

  function finishSession() {
    if (!active) return;
    settleAway();
    if (!active.end) active.end = Date.now();
    saveActive();
    stopTicker();
    const min = (active.end - active.start) / 60000;
    const d = active.distractions.length;
    const away = Math.round(active.awayMs / 60000);
    let summary = `${duration(Math.max(1, min))} of ${KINDS[kindOf(active)].noun}${active.place ? ` at ${active.place}` : ""}, ${plural(d, "distraction")}`;
    if (away >= 1) summary += `, ${duration(away)} away from this tab`;
    el.rateSummary.textContent = summary + ".";
    el.rateForm.reset();
    el.dialog.showModal();
  }

  el.dialog.addEventListener("close", () => {
    const choice = el.dialog.returnValue;
    if (!active) return;
    if (choice === "save") {
      const data = new FormData(el.rateForm);
      const session = {
        id: `s${active.start}`,
        start: active.start,
        end: active.end,
        kind: kindOf(active),
        place: tidy(active.place),
        rating: Number(data.get("rating")),
        distractions: active.distractions,
        awayMs: Math.round(active.awayMs),
        note: String(data.get("note") || "").trim(),
      };
      if (!isValidSession(session)) { toast("Pick a rating to save the session."); return reopen(); }
      removeSampleData(false);
      sessions.push(session);
      sessions.sort((a, b) => a.start - b.start);
      saveSessions();
      active = null;
      saveActive();
      toast("Session saved.");
    } else if (choice === "discard") {
      active = null;
      saveActive();
      toast("Session discarded.");
    } else {
      // "Keep going" or Escape: resume the same session
      delete active.end;
      saveActive();
    }
    renderActive();
    renderAll();
  });
  function reopen() { setTimeout(() => el.dialog.showModal(), 0); }

  function settleAway() {
    if (active && active.hiddenAt) {
      active.awayMs += Date.now() - active.hiddenAt;
      active.hiddenAt = null;
    }
  }

  document.addEventListener("visibilitychange", () => {
    // Coming back to the tab after midnight shows the new day's check-in
    if (!document.hidden && !editingToday) renderToday();
    if (!active || active.end) return;
    if (document.hidden) active.hiddenAt = Date.now();
    else settleAway();
    saveActive();
    renderActive();
  });

  function stopTicker() { clearInterval(ticker); ticker = null; }

  function tick() {
    if (!active) return;
    const elapsed = (active.end || Date.now()) - active.start;
    el.timer.textContent = clock(elapsed);
    el.band.style.setProperty("--progress", Math.min(1, elapsed / (FULL_BAND_MINUTES * 60000)).toFixed(4));
    document.title = `${clock(elapsed)} · Focus Tracker`;
  }

  function renderActive() {
    const running = !!active && !active.end;
    el.start.hidden = !!active;
    el.distract.hidden = !running;
    el.finish.hidden = !running;
    el.activity.querySelectorAll("input").forEach((i) => { i.disabled = !!active; });
    el.location.disabled = !!active;
    el.placeChips.querySelectorAll("button").forEach((b) => { b.disabled = !!active; });

    if (!active) {
      stopTicker();
      el.timer.textContent = "0:00:00";
      el.band.style.setProperty("--progress", 0);
      el.status.textContent = sessions.length ? "Ready for another session." : "Ready when you are.";
      document.title = "Focus Tracker";
      return;
    }

    setChosenKind(kindOf(active));
    el.location.value = active.place || "";
    el.distractCount.textContent = active.distractions.length;
    const parts = [`Started at ${timeFmt.format(active.start)}`];
    const away = Math.floor((active.awayMs || 0) / 60000);
    if (away >= 1) parts.push(`${duration(away)} away from this tab`);
    el.status.textContent = parts.join(". ") + ".";
    tick();
    if (running && !ticker) ticker = setInterval(tick, 1000);
  }

  // ---------- Analysis ----------
  function summarize(list) {
    const n = list.length;
    if (!n) return null;
    const minutes = list.reduce((t, s) => t + minutesOf(s), 0);
    // Weight ratings by session length so a 2-hour session counts more than a 10-minute one
    const rating = list.reduce((t, s) => t + s.rating * minutesOf(s), 0) / minutes;
    const distractions = list.reduce((t, s) => t + distractionsOf(s), 0);
    const perHour = minutes > 0 ? distractions / (minutes / 60) : 0;
    return { n, minutes, rating, perHour };
  }

  function groupBy(list, keyFn) {
    const groups = new Map();
    for (const s of list) {
      const k = keyFn(s);
      if (k === "" || k === -1 || k === undefined || k === null) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    return groups;
  }

  // Ranks groups by average rating, then by fewer distractions per hour
  function rank(groups) {
    return [...groups.entries()]
      .map(([key, list]) => ({ key, ...summarize(list) }))
      .filter((g) => g.n >= MIN_SESSIONS_PER_GROUP)
      .sort((a, b) => (b.rating - a.rating) || (a.perHour - b.perHour));
  }

  function headlines(list) {
    const out = [];
    const byBlock = rank(groupBy(list, blockOf));
    if (byBlock.length >= 2) {
      const best = byBlock[0], worst = byBlock[byBlock.length - 1];
      out.push(`You focus best in the <strong>${BLOCKS[best.key].phrase}</strong>, averaging ${one(best.rating)} out of 5 over ${plural(best.n, "session")}.`);
      if (worst.rating < best.rating - 0.3) {
        out.push(`Your focus is weakest in the <strong>${BLOCKS[worst.key].phrase}</strong> at ${one(worst.rating)} out of 5. Save easier tasks for then.`);
      }
    } else if (byBlock.length === 1) {
      out.push(`So far most of your sessions are in the <strong>${BLOCKS[byBlock[0].key].phrase}</strong>. Try a few sessions at other times to compare.`);
    }

    const byPlace = rank(groupBy(list, placeKeyOf));
    if (byPlace.length >= 2) {
      const names = labelsFor(list, (s) => s.place);
      out.push(`You focus best at <strong>${escapeHtml(names.get(byPlace[0].key))}</strong>, averaging ${one(byPlace[0].rating)} out of 5.`);
    }

    const byWake = rank(groupBy(list, wakeOf));
    if (byWake.length >= 2) {
      out.push(`Your focus is best on days you wake up <strong>${WAKES[byWake[0].key].phrase}</strong>.`);
    }

    const byFirst = rank(groupBy(list, firstKeyOf));
    if (byFirst.length >= 2) {
      const names = labelsFor(list, (s) => dayOf(s)?.first);
      out.push(`Your best days start with “<strong>${escapeHtml(names.get(byFirst[0].key))}</strong>” first thing.`);
    }

    const byBusy = rank(groupBy(list, busyOf));
    if (byBusy.length >= 2) {
      out.push(`You focus best on days with <strong>${BUSY[byBusy[0].key].phrase}</strong>.`);
    }

    const byDay = rank(groupBy(list, weekdayOf));
    if (byDay.length >= 3) {
      out.push(`Your strongest day is <strong>${fullDay(byDay[0].key)}</strong>, averaging ${one(byDay[0].rating)} out of 5.`);
    }

    const byLength = rank(groupBy(list, lengthOf));
    if (byLength.length >= 2) {
      out.push(`Sessions of <strong>${LENGTHS[byLength[0].key].label.toLowerCase()}</strong> go best for you.`);
    }

    if (!out.length) {
      const left = Math.max(1, 5 - list.length);
      out.push(`Log ${plural(left, "more session")} at different times of day to start seeing patterns.`);
    }
    return out.slice(0, 6);
  }
  function fullDay(i) {
    return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i];
  }

  // ---------- Rendering insights ----------
  function viewSessions() {
    return filter === "all" ? sessions : sessions.filter((s) => kindOf(s) === filter);
  }

  function renderInsights() {
    const has = sessions.length >= MIN_SESSIONS_FOR_INSIGHTS;
    el.insightsEmpty.hidden = has;
    el.insightsBody.hidden = !has;
    el.sampleBanner.hidden = !sessions.some((s) => s.sample);
    if (!has) return;

    // Only offer the filter once both kinds of session exist
    const hasBoth = sessions.some((s) => kindOf(s) === "work") && sessions.some((s) => kindOf(s) === "study");
    el.filter.hidden = !hasBoth;
    if (!hasBoth && filter !== "all") {
      filter = "all";
      el.filter.querySelector('input[value="all"]').checked = true;
    }

    const view = viewSessions();
    if (!view.length) {
      el.headlines.innerHTML = `<li>No ${KINDS[filter].noun} sessions yet.</li>`;
      el.stats.innerHTML = "";
      el.heatmap.innerHTML = "";
      [el.lengths, el.places, el.wakes, el.firsts, el.busy].forEach((c) => { c.innerHTML = ""; });
      renderBars(el.kinds, groupBy(sessions, kindOf), (k) => KINDS[k].label, false);
      return;
    }

    el.headlines.innerHTML = headlines(view).map((h) => `<li>${h}</li>`).join("");

    const all = summarize(view);
    const focused = view.reduce((t, s) => t + focusedMinutesOf(s), 0);
    el.stats.innerHTML = [
      `<span><b>${view.length}</b>${view.length === 1 ? "session" : "sessions"}</span>`,
      `<span><b>${duration(all.minutes)}</b>logged</span>`,
      `<span><b>${duration(focused)}</b>on this tab</span>`,
      `<span><b>${one(all.rating)}</b>average focus</span>`,
      `<span><b>${one(all.perHour)}</b>distractions an hour</span>`,
    ].join("");

    renderHeatmap(view);
    renderBars(el.lengths, groupBy(view, lengthOf), (k) => LENGTHS[k].label, true);
    // The comparison always covers both kinds, whatever the filter
    renderBars(el.kinds, groupBy(sessions, kindOf), (k) => KINDS[k].label, false);

    const placeNames = labelsFor(view, (s) => s.place);
    renderBars(el.places, groupBy(view, placeKeyOf), (k) => placeNames.get(k), false,
      "Add where you are when you start a session to see this.");
    const checkIn = "Do the daily check-in to see this.";
    renderBars(el.wakes, groupBy(view, wakeOf), (k) => WAKES[k].label, true, checkIn);
    const firstNames = labelsFor(view, (s) => dayOf(s)?.first);
    renderBars(el.firsts, groupBy(view, firstKeyOf), (k) => firstNames.get(k), false, checkIn);
    renderBars(el.busy, groupBy(view, busyOf), (k) => BUSY[k].label, true, checkIn);
  }

  el.filter.addEventListener("change", () => {
    const checked = el.filter.querySelector("input:checked");
    filter = checked ? checked.value : "all";
    renderInsights();
  });

  function renderHeatmap(list) {
    const cells = new Map();
    for (const s of list) {
      const k = `${blockOf(s)}-${weekdayOf(s)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(s);
    }
    let html = `<div role="row" style="display:contents"><span class="hm-col" role="columnheader"></span>`;
    html += DAYS.map((d) => `<span class="hm-col" role="columnheader">${d}</span>`).join("") + `</div>`;
    BLOCKS.forEach((b, bi) => {
      html += `<div role="row" style="display:contents"><span class="hm-row" role="rowheader" title="${b.range}">${b.label}</span>`;
      DAYS.forEach((d, di) => {
        const list = cells.get(`${bi}-${di}`);
        if (!list) {
          html += `<span class="hm-cell is-empty" role="cell" aria-label="${d} ${b.label}: no sessions"></span>`;
          return;
        }
        const g = summarize(list);
        const r = g.rating.toFixed(2);
        const label = `${d} ${b.label.toLowerCase()} (${b.range}): average focus ${one(g.rating)} of 5, ${plural(g.n, "session")}, ${one(g.perHour)} distractions an hour`;
        html += `<span class="hm-cell${g.rating >= 3 ? " is-dark" : ""}" role="cell" style="--r:${r}" title="${label}" aria-label="${label}">${g.n}</span>`;
      });
      html += `</div>`;
    });
    el.heatmap.innerHTML = html;
  }

  function renderBars(container, groups, labelFn, keepOrder, emptyText = "") {
    if (!groups.size) {
      container.innerHTML = emptyText ? `<p class="bars-empty">${emptyText}</p>` : "";
      return;
    }
    let rows = [...groups.entries()].map(([key, list]) => ({ key, ...summarize(list) }));
    if (keepOrder) rows.sort((a, b) => a.key - b.key);
    else rows.sort((a, b) => b.minutes - a.minutes);
    rows = rows.slice(0, 6);
    const eligible = rows.filter((r) => r.n >= MIN_SESSIONS_PER_GROUP);
    const bestKey = eligible.length >= 2 ? eligible.reduce((a, b) => (b.rating > a.rating ? b : a)).key : null;
    container.innerHTML = rows.map((r) => `
      <div class="bar-row${r.key === bestKey ? " is-best" : ""}" title="${plural(r.n, "session")}, ${duration(r.minutes)}, ${one(r.perHour)} distractions an hour">
        <span class="label">${escapeHtml(labelFn(r.key))}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(r.rating / 5) * 100}%"></span></span>
        <span class="value"><b>${one(r.rating)}</b> · ${plural(r.n, "session")}</span>
      </div>`).join("");
  }

  // ---------- Log ----------
  function daySummary(d, { long = false } = {}) {
    if (!d) return "";
    const parts = [];
    if (d.wake) parts.push(`Up at <b>${wakeLabel(d.wake)}</b>`);
    if (d.first) parts.push(`first thing: <b>${escapeHtml(d.first)}</b>`);
    const plans = Array.isArray(d.plans) ? d.plans : [];
    if (long && plans.length) parts.push(`also on: ${plans.map((p) => `<b>${escapeHtml(p)}</b>`).join(", ")}`);
    else if (plans.length) parts.push(`<b>${plans.length}</b> other ${plans.length === 1 ? "thing" : "things"} on`);
    if (d.food) parts.push(`ate: <b>${escapeHtml(d.food)}</b>`);
    if (!parts.length) return "";
    const text = parts.join(", ");
    return text.charAt(0).toUpperCase() + text.slice(1) + ".";
  }

  function renderLog() {
    el.logEmpty.hidden = sessions.length > 0;
    const recent = [...sessions].reverse();
    const shown = recent.slice(0, logShown);
    let lastDay = null;
    el.log.innerHTML = shown.map((s) => {
      let header = "";
      const key = dayKeyOf(s.start);
      if (key !== lastDay) {
        lastDay = key;
        const summary = daySummary(days[key], { long: true });
        header = `<li class="log-day"><h3>${dayFmt.format(dateFromKey(key))}</h3>${summary ? `<p>${summary}</p>` : ""}</li>`;
      }
      const bits = [duration(Math.max(1, minutesOf(s))), plural(distractionsOf(s), "distraction")];
      const away = Math.round((s.awayMs || 0) / 60000);
      if (away >= 1) bits.push(`${duration(away)} away`);
      return `${header}<li>
        <span class="log-when">${timeFmt.format(s.start)} <span class="log-kind">${KINDS[kindOf(s)].label}${s.place ? ` at ${escapeHtml(s.place)}` : ""}</span></span>
        <span class="log-meta">${bits.join(", ")}${s.note ? ` — <span class="log-note">${escapeHtml(s.note)}</span>` : ""}</span>
        <span class="log-rating" style="--r:${s.rating}" title="${RATING_WORDS[s.rating]}" aria-label="Focus ${s.rating} of 5">${s.rating}</span>
        <button class="log-delete" data-id="${escapeHtml(s.id)}">Delete</button>
      </li>`;
    }).join("");
    if (recent.length > logShown) {
      el.log.insertAdjacentHTML("beforeend", `<li style="border:0"><button class="btn btn-quiet more" id="more">Show ${Math.min(LOG_PAGE, recent.length - logShown)} more</button></li>`);
    }
  }

  // ---------- Places ----------
  function renderPlaceChips() {
    const counts = new Map();
    for (const s of sessions) {
      if (s.sample || !tidy(s.place)) continue;
      const k = keyText(s.place);
      const c = counts.get(k) || { name: tidy(s.place), n: 0 };
      c.n++;
      counts.set(k, c);
    }
    const names = counts.size
      ? [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 6).map((c) => c.name)
      : DEFAULT_PLACES;
    const current = keyText(el.location.value);
    el.placeChips.innerHTML = names.map((n) =>
      `<button type="button" data-place="${escapeHtml(n)}" aria-pressed="${keyText(n) === current}"${active ? " disabled" : ""}>${escapeHtml(n)}</button>`).join("");
  }
  el.placeChips.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-place]");
    if (!b || active) return;
    el.location.value = b.dataset.place;
    store(PLACE_KEY, el.location.value);
    renderPlaceChips();
  });
  el.location.addEventListener("input", () => {
    store(PLACE_KEY, tidy(el.location.value));
    renderPlaceChips();
  });

  // ---------- Daily check-in ----------
  function renderToday() {
    const d = days[todayKey()];
    const showForm = editingToday;
    el.todayForm.hidden = !showForm;
    el.todaySummary.hidden = showForm;
    el.todayEdit.hidden = showForm;
    el.todayEdit.textContent = d ? "Edit check-in" : "Check in";
    el.todayEdit.classList.toggle("btn-quiet", !!d);
    el.todayEdit.classList.toggle("btn-primary", !d);
    if (!showForm) {
      el.todaySummary.innerHTML = d ? (daySummary(d) || "Checked in.")
        : "You haven't checked in today. It takes a minute: wake-up time, how you started the day, food and plans.";
      return;
    }
    // Fill the form with today's answers, if any
    el.wake.value = d?.wake || "";
    const first = tidy(d?.first);
    let matched = false;
    el.firstChips.querySelectorAll("input").forEach((i) => {
      i.checked = !!first && i.value === first;
      if (i.checked) matched = true;
    });
    el.firstOther.value = matched ? "" : first;
    el.food.value = d?.food || "";
    el.plans.value = (d?.plans || []).join("\n");
  }

  el.firstOther.addEventListener("input", () => {
    if (el.firstOther.value.trim()) el.firstChips.querySelectorAll("input").forEach((i) => { i.checked = false; });
  });
  el.firstChips.addEventListener("change", () => { el.firstOther.value = ""; });

  el.todayForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const picked = el.firstChips.querySelector("input:checked");
    const entry = {
      wake: el.wake.value || "",
      first: tidy(el.firstOther.value) || (picked ? picked.value : ""),
      food: tidy(el.food.value),
      plans: el.plans.value.split("\n").map(tidy).filter(Boolean),
    };
    if (!entry.wake && !entry.first && !entry.food && !entry.plans.length) {
      toast("Fill in at least one answer to save your check-in.");
      return;
    }
    days[todayKey()] = entry;
    saveDays();
    editingToday = false;
    renderAll();
    toast("Check-in saved.");
  });
  el.todayEdit.addEventListener("click", () => { editingToday = true; renderToday(); el.wake.focus(); });
  el.todayCancel.addEventListener("click", () => { editingToday = false; renderToday(); });

  el.log.addEventListener("click", (e) => {
    const del = e.target.closest(".log-delete");
    if (del) {
      // Two-step delete: first click asks, second click deletes
      if (!del.classList.contains("is-confirming")) {
        el.log.querySelectorAll(".log-delete.is-confirming").forEach((b) => { b.classList.remove("is-confirming"); b.textContent = "Delete"; });
        del.classList.add("is-confirming");
        del.textContent = "Confirm delete";
        return;
      }
      sessions = sessions.filter((s) => s.id !== del.dataset.id);
      saveSessions();
      renderAll();
      toast("Session deleted.");
      return;
    }
    if (e.target.id === "more") { logShown += LOG_PAGE; renderLog(); }
  });

  function renderAll() {
    renderToday();
    renderInsights();
    renderLog();
    renderPlaceChips();
    if (!active) renderActive();
  }

  // ---------- Export / import ----------
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const csvCell = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

  el.exportCsv.addEventListener("click", () => {
    if (!sessions.length) return toast("No sessions to export yet.");
    const head = ["day", "start", "end", "weekday", "time_of_day", "minutes", "activity", "location", "focus_rating",
      "distractions", "minutes_away", "note", "woke_up", "first_thing", "ate", "other_plans", "other_plans_count"];
    const rows = sessions.map((s) => {
      const d = dayOf(s) || {};
      const plans = Array.isArray(d.plans) ? d.plans : [];
      return [
        dayKeyOf(s.start), new Date(s.start).toISOString(), new Date(s.end).toISOString(), fullDay(weekdayOf(s)),
        BLOCKS[blockOf(s)].label, Math.round(minutesOf(s)), KINDS[kindOf(s)].noun, s.place || "", s.rating,
        distractionsOf(s), Math.round((s.awayMs || 0) / 60000), s.note || "",
        d.wake || "", d.first || "", d.food || "", plans.join("; "), dayOf(s) ? plans.length : "",
      ].map(csvCell).join(",");
    });
    download(`focus-sessions-${today()}.csv`, [head.join(","), ...rows].join("\n"), "text/csv");
  });

  el.exportJson.addEventListener("click", () => {
    if (!sessions.length && !Object.keys(days).length) return toast("Nothing to back up yet.");
    const realDays = Object.fromEntries(Object.entries(days).filter(([, d]) => !d.sample));
    download(`focus-tracker-backup-${today()}.json`,
      JSON.stringify({ app: "focus-tracker", version: 2, sessions: sessions.filter((s) => !s.sample), days: realDays }, null, 2),
      "application/json");
  });

  el.importInput.addEventListener("change", async () => {
    const file = el.importInput.files[0];
    el.importInput.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = (Array.isArray(data) ? data : data.sessions || []).filter(isValidSession);
      const incomingDays = data && data.days && typeof data.days === "object" && !Array.isArray(data.days) ? data.days : {};
      if (!incoming.length && !Object.keys(incomingDays).length) return toast("That file has no sessions in it.");
      const known = new Set(sessions.map((s) => s.id));
      const added = incoming.filter((s) => !known.has(s.id));
      sessions = [...sessions, ...added].sort((a, b) => a.start - b.start);
      let addedDays = 0;
      for (const [key, d] of Object.entries(incomingDays)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(key) && d && typeof d === "object" && !days[key]) { days[key] = d; addedDays++; }
      }
      saveSessions();
      saveDays();
      renderAll();
      toast(`Restored ${plural(added.length, "session")} and ${plural(addedDays, "check-in")}.`);
    } catch {
      toast("That file isn't a Focus Tracker backup.");
    }
  });

  // ---------- Sample data ----------
  function makeSampleData() {
    const out = [];
    const sampleDays = {};
    const now = new Date();
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    // Times of day this pretend student studies or works, with how well they tend to focus then
    const habits = [
      { hour: 8, base: 3.6, kind: "study" }, { hour: 10, base: 4.4, kind: "study" }, { hour: 13, base: 3.0, kind: "work" },
      { hour: 16, base: 3.9, kind: "work" }, { hour: 19, base: 3.8, kind: "study" }, { hour: 22, base: 2.6, kind: "study" },
      { hour: 0, base: 1.9, kind: "study" }, { hour: 18, base: 3.2, kind: "work" },
    ];
    // How each part of the day tends to nudge focus up or down for this pretend student
    const firsts = [
      { text: "Checked my phone", effect: -0.5 }, { text: "Exercised", effect: 0.5 }, { text: "Ate breakfast", effect: 0.2 },
      { text: "Showered", effect: 0 }, { text: "Went outside", effect: 0.4 },
    ];
    const studyPlaces = [{ name: "Library", effect: 0.5 }, { name: "Home", effect: -0.4 }, { name: "Café", effect: 0 }];
    const meals = ["oatmeal, coffee", "toast and eggs", "chicken wrap", "leftover pasta", "smoothie", "ramen", "salad and a muffin", "pizza"];
    const plansPool = ["Chem lecture 10–11:30", "Lab 1–4", "Shift at work 5–9", "Gym", "Group project meeting", "Dentist", "Call home", "Tutorial 2:30"];

    for (let day = 27; day >= 1; day--) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
      const key = dayKeyOf(date.getTime() + 12 * 3600000);
      const wakeMins = Math.round((6.5 + rand() * 4.5) * 4) * 15;
      const first = pick(firsts);
      const nPlans = Math.floor(rand() * 6);
      sampleDays[key] = {
        sample: true,
        wake: `${pad(Math.floor(wakeMins / 60))}:${pad(wakeMins % 60)}`,
        first: first.text,
        food: `${pick(meals)}, ${pick(meals)}`,
        plans: [...plansPool].sort(() => rand() - 0.5).slice(0, nPlans),
      };
      const dayEffect = (wakeMins < 8 * 60 ? 0.3 : wakeMins >= 10 * 60 ? -0.4 : 0) + first.effect + (nPlans >= 4 ? -0.4 : 0);

      const count = rand() < 0.3 ? 0 : rand() < 0.6 ? 1 : 2;
      for (let i = 0; i < count; i++) {
        const h = habits[Math.floor(rand() * habits.length)];
        const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h.hour, Math.floor(rand() * 50));
        if (h.hour < DAY_STARTS_AT) d.setDate(d.getDate() + 1); // a late session belongs to this day
        const place = h.kind === "work" ? { name: "Work", effect: 0 } : pick(studyPlaces);
        const minutes = [20, 30, 40, 45, 60, 75, 110][Math.floor(rand() * 7)];
        const lengthEffect = minutes >= 90 ? -0.8 : minutes >= 50 ? -0.2 : minutes < 25 ? -0.3 : 0.3;
        const weekendEffect = d.getDay() === 0 || d.getDay() === 6 ? -0.3 : 0;
        const rating = Math.min(5, Math.max(1, Math.round(h.base + lengthEffect + weekendEffect + dayEffect + place.effect + (rand() - 0.5) * 1.2)));
        const start = d.getTime(), end = start + minutes * 60000;
        if (start >= Date.now()) continue;
        const nDistract = Math.max(0, Math.round((5.5 - rating) * minutes / 40 + (rand() - 0.5) * 2));
        out.push({
          id: `sample-${start}`, start, end, sample: true,
          kind: h.kind,
          place: place.name,
          rating,
          distractions: Array.from({ length: nDistract }, () => start + rand() * (end - start)).sort(),
          awayMs: Math.round(rand() * (5.5 - rating) * 3 * 60000),
          note: "",
        });
      }
    }
    return { sessions: out, days: sampleDays };
  }

  function removeSampleData(render = true) {
    const before = sessions.length;
    sessions = sessions.filter((s) => !s.sample);
    if (sessions.length !== before) saveSessions();
    const sampleKeys = Object.keys(days).filter((k) => days[k].sample);
    sampleKeys.forEach((k) => delete days[k]);
    if (sampleKeys.length) saveDays();
    if (render) renderAll();
  }

  el.sample.addEventListener("click", () => {
    const sample = makeSampleData();
    sessions = [...sessions, ...sample.sessions].sort((a, b) => a.start - b.start);
    // Sample check-ins never replace a real one
    for (const [key, d] of Object.entries(sample.days)) if (!days[key]) days[key] = d;
    saveSessions();
    saveDays();
    renderAll();
  });
  el.clearSample.addEventListener("click", () => { removeSampleData(); toast("Sample data removed."); });

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("is-on"), 2400);
  }

  // ---------- Wire up ----------
  el.start.addEventListener("click", startSession);
  el.distract.addEventListener("click", logDistraction);
  el.finish.addEventListener("click", finishSession);

  setChosenKind(load(KIND_KEY, "study"));
  el.location.value = load(PLACE_KEY, "") || "";

  // Restore a session that was running when the page closed
  if (active) {
    if (active.end) { renderActive(); finishSession(); }
    else renderActive();
  }
  renderAll();
})();
