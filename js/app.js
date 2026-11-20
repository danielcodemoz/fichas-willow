/* Willow Worksheet Generator – browser UI. Logic lives in generator.js. */
(function () {
  "use strict";
  var G = window.WorksheetGen;
  var $ = function (id) { return document.getElementById(id); };
  var DEFAULT_COUNTS = { mcq: 5, tf: 4, fill: 4, short: 2, match: 1 };
  var ALL = "all";

  var manifest = null;
  var cache = {};          // file -> parsed topic JSON
  var pool = [];           // questions for the current grade/topic
  var current = null;      // last generated sheet + settings
  var activeTab = "sheet";

  // ---------- tiny DOM helpers (no innerHTML with data, so bank text can never inject markup) ----------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  // text with `inline code` → nodes
  function rich(text, parent) {
    String(text).split(/(`[^`]+`)/g).forEach(function (part) {
      if (!part) return;
      if (part.charAt(0) === "`" && part.length > 2) parent.appendChild(el("code", { text: part.slice(1, -1) }));
      else parent.appendChild(document.createTextNode(part));
    });
    return parent;
  }
  // question text where ____ becomes a blank line
  function withBlanks(text, parent) {
    String(text).split(/(_{3,})/g).forEach(function (part) {
      if (!part) return;
      if (/^_{3,}$/.test(part)) parent.appendChild(el("span", { class: "blank", "aria-label": "blank" }));
      else rich(part, parent);
    });
    return parent;
  }

  // ---------- data loading ----------
  function fetchJSON(path) {
    if (cache[path]) return Promise.resolve(cache[path]);
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " → HTTP " + r.status);
      return r.json();
    }).then(function (j) { cache[path] = j; return j; });
  }
  function gradeInfo(g) { return manifest.grades.filter(function (x) { return String(x.grade) === String(g); })[0]; }
  function loadPool(grade, topic) {
    var gi = gradeInfo(grade);
    var topics = topic === ALL ? gi.topics : gi.topics.filter(function (t) { return t.id === topic; });
    return Promise.all(topics.map(function (t) { return fetchJSON(t.file); })).then(function (files) {
      var out = [];
      files.forEach(function (f) { f.questions.forEach(function (q) { out.push(q); }); });
      return out;
    });
  }

  // ---------- form state ----------
  function radio(name) { var r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : null; }
  function setRadio(name, v) { var r = document.querySelector('input[name="' + name + '"][value="' + v + '"]'); if (r) r.checked = true; }
  function readCounts() {
    var c = {};
    G.TYPES.forEach(function (t) { c[t.id] = Math.max(0, parseInt($("n-" + t.id).value, 10) || 0); });
    return c;
  }
  function topicTitle(grade, topic) {
    if (topic === ALL) return "Mixed topics";
    var t = gradeInfo(grade).topics.filter(function (x) { return x.id === topic; })[0];
    return t ? t.title : topic;
  }

  function buildCountRows() {
    var host = $("counts");
    G.TYPES.forEach(function (t) {
      var input = el("input", { type: "number", id: "n-" + t.id, min: "0", max: "30", step: "1", inputmode: "numeric", value: String(DEFAULT_COUNTS[t.id]), "aria-label": t.label + " – number of questions" });
      var lab = el("label", { for: "n-" + t.id, class: "name" }, [t.label, el("span", { class: "avail", id: "av-" + t.id })]);
      host.appendChild(el("div", { class: "count-row" }, [lab, input]));
      input.addEventListener("input", updateTotals);
    });
  }

  function populateTopics(selected) {
    var sel = $("topic");
    var gi = gradeInfo(radio("grade"));
    sel.textContent = "";
    sel.appendChild(el("option", { value: ALL, text: "All topics (mixed review)" }));
    gi.topics.forEach(function (t) { sel.appendChild(el("option", { value: t.id, text: t.title })); });
    sel.value = selected && Array.prototype.some.call(sel.options, function (o) { return o.value === selected; }) ? selected : gi.topics[0].id;
  }

  function refreshPool() {
    return loadPool(radio("grade"), $("topic").value).then(function (p) { pool = p; updateAvailability(); });
  }
  function updateAvailability() {
    var av = G.availableCounts(pool, radio("difficulty"));
    G.TYPES.forEach(function (t) {
      var inp = $("n-" + t.id);
      inp.max = String(av[t.id]);
      $("av-" + t.id).textContent = av[t.id] + " available" + (radio("difficulty") !== "mixed" ? " (" + av[t.id + ":total"] + " in bank)" : "");
    });
    updateTotals();
  }
  function updateTotals() {
    var counts = readCounts(), av = G.availableCounts(pool, radio("difficulty"));
    var q = 0, m = 0;
    G.TYPES.forEach(function (t) {
      var n = Math.min(counts[t.id], av[t.id + ":total"]);
      q += n;
      // estimate marks from average per question of that type
      var ofType = pool.filter(function (x) { return x.type === t.id; });
      if (ofType.length) { var avg = ofType.reduce(function (s, x) { return s + G.marksFor(x); }, 0) / ofType.length; m += n * avg; }
    });
    $("total-line").textContent = q ? q + " question" + (q === 1 ? "" : "s") + " · about " + Math.round(m) + " marks" : "Choose at least one question.";
  }

  // ---------- rendering ----------
  function sheetTitle(settings) {
    if (settings.title) return settings.title;
    return "Computing – Grade " + settings.grade + (settings.topic === ALL ? " review" : ": " + topicTitle(settings.grade, settings.topic));
  }
  function diffLabel(d) { return d === "mixed" ? "Mixed difficulty" : d.charAt(0).toUpperCase() + d.slice(1) + " level"; }

  function header(settings, sheet, isKey) {
    var head = el("header", { class: "ws-head" }, [
      el("div", { class: "ws-school" }, [
        el("span", { class: "school", text: settings.school || "School" }),
        el("span", { class: "tag", text: "Computing · Grade " + settings.grade })
      ]),
      el("h2", { class: "ws-title", text: sheetTitle(settings) }),
      el("p", { class: "ws-sub", text: sheet.totalQuestions + " questions · " + sheet.totalMarks + " marks · " + diffLabel(sheet.difficulty) })
    ]);
    if (isKey) head.appendChild(el("span", { class: "ws-key-banner", text: "ANSWER KEY – TEACHER COPY" }));
    var frag = document.createDocumentFragment();
    frag.appendChild(head);
    if (!isKey) {
      frag.appendChild(el("div", { class: "ws-fields" }, [
        el("div", null, [el("b", { text: "Name:" })]),
        el("div", null, [el("b", { text: "Class:" })]),
        el("div", null, [el("b", { text: "Date:" })]),
        el("div", { class: "score" }, [el("b", { text: "Score:" }), " / " + sheet.totalMarks])
      ]));
    }
    return frag;
  }
  function markTag(item, settings) { return settings.marks ? el("span", { class: "marks", text: "[" + item.marks + (item.marks === 1 ? " mark]" : " marks]") }) : null; }

  function renderQuestion(item, settings) {
    var body = el("div", { class: "body" });
    var p = el("p");
    var tag = markTag(item, settings);
    if (tag) p.appendChild(tag);
    if (item.type === "fill") withBlanks(item.q, p); else rich(item.q, p);
    body.appendChild(p);
    if (item.code) body.appendChild(el("pre", { class: "code", text: item.code }));

    if (item.type === "mcq") {
      body.appendChild(el("ul", { class: "opts" }, item.options.map(function (o, i) {
        var li = el("li"); li.appendChild(el("span", { class: "let", text: G.LETTERS.charAt(i) + "." })); li.appendChild(rich(o, el("span"))); return li;
      })));
    } else if (item.type === "tf") {
      body.appendChild(el("div", { class: "tf" }, [el("span", { text: "True" }), el("span", { text: "False" })]));
    } else if (item.type === "short") {
      var lines = el("div", { class: "lines" });
      for (var i = 0; i < Math.min(6, item.marks + 1); i++) lines.appendChild(el("div", { class: "line" }));
      body.appendChild(lines);
    } else if (item.type === "match") {
      var left = el("ol"), right = el("ul");
      item.left.forEach(function (t, i) { var li = el("li"); li.appendChild(el("span", { class: "let", text: (i + 1) + "." })); li.appendChild(rich(t, el("span"))); li.appendChild(el("span", { class: "box" })); left.appendChild(li); });
      item.right.forEach(function (t, i) { var li = el("li"); li.appendChild(el("span", { class: "let", text: G.LETTERS.charAt(i) + "." })); li.appendChild(rich(t, el("span"))); right.appendChild(li); });
      body.appendChild(el("div", { class: "match" }, [left, right]));
    }
    return el("div", { class: "q" }, [el("div", { class: "num", text: item.number + "." }), body]);
  }

  function sectionHead(s, total) {
    return el("div", { class: "sec-head" }, [
      el("h3", { text: "Section " + s.letter + " – " + s.section }),
      el("span", { class: "sec-marks", text: total + (total === 1 ? " mark" : " marks") })
    ]);
  }

  function footer(settings, sheet, label) {
    var bits = [label, "Grade " + settings.grade + " · " + (settings.topic === ALL ? "Mixed topics" : topicTitle(settings.grade, settings.topic))];
    var f = el("div", { class: "ws-foot" }, [el("span", { text: bits.join(" · ") })]);
    if (settings.showSeed) f.appendChild(el("span", { text: "Seed: " + sheet.seed }));
    return f;
  }

  function renderSheet(sheet, settings) {
    var root = $("sheet"); root.textContent = "";
    root.appendChild(header(settings, sheet, false));
    root.appendChild(el("p", { class: "ws-instr", text: "Answer all questions. Write clearly. Read each question carefully before you answer." }));
    if (settings.wordbank) {
      var words = G.wordBank(sheet, sheet.seed);
      if (words.length) root.appendChild(el("div", { class: "ws-wordbank" }, [el("b", { text: "Word bank: " }), words.join("  ·  ")]));
    }
    sheet.sections.forEach(function (s) {
      var secMarks = s.items.reduce(function (a, i) { return a + i.marks; }, 0);
      var sec = el("section", { class: "sec" });
      sec.appendChild(sectionHead(s, secMarks));
      sec.appendChild(el("p", { class: "sec-instr", text: s.instruction }));
      s.items.forEach(function (it) { sec.appendChild(renderQuestion(it, settings)); });
      root.appendChild(sec);
    });
    root.appendChild(footer(settings, sheet, "Worksheet"));
  }

  function renderKey(sheet, settings) {
    var root = $("key"); root.textContent = "";
    root.appendChild(header(settings, sheet, true));
    sheet.sections.forEach(function (s) {
      var secMarks = s.items.reduce(function (a, i) { return a + i.marks; }, 0);
      var sec = el("section", { class: "sec" });
      sec.appendChild(sectionHead(s, secMarks));
      s.items.forEach(function (it) {
        var body = el("div", { class: "body" });
        var ans = el("p", { class: "model" });
        if (it.type === "mcq") {
          ans.appendChild(el("span", { class: "ans", text: it.answerLetter + ". " })); rich(it.options[it.answerIndex], ans);
        } else if (it.type === "tf") {
          ans.appendChild(el("span", { class: "ans", text: it.answer ? "True" : "False" }));
        } else if (it.type === "fill") {
          it.answers.forEach(function (a, i) { if (i) ans.appendChild(document.createTextNode("   ")); var sp = el("span", { class: "ans" }); sp.appendChild(document.createTextNode(it.answers.length > 1 ? (i + 1) + ") " : "")); rich(a, sp); ans.appendChild(sp); });
        } else if (it.type === "short") {
          rich(it.answer, ans);
        } else if (it.type === "match") {
          it.matchLetters.forEach(function (l, i) { if (i) ans.appendChild(document.createTextNode("   ")); ans.appendChild(el("span", { class: "ans", text: (i + 1) + "–" + l })); });
        }
        var tag = markTag(it, settings);
        if (tag) ans.insertBefore(tag, ans.firstChild);
        body.appendChild(ans);
        if (it.explain) body.appendChild(el("p", { class: "why", text: it.explain }));
        sec.appendChild(el("div", { class: "q" }, [el("div", { class: "num", text: it.number + "." }), body]));
      });
      root.appendChild(sec);
    });
    root.appendChild(el("div", { class: "ws-foot" }, [el("span", { text: "Total: " + sheet.totalMarks + " marks" }), el("span", { text: settings.showSeed ? "Seed: " + sheet.seed : "" })]));
  }

  // ---------- tabs / status ----------
  function showTab(name) {
    activeTab = name;
    var hasSheet = !!current;
    $("sheet").hidden = !(hasSheet && name === "sheet");
    $("key").hidden = !(hasSheet && name === "key");
    $("tab-sheet").setAttribute("aria-selected", String(name === "sheet"));
    $("tab-key").setAttribute("aria-selected", String(name === "key"));
  }
  function setStatus(msg) { $("status").textContent = msg || ""; }
  function showError(msg) {
    var e = $("empty"); e.hidden = false; e.className = "error"; e.textContent = msg;
  }

  // ---------- generate ----------
  function settingsFromForm() {
    return {
      grade: radio("grade"), topic: $("topic").value, difficulty: radio("difficulty"),
      counts: readCounts(), seed: G.normaliseSeed($("seed").value) || G.newSeed(),
      school: $("school").value.trim(), title: $("title").value.trim(),
      marks: $("opt-marks").checked, wordbank: $("opt-wordbank").checked, showSeed: $("opt-seed").checked
    };
  }
  function generate() {
    var s = settingsFromForm();
    $("seed").value = s.seed;
    return loadPool(s.grade, s.topic).then(function (p) {
      pool = p;
      var sheet = G.buildWorksheet(p, { seed: s.seed, counts: s.counts, difficulty: s.difficulty });
      var notes = $("notes");
      if (!sheet.sections.length) {
        current = null; showTab("sheet");
        $("empty").hidden = false; $("empty").className = "empty";
        $("empty").textContent = "No questions to show. Set at least one question type to 1 or more.";
        ["btn-print", "btn-print-both", "btn-link"].forEach(function (id) { $("" + id).disabled = true; });
        notes.hidden = true; setStatus(""); return;
      }
      current = { sheet: sheet, settings: s };
      renderSheet(sheet, s); renderKey(sheet, s);
      $("empty").hidden = true;
      notes.textContent = "";
      if (sheet.notes.length) {
        notes.appendChild(el("ul", null, sheet.notes.map(function (n) { return el("li", { text: n }); })));
        notes.hidden = false;
      } else notes.hidden = true;
      ["btn-print", "btn-print-both", "btn-link"].forEach(function (id) { $(id).disabled = false; });
      showTab(activeTab);
      setStatus("Built " + sheet.totalQuestions + " questions (" + sheet.totalMarks + " marks). Seed " + sheet.seed + " rebuilds this worksheet.");
      writeHash(s);
    }).catch(loadFailed);
  }
  function loadFailed(err) {
    var isFile = location.protocol === "file:";
    showError("Could not load the question bank (" + (err && err.message ? err.message : err) + ")." +
      (isFile ? " Browsers block loading JSON from a file:// page. Run a tiny local server (for example: python3 -m http.server) and open http://localhost:8000, or use the published site." : ""));
  }

  // ---------- URL (so a worksheet can be shared / regenerated) ----------
  function writeHash(s) {
    var p = new URLSearchParams();
    p.set("g", s.grade); p.set("t", s.topic); p.set("d", s.difficulty); p.set("s", s.seed);
    G.TYPES.forEach(function (t) { p.set(t.id, s.counts[t.id]); });
    if (s.title) p.set("title", s.title);
    if (s.school && s.school !== "Willow International") p.set("school", s.school);
    if (!s.marks) p.set("marks", "0");
    if (s.wordbank) p.set("wb", "1");
    if (!s.showSeed) p.set("showseed", "0");
    try { history.replaceState(null, "", "#" + p.toString()); } catch (e) { /* ignore */ }
  }
  function applyHash() {
    if (!location.hash || location.hash.length < 2) return false;
    var p = new URLSearchParams(location.hash.slice(1));
    if (!p.get("g") || !p.get("s")) return false;
    if (!gradeInfo(p.get("g"))) return false;
    setRadio("grade", p.get("g"));
    populateTopics(p.get("t"));
    if (["mixed", "easy", "medium", "hard"].indexOf(p.get("d")) >= 0) setRadio("difficulty", p.get("d"));
    G.TYPES.forEach(function (t) { if (p.get(t.id) != null) $("n-" + t.id).value = String(Math.max(0, Math.min(30, parseInt(p.get(t.id), 10) || 0))); });
    $("seed").value = G.normaliseSeed(p.get("s"));
    $("title").value = (p.get("title") || "").slice(0, 80);
    if (p.get("school")) $("school").value = p.get("school").slice(0, 60);
    $("opt-marks").checked = p.get("marks") !== "0";
    $("opt-wordbank").checked = p.get("wb") === "1";
    $("opt-seed").checked = p.get("showseed") !== "0";
    return true;
  }

  // ---------- printing ----------
  function printMode(mode) {
    if (!current) return;
    var sheetEl = $("sheet"), keyEl = $("key");
    var prevS = sheetEl.hidden, prevK = keyEl.hidden;
    sheetEl.hidden = mode === "key"; keyEl.hidden = mode === "sheet";
    document.body.setAttribute("data-print", mode);
    var restore = function () {
      document.body.removeAttribute("data-print");
      sheetEl.hidden = prevS; keyEl.hidden = prevK;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    var prevTitle = document.title;
    document.title = "Willow-Computing-Grade" + current.settings.grade + "-" + (mode === "key" ? "answer-key-" : "worksheet-") + current.sheet.seed;
    setTimeout(function () { window.print(); document.title = prevTitle; }, 30);
  }
  function copyLink() {
    var url = location.href;
    var done = function () { setStatus("Link copied. Anyone opening it gets the same worksheet."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt("Copy this link:", url); });
    else window.prompt("Copy this link:", url);
  }

  // ---------- wiring ----------
  function init() {
    buildCountRows();
    $("seed").value = G.newSeed();
    fetchJSON("data/index.json").then(function (m) {
      manifest = m;
      var fromHash = applyHash();
      if (!fromHash) populateTopics();
      return refreshPool().then(function () { if (fromHash) generate(); });
    }).catch(loadFailed);

    document.querySelectorAll('input[name="grade"]').forEach(function (r) {
      r.addEventListener("change", function () { populateTopics(); refreshPool().catch(loadFailed); });
    });
    $("topic").addEventListener("change", function () { refreshPool().catch(loadFailed); });
    document.querySelectorAll('input[name="difficulty"]').forEach(function (r) { r.addEventListener("change", updateAvailability); });
    $("btn-reseed").addEventListener("click", function () { $("seed").value = G.newSeed(); });
    $("controls").addEventListener("submit", function (e) { e.preventDefault(); generate(); });
    $("tab-sheet").addEventListener("click", function () { showTab("sheet"); });
    $("tab-key").addEventListener("click", function () { showTab("key"); });
    $("btn-print").addEventListener("click", function () { printMode(activeTab); });
    $("btn-print-both").addEventListener("click", function () { printMode("both"); });
    $("btn-link").addEventListener("click", copyLink);
  }
  init();
})();
