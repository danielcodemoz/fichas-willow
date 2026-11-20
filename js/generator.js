/*
 * Worksheet generator core (pure logic, no DOM).
 * Works in the browser (window.WorksheetGen) and in Node (require) so it can be tested.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WorksheetGen = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TYPES = [
    { id: "mcq", label: "Multiple choice", section: "Multiple choice", instruction: "Circle the letter of the correct answer." },
    { id: "tf", label: "True / False", section: "True or false", instruction: "Circle True or False for each statement." },
    { id: "fill", label: "Fill in the blank", section: "Fill in the blanks", instruction: "Write the missing word or words in each blank." },
    { id: "short", label: "Short answer", section: "Short answer", instruction: "Answer each question in the space provided." },
    { id: "match", label: "Matching", section: "Matching", instruction: "Draw a line or write the correct letter to match each item on the left with its partner on the right." }
  ];
  var DIFFICULTIES = ["easy", "medium", "hard"];
  var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  var SEED_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1

  // ---- seeded random numbers -------------------------------------------------
  function hashString(str) { // xmur3-style 32-bit hash
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rngFor(seed, label) { return mulberry32(hashString(seed + "|" + label)); }
  function normaliseSeed(s) { return String(s == null ? "" : s).trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16); }
  function newSeed(random) {
    random = random || Math.random;
    var s = "";
    for (var i = 0; i < 6; i++) s += SEED_ALPHABET.charAt(Math.floor(random() * SEED_ALPHABET.length));
    return s;
  }
  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---- helpers ---------------------------------------------------------------
  function marksFor(q) {
    switch (q.type) {
      case "fill": return q.answer.length;
      case "short": return q.marks;
      case "match": return q.pairs.length;
      default: return 1;
    }
  }
  function countBlanks(text) { return (String(text).match(/_{3,}/g) || []).length; }

  function filterByDifficulty(pool, difficulty, n) {
    // returns candidate list, ordered by preference (desired difficulty first, then nearest)
    if (!difficulty || difficulty === "mixed") return { list: pool, toppedUp: false };
    var want = DIFFICULTIES.indexOf(difficulty);
    var exact = pool.filter(function (q) { return q.difficulty === difficulty; });
    if (exact.length >= n) return { list: exact, toppedUp: false };
    var others = pool.filter(function (q) { return q.difficulty !== difficulty; });
    return { list: exact.concat(others), toppedUp: true, exactCount: exact.length, want: want, others: others };
  }

  function availableCounts(pool, difficulty) {
    var out = {};
    TYPES.forEach(function (t) {
      var ofType = pool.filter(function (q) { return q.type === t.id; });
      out[t.id] = (!difficulty || difficulty === "mixed")
        ? ofType.length
        : ofType.filter(function (q) { return q.difficulty === difficulty; }).length;
      out[t.id + ":total"] = ofType.length;
    });
    return out;
  }

  /**
   * Build a worksheet.
   * pool: array of question objects (each with id, type, difficulty ...)
   * opts: { seed, counts: {mcq:5,...}, difficulty: "mixed"|"easy"|"medium"|"hard" }
   * returns { seed, difficulty, sections:[{type,label,section,instruction,items:[...]}], totalMarks, notes:[] }
   */
  function buildWorksheet(pool, opts) {
    var seed = normaliseSeed(opts.seed) || "WILLOW";
    var difficulty = opts.difficulty || "mixed";
    var counts = opts.counts || {};
    var notes = [];
    var sorted = pool.slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    var number = 0, totalMarks = 0;
    var sections = [];

    TYPES.forEach(function (t) {
      var want = Math.max(0, Math.floor(Number(counts[t.id]) || 0));
      if (!want) return;
      var ofType = sorted.filter(function (q) { return q.type === t.id; });
      if (!ofType.length) { notes.push("No " + t.label.toLowerCase() + " questions available for this selection."); return; }
      var rng = rngFor(seed, "pick:" + t.id);
      var chosen;
      var f = filterByDifficulty(ofType, difficulty, want);
      if (!f.toppedUp) {
        chosen = shuffle(f.list, rng).slice(0, want);
      } else {
        var exact = shuffle(f.list.slice(0, f.exactCount), rng);
        var wantIdx = f.want;
        var rest = shuffle(f.others, rng).sort(function (a, b) {
          return Math.abs(DIFFICULTIES.indexOf(a.difficulty) - wantIdx) - Math.abs(DIFFICULTIES.indexOf(b.difficulty) - wantIdx);
        });
        chosen = exact.concat(rest).slice(0, want);
        notes.push("Only " + f.exactCount + " " + difficulty + " " + t.label.toLowerCase() + " question" + (f.exactCount === 1 ? "" : "s") + " available; the rest are from the nearest difficulty.");
      }
      if (chosen.length < want) notes.push("Only " + chosen.length + " " + t.label.toLowerCase() + " question" + (chosen.length === 1 ? "" : "s") + " available (asked for " + want + ").");
      // easy -> hard inside a section (stable: shuffled order kept within a level)
      chosen = chosen.map(function (q, i) { return { q: q, i: i }; })
        .sort(function (a, b) {
          var d = DIFFICULTIES.indexOf(a.q.difficulty) - DIFFICULTIES.indexOf(b.q.difficulty);
          return d || a.i - b.i;
        }).map(function (x) { return x.q; });

      var items = chosen.map(function (q) {
        number += 1;
        var item = present(q, seed);
        item.number = number;
        item.marks = marksFor(q);
        totalMarks += item.marks;
        return item;
      });
      sections.push({ type: t.id, label: t.label, section: t.section, instruction: t.instruction, items: items });
    });

    sections.forEach(function (s, i) { s.letter = LETTERS.charAt(i); });
    return { seed: seed, difficulty: difficulty, sections: sections, totalMarks: totalMarks, totalQuestions: number, notes: notes };
  }

  // Create the version of a question that is shown (options / right-hand column shuffled)
  function present(q, seed) {
    var rng = rngFor(seed, "present:" + q.id);
    var item = { id: q.id, type: q.type, difficulty: q.difficulty, q: q.q, code: q.code || null, explain: q.explain || null };
    if (q.type === "mcq") {
      var order = shuffle(q.options.map(function (_, i) { return i; }), rng);
      item.options = order.map(function (i) { return q.options[i]; });
      item.answerIndex = order.indexOf(q.answer);
      item.answerLetter = LETTERS.charAt(item.answerIndex);
    } else if (q.type === "tf") {
      item.answer = q.answer;
    } else if (q.type === "fill") {
      item.answers = q.answer.slice();
    } else if (q.type === "short") {
      item.answer = q.answer;
    } else if (q.type === "match") {
      var rightOrder = shuffle(q.pairs.map(function (_, i) { return i; }), rng);
      // avoid a worksheet where every pair is already lined up
      if (q.pairs.length > 1 && rightOrder.every(function (v, i) { return v === i; })) rightOrder.push(rightOrder.shift());
      item.left = q.pairs.map(function (p) { return p[0]; });
      item.right = rightOrder.map(function (i) { return q.pairs[i][1]; });
      item.matchLetters = q.pairs.map(function (_, leftIdx) { return LETTERS.charAt(rightOrder.indexOf(leftIdx)); });
    }
    return item;
  }

  // Fill-in word bank (all answers shuffled), used when the teacher ticks the option
  function wordBank(sheet, seed) {
    var words = [];
    sheet.sections.forEach(function (s) {
      if (s.type === "fill") s.items.forEach(function (it) { it.answers.forEach(function (a) { words.push(a.replace(/\s*\(.*\)\s*$/, "")); }); });
    });
    return shuffle(words, rngFor(normaliseSeed(seed) || "WILLOW", "wordbank"));
  }

  return {
    TYPES: TYPES, DIFFICULTIES: DIFFICULTIES, LETTERS: LETTERS,
    hashString: hashString, mulberry32: mulberry32, normaliseSeed: normaliseSeed, newSeed: newSeed, shuffle: shuffle,
    marksFor: marksFor, countBlanks: countBlanks, availableCounts: availableCounts,
    buildWorksheet: buildWorksheet, wordBank: wordBank
  };
});
