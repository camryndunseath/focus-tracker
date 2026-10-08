/* Focus Tracker
 * Times study sessions, records distractions and time away from the tab,
 * asks for a 1–5 focus rating at the end, and finds patterns in the data.
 * Everything is stored in this browser's localStorage.
 */
(() => {
  "use strict";

  const STORE_KEY = "focus-tracker.sessions.v1";
  const ACTIVE_KEY = "focus-tracker.active.v1";
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
  let active = load(ACTIVE_KEY, null); // { start, subject, distractions: [ms], awayMs, hiddenAt }
  let logShown = LOG_PAGE;

  function saveSessions() { store(STORE_KEY, sessions); }
  function saveActive() { store(ACTIVE_KEY, active); }

  function isValidSession(s) {
    return s && typeof s.start === "number" && typeof s.end === "number" &&
      s.end > s.start && s.rating >= 1 && s.rating <= 5;
  }

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    subject: $("subject"), subjectList: $("subject-list"),
    timer: $("timer"), band: $("clock-band"), status: $("status"), hint: $("hint"),
    start: $("start"), distract: $("distract"), distractCount: $("distract-count"), finish: $("finish"),
    insightsEmpty: $("insights-empty"), insightsBody: $("insights-body"),
    sample: $("sample"), sampleBanner: $("sample-banner"), clearSample: $("clear-sample"),
    headlines: $("headlines"), stats: $("stats"), heatmap: $("heatmap"),
    lengths: $("lengths"), subjects: $("subjects"),
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

  // ---------- Running a session ----------
  let ticker = null;

  function startSession() {
    active = {
      start: Date.now(),
      subject: el.subject.value.trim(),
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
    let summary = `${duration(Math.max(1, min))}${active.subject ? ` of ${active.subject}` : ""}, ${plural(d, "distraction")}`;
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
        subject: active.subject || "",
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
      // "Keep studying" or Escape: resume the same session
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
    el.subject.disabled = !!active;

    if (!active) {
      stopTicker();
      el.timer.textContent = "0:00:00";
      el.band.style.setProperty("--progress", 0);
      el.status.textContent = sessions.length ? "Ready for another session." : "Ready when you are.";
      document.title = "Focus Tracker";
      return;
    }

    el.subject.value = active.subject;
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

  function headlines() {
    const out = [];
    const byBlock = rank(groupBy(sessions, blockOf));
    if (byBlock.length >= 2) {
      const best = byBlock[0], worst = byBlock[byBlock.length - 1];
      out.push(`You focus best in the <strong>${BLOCKS[best.key].phrase}</strong>, averaging ${one(best.rating)} out of 5 over ${plural(best.n, "session")}.`);
      if (worst.rating < best.rating - 0.3) {
        out.push(`Your focus is weakest in the <strong>${BLOCKS[worst.key].phrase}</strong> at ${one(worst.rating)} out of 5. Save easier tasks for then.`);
      }
    } else if (byBlock.length === 1) {
      out.push(`So far you mostly study in the <strong>${BLOCKS[byBlock[0].key].phrase}</strong>. Try a few sessions at other times to compare.`);
    }

    const byDay = rank(groupBy(sessions, weekdayOf));
    if (byDay.length >= 3) {
      out.push(`Your strongest day is <strong>${fullDay(byDay[0].key)}</strong>, averaging ${one(byDay[0].rating)} out of 5.`);
    }

    const byLength = rank(groupBy(sessions, lengthOf));
    if (byLength.length >= 2) {
      out.push(`Sessions of <strong>${LENGTHS[byLength[0].key].label.toLowerCase()}</strong> go best for you.`);
    }

    if (!out.length) {
      const left = Math.max(1, 5 - sessions.length);
      out.push(`Log ${plural(left, "more session")} at different times of day to start seeing patterns.`);
    }
    return out;
  }
  function fullDay(i) {
    return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i];
  }

  // ---------- Rendering insights ----------
  function renderInsights() {
    const has = sessions.length >= MIN_SESSIONS_FOR_INSIGHTS;
    el.insightsEmpty.hidden = has;
    el.insightsBody.hidden = !has;
    el.sampleBanner.hidden = !sessions.some((s) => s.sample);
    if (!has) return;

    el.headlines.innerHTML = headlines().map((h) => `<li>${h}</li>`).join("");

    const all = summarize(sessions);
    const focused = sessions.reduce((t, s) => t + focusedMinutesOf(s), 0);
    el.stats.innerHTML = [
      `<span><b>${sessions.length}</b>${sessions.length === 1 ? "session" : "sessions"}</span>`,
      `<span><b>${duration(all.minutes)}</b>studied</span>`,
      `<span><b>${duration(focused)}</b>on this tab</span>`,
      `<span><b>${one(all.rating)}</b>average focus</span>`,
      `<span><b>${one(all.perHour)}</b>distractions an hour</span>`,
    ].join("");

    renderHeatmap();
    renderBars(el.lengths, groupBy(sessions, lengthOf), (k) => LENGTHS[k].label, true);
    renderBars(el.subjects, groupBy(sessions, (s) => s.subject || "No subject"), (k) => k, false);
  }

  function renderHeatmap() {
    const cells = new Map();
    for (const s of sessions) {
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

  function renderBars(container, groups, labelFn, keepOrder) {
    let rows = [...groups.entries()].map(([key, list]) => ({ key, ...summarize(list) }));
    if (keepOrder) rows.sort((a, b) => a.key - b.key);
    else rows.sort((a, b) => b.minutes - a.minutes);
    rows = rows.slice(0, 6);
    const eligible = rows.filter((r) => r.n >= MIN_SESSIONS_PER_GROUP);
    const bestKey = eligible.length >= 2 ? eligible.reduce((a, b) => (b.rating > a.rating ? b : a)).key : null;
    container.innerHTML = rows.map((r) => `
      <div class="bar-row${r.key === bestKey ? " is-best" : ""}" title="${plural(r.n, "session")}, ${one(r.perHour)} distractions an hour">
        <span class="label">${escapeHtml(labelFn(r.key))}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(r.rating / 5) * 100}%"></span></span>
        <span class="value"><b>${one(r.rating)}</b> · ${keepOrder ? plural(r.n, "session") : duration(r.minutes)}</span>
      </div>`).join("");
  }

  // ---------- Log ----------
  function renderLog() {
    el.logEmpty.hidden = sessions.length > 0;
    const recent = [...sessions].reverse();
    const shown = recent.slice(0, logShown);
    el.log.innerHTML = shown.map((s) => {
      const bits = [duration(Math.max(1, minutesOf(s))), plural(distractionsOf(s), "distraction")];
      const away = Math.round((s.awayMs || 0) / 60000);
      if (away >= 1) bits.push(`${duration(away)} away`);
      return `<li>
        <span class="log-when">${dayFmt.format(s.start)}, ${timeFmt.format(s.start)}${s.subject ? ` · ${escapeHtml(s.subject)}` : ""}</span>
        <span class="log-meta">${bits.join(", ")}${s.note ? ` — <span class="log-note">${escapeHtml(s.note)}</span>` : ""}</span>
        <span class="log-rating" style="--r:${s.rating}" title="${RATING_WORDS[s.rating]}" aria-label="Focus ${s.rating} of 5">${s.rating}</span>
        <button class="log-delete" data-id="${escapeHtml(s.id)}">Delete</button>
      </li>`;
    }).join("");
    if (recent.length > logShown) {
      el.log.insertAdjacentHTML("beforeend", `<li style="border:0"><button class="btn btn-quiet more" id="more">Show ${Math.min(LOG_PAGE, recent.length - logShown)} more</button></li>`);
    }
  }

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

  function renderSubjects() {
    const names = [...new Set(sessions.filter((s) => !s.sample).map((s) => s.subject).filter(Boolean))];
    el.subjectList.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}">`).join("");
  }

  function renderAll() {
    renderInsights();
    renderLog();
    renderSubjects();
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
    const head = ["start", "end", "weekday", "time_of_day", "minutes", "subject", "focus_rating", "distractions", "minutes_away", "note"];
    const rows = sessions.map((s) => [
      new Date(s.start).toISOString(), new Date(s.end).toISOString(), fullDay(weekdayOf(s)),
      BLOCKS[blockOf(s)].label, Math.round(minutesOf(s)), s.subject, s.rating,
      distractionsOf(s), Math.round((s.awayMs || 0) / 60000), s.note || "",
    ].map(csvCell).join(","));
    download(`focus-sessions-${today()}.csv`, [head.join(","), ...rows].join("\n"), "text/csv");
  });

  el.exportJson.addEventListener("click", () => {
    if (!sessions.length) return toast("No sessions to back up yet.");
    download(`focus-tracker-backup-${today()}.json`, JSON.stringify({ app: "focus-tracker", version: 1, sessions }, null, 2), "application/json");
  });

  el.importInput.addEventListener("change", async () => {
    const file = el.importInput.files[0];
    el.importInput.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = (Array.isArray(data) ? data : data.sessions || []).filter(isValidSession);
      if (!incoming.length) return toast("That file has no sessions in it.");
      const known = new Set(sessions.map((s) => s.id));
      const added = incoming.filter((s) => !known.has(s.id));
      sessions = [...sessions, ...added].sort((a, b) => a.start - b.start);
      saveSessions();
      renderAll();
      toast(`Restored ${plural(added.length, "session")}.`);
    } catch {
      toast("That file isn't a Focus Tracker backup.");
    }
  });

  // ---------- Sample data ----------
  function makeSampleData() {
    const out = [];
    const now = new Date();
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const subjects = ["Biology", "Calculus", "History essay", "Spanish"];
    // Times of day this pretend student studies, with how well they tend to focus then
    const habits = [
      { hour: 8, base: 3.6 }, { hour: 10, base: 4.4 }, { hour: 13, base: 3.3 },
      { hour: 16, base: 3.4 }, { hour: 19, base: 3.8 }, { hour: 22, base: 2.6 }, { hour: 0, base: 1.9 },
    ];
    for (let day = 27; day >= 1; day--) {
      const count = rand() < 0.3 ? 0 : rand() < 0.6 ? 1 : 2;
      for (let i = 0; i < count; i++) {
        const h = habits[Math.floor(rand() * habits.length)];
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, h.hour, Math.floor(rand() * 50));
        const minutes = [20, 30, 40, 45, 60, 75, 110][Math.floor(rand() * 7)];
        const lengthEffect = minutes >= 90 ? -0.8 : minutes >= 50 ? -0.2 : minutes < 25 ? -0.3 : 0.3;
        const weekendEffect = d.getDay() === 0 || d.getDay() === 6 ? -0.3 : 0;
        const rating = Math.min(5, Math.max(1, Math.round(h.base + lengthEffect + weekendEffect + (rand() - 0.5) * 1.4)));
        const start = d.getTime(), end = start + minutes * 60000;
        const nDistract = Math.max(0, Math.round((5.5 - rating) * minutes / 40 + (rand() - 0.5) * 2));
        out.push({
          id: `sample-${start}`, start, end, sample: true,
          subject: subjects[Math.floor(rand() * subjects.length)],
          rating,
          distractions: Array.from({ length: nDistract }, () => start + rand() * (end - start)).sort(),
          awayMs: Math.round(rand() * (5.5 - rating) * 3 * 60000),
          note: "",
        });
      }
    }
    return out;
  }

  function removeSampleData(render = true) {
    const before = sessions.length;
    sessions = sessions.filter((s) => !s.sample);
    if (sessions.length !== before) saveSessions();
    if (render) renderAll();
  }

  el.sample.addEventListener("click", () => {
    sessions = [...sessions, ...makeSampleData()].sort((a, b) => a.start - b.start);
    saveSessions();
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

  // Restore a session that was running when the page closed
  if (active) {
    if (active.end) { renderActive(); finishSession(); }
    else renderActive();
  }
  renderAll();
})();
