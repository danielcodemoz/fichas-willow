#!/usr/bin/env node
/* Generator behaviour tests (Node built-in test runner, no dependencies). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const G = require("../js/generator.js");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "data/index.json"), "utf8"));
const load = (grade, topic) => {
  const g = manifest.grades.find((x) => x.grade === grade);
  const topics = topic === "all" ? g.topics : g.topics.filter((t) => t.id === topic);
  return topics.flatMap((t) => JSON.parse(fs.readFileSync(path.join(ROOT, t.file), "utf8")).questions);
};
const counts = { mcq: 5, tf: 4, fill: 4, short: 2, match: 1 };
const serialise = (s) => JSON.stringify(s);

test("same seed and settings give an identical worksheet", () => {
  const pool = load(7, "hardware-software");
  const a = G.buildWorksheet(pool, { seed: "ABC123", counts, difficulty: "mixed" });
  const b = G.buildWorksheet(pool.slice().reverse(), { seed: "abc123", counts, difficulty: "mixed" });
  assert.equal(serialise(a), serialise(b));
});

test("different seeds give different worksheets", () => {
  const pool = load(8, "networks-safety");
  const a = G.buildWorksheet(pool, { seed: "AAAAAA", counts, difficulty: "mixed" });
  const b = G.buildWorksheet(pool, { seed: "BBBBBB", counts, difficulty: "mixed" });
  assert.notEqual(serialise(a), serialise(b));
});

test("requested counts are honoured and numbering is continuous", () => {
  const pool = load(9, "programming");
  const s = G.buildWorksheet(pool, { seed: "S1", counts, difficulty: "mixed" });
  assert.deepEqual(s.sections.map((x) => x.items.length), [5, 4, 4, 2, 1]);
  const nums = s.sections.flatMap((x) => x.items.map((i) => i.number));
  assert.deepEqual(nums, nums.map((_, i) => i + 1));
  assert.equal(s.totalQuestions, 16);
  assert.equal(s.totalMarks, s.sections.reduce((a, x) => a + x.items.reduce((b, i) => b + i.marks, 0), 0));
});

test("a section with count 0 is skipped; nothing selected gives no sections", () => {
  const pool = load(7, "spreadsheets");
  const s = G.buildWorksheet(pool, { seed: "S2", counts: { mcq: 0, tf: 3 }, difficulty: "mixed" });
  assert.deepEqual(s.sections.map((x) => x.type), ["tf"]);
  assert.equal(G.buildWorksheet(pool, { seed: "S2", counts: {}, difficulty: "mixed" }).sections.length, 0);
});

test("no question is repeated within a worksheet", () => {
  const pool = load(8, "all");
  const s = G.buildWorksheet(pool, { seed: "S3", counts: { mcq: 20, tf: 15, fill: 15, short: 10, match: 10 }, difficulty: "mixed" });
  const ids = s.sections.flatMap((x) => x.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("asking for more than exists is clamped with a note", () => {
  const pool = load(7, "data-representation");
  const s = G.buildWorksheet(pool, { seed: "S4", counts: { match: 50 }, difficulty: "mixed" });
  assert.ok(s.sections[0].items.length <= pool.filter((q) => q.type === "match").length);
  assert.ok(s.notes.length >= 1);
});

test("difficulty filter prefers the chosen level and says when it tops up", () => {
  const pool = load(9, "hardware-software");
  const hard = pool.filter((q) => q.type === "mcq" && q.difficulty === "hard").length;
  const s = G.buildWorksheet(pool, { seed: "S5", counts: { mcq: hard + 2 }, difficulty: "hard" });
  const hardInSheet = s.sections[0].items.filter((i) => i.difficulty === "hard").length;
  assert.equal(hardInSheet, hard);
  assert.ok(s.notes.some((n) => /nearest difficulty/.test(n)));
  const easy = G.buildWorksheet(pool, { seed: "S5", counts: { tf: 1 }, difficulty: "easy" });
  assert.equal(easy.sections[0].items[0].difficulty === "easy" || easy.notes.length > 0, true);
});

test("multiple choice answer key matches the shuffled options", () => {
  const pool = load(8, "data-representation");
  const byId = new Map(pool.map((q) => [q.id, q]));
  for (const seed of ["A", "B", "C", "D", "E", "F"]) {
    const s = G.buildWorksheet(pool, { seed, counts: { mcq: 6 }, difficulty: "mixed" });
    s.sections[0].items.forEach((it) => {
      const src = byId.get(it.id);
      assert.equal(it.options[it.answerIndex], src.options[src.answer]);
      assert.equal(it.answerLetter, "ABCD"[it.answerIndex]);
      assert.deepEqual(it.options.slice().sort(), src.options.slice().sort());
    });
  }
});

test("matching answer letters point at the right partner", () => {
  const pool = load(9, "networks-safety");
  const byId = new Map(pool.map((q) => [q.id, q]));
  for (const seed of ["M1", "M2", "M3", "M4"]) {
    const s = G.buildWorksheet(pool, { seed, counts: { match: 3 }, difficulty: "mixed" });
    s.sections[0].items.forEach((it) => {
      const src = byId.get(it.id);
      it.left.forEach((l, i) => {
        const letter = it.matchLetters[i];
        const right = it.right["ABCDEFGH".indexOf(letter)];
        const pair = src.pairs.find((p) => p[0] === l);
        assert.equal(right, pair[1]);
      });
    });
  }
});

test("changing the MCQ count does not change which true/false questions are picked", () => {
  const pool = load(7, "algorithms-flowcharts");
  const a = G.buildWorksheet(pool, { seed: "KEEP", counts: { mcq: 2, tf: 4 }, difficulty: "mixed" });
  const b = G.buildWorksheet(pool, { seed: "KEEP", counts: { mcq: 6, tf: 4 }, difficulty: "mixed" });
  const tf = (s) => s.sections.find((x) => x.type === "tf").items.map((i) => i.id);
  assert.deepEqual(tf(a), tf(b));
});

test("newSeed and normaliseSeed", () => {
  const s = G.newSeed();
  assert.match(s, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(G.normaliseSeed("  ab c-12!! "), "ABC-12");
});

test("word bank contains every fill answer", () => {
  const pool = load(8, "hardware-software");
  const s = G.buildWorksheet(pool, { seed: "WB", counts: { fill: 4 }, difficulty: "mixed" });
  const bank = G.wordBank(s, "WB");
  const n = s.sections[0].items.reduce((a, i) => a + i.answers.length, 0);
  assert.equal(bank.length, n);
});
