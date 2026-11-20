#!/usr/bin/env node
/*
 * Question-bank schema check (Node, no dependencies).
 *   node tests/validate-bank.js        -> checks data/index.json and every file it lists
 * Exits with code 1 and prints every problem found.
 * The rules mirror data/schema.json and the "Adding questions" section of README.md.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MIN_PER_TOPIC = 20;
const GRADES = [7, 8, 9];
const TYPES = ["mcq", "tf", "fill", "short", "match"];
const DIFFS = ["easy", "medium", "hard"];
const ID_RE = /^g[789]-[a-z]+-\d{2,3}$/;
const errors = [];
const err = (where, msg) => errors.push(where + ": " + msg);

function readJSON(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }
  catch (e) { err(rel, "cannot read/parse JSON (" + e.message + ")"); return null; }
}
const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const blanks = (t) => (String(t).match(/_{3,}/g) || []).length;
const allowedKeys = {
  mcq: ["id", "type", "difficulty", "q", "code", "explain", "options", "answer"],
  tf: ["id", "type", "difficulty", "q", "code", "explain", "answer"],
  fill: ["id", "type", "difficulty", "q", "code", "explain", "answer"],
  short: ["id", "type", "difficulty", "q", "code", "explain", "answer", "marks"],
  match: ["id", "type", "difficulty", "q", "code", "explain", "pairs"]
};

function checkQuestion(q, where, file) {
  if (!q || typeof q !== "object" || Array.isArray(q)) return err(where, "question must be an object");
  if (!isStr(q.id) || !ID_RE.test(q.id)) err(where, `id "${q.id}" must look like g7-hw-01 (g + grade, topic code, number)`);
  else if (!q.id.startsWith("g" + file.grade + "-")) err(where, `id "${q.id}" does not start with g${file.grade}-`);
  if (!TYPES.includes(q.type)) return err(where, `type "${q.type}" must be one of ${TYPES.join(", ")}`);
  if (!DIFFS.includes(q.difficulty)) err(where, `difficulty "${q.difficulty}" must be one of ${DIFFS.join(", ")}`);
  if (!isStr(q.q)) err(where, "q (question text) is required");
  if (q.code !== undefined && !isStr(q.code)) err(where, "code must be a non-empty string when present");
  if (q.explain !== undefined && !isStr(q.explain)) err(where, "explain must be a non-empty string when present");
  Object.keys(q).forEach((k) => { if (!allowedKeys[q.type].includes(k)) err(where, `unexpected property "${k}" for type ${q.type}`); });

  switch (q.type) {
    case "mcq": {
      if (!Array.isArray(q.options) || q.options.length !== 4) { err(where, "options must be an array of exactly 4 strings"); break; }
      if (!q.options.every(isStr)) err(where, "every option must be a non-empty string");
      if (new Set(q.options.map((o) => String(o).trim().toLowerCase())).size !== q.options.length) err(where, "options must all be different");
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) err(where, "answer must be the index (0-3) of the correct option");
      q.options.forEach((o) => { if (/^(all|none) of the above$/i.test(String(o).trim())) err(where, 'avoid "All/None of the above" (options are shuffled)'); });
      break;
    }
    case "tf":
      if (typeof q.answer !== "boolean") err(where, "answer must be true or false");
      break;
    case "fill": {
      if (!Array.isArray(q.answer) || !q.answer.length || !q.answer.every(isStr)) { err(where, "answer must be a non-empty array of strings (one per blank)"); break; }
      if (blanks(q.q) !== q.answer.length) err(where, `q has ${blanks(q.q)} blank(s) (____) but answer has ${q.answer.length} item(s)`);
      break;
    }
    case "short":
      if (!isStr(q.answer)) err(where, "answer (model answer) must be a non-empty string");
      if (!Number.isInteger(q.marks) || q.marks < 1 || q.marks > 5) err(where, "marks must be an integer 1-5");
      break;
    case "match": {
      if (!Array.isArray(q.pairs) || q.pairs.length < 3 || q.pairs.length > 6) { err(where, "pairs must be an array of 3-6 [left, right] pairs"); break; }
      if (!q.pairs.every((p) => Array.isArray(p) && p.length === 2 && isStr(p[0]) && isStr(p[1]))) { err(where, "each pair must be [left, right] with two non-empty strings"); break; }
      if (new Set(q.pairs.map((p) => p[0].trim().toLowerCase())).size !== q.pairs.length) err(where, "left items must all be different");
      if (new Set(q.pairs.map((p) => p[1].trim().toLowerCase())).size !== q.pairs.length) err(where, "right items must all be different");
      break;
    }
  }
  if (q.type !== "fill" && blanks(q.q) > 0) err(where, "only fill questions may contain ____");
}

function main() {
  const manifest = readJSON("data/index.json");
  if (!manifest) return;
  if (!Array.isArray(manifest.grades)) return err("data/index.json", "grades must be an array");
  const seenIds = new Map();
  const seenFiles = new Set();
  const seenGrades = [];

  manifest.grades.forEach((g) => {
    seenGrades.push(g.grade);
    if (!GRADES.includes(g.grade)) err("data/index.json", `grade ${g.grade} not allowed (use 7, 8 or 9)`);
    if (!Array.isArray(g.topics) || !g.topics.length) return err("data/index.json", `grade ${g.grade} has no topics`);
    g.topics.forEach((t) => {
      const where = t.file || `grade ${g.grade} topic ${t.id}`;
      if (!/^[a-z][a-z0-9-]*$/.test(t.id || "")) err(where, `topic id "${t.id}" must be lower-case letters, digits and hyphens`);
      if (!isStr(t.title)) err(where, "manifest topic needs a title");
      const expected = `data/grade${g.grade}/${t.id}.json`;
      if (t.file !== expected) err(where, `file should be "${expected}"`);
      seenFiles.add(t.file);
      const f = readJSON(t.file);
      if (!f) return;
      if (f.grade !== g.grade) err(where, `grade is ${f.grade} but manifest says ${g.grade}`);
      if (f.topic !== t.id) err(where, `topic is "${f.topic}" but manifest says "${t.id}"`);
      if (!isStr(f.title)) err(where, "title is required");
      if (!Array.isArray(f.questions)) return err(where, "questions must be an array");
      if (f.questions.length < MIN_PER_TOPIC) err(where, `has ${f.questions.length} questions; at least ${MIN_PER_TOPIC} are required`);
      const perType = {}; const perDiff = {};
      f.questions.forEach((q, i) => {
        const qw = `${t.file} #${i + 1}${q && q.id ? " (" + q.id + ")" : ""}`;
        checkQuestion(q, qw, f);
        if (q && q.id) {
          if (seenIds.has(q.id)) err(qw, `duplicate id (also in ${seenIds.get(q.id)})`);
          seenIds.set(q.id, t.file);
        }
        if (q) { perType[q.type] = (perType[q.type] || 0) + 1; perDiff[q.difficulty] = (perDiff[q.difficulty] || 0) + 1; }
      });
      // every topic must support every worksheet question type and at least two difficulty levels
      TYPES.forEach((ty) => { if (!perType[ty]) err(where, `needs at least one "${ty}" question`); });
      if (Object.keys(perDiff).length < 2) err(where, "needs questions of at least two difficulty levels");
      const texts = f.questions.map((q) => q && String(q.q).trim().toLowerCase() + "|" + (q && q.code || ""));
      if (new Set(texts).size !== texts.length) err(where, "duplicate question text");
    });
  });
  GRADES.forEach((g) => { if (!seenGrades.includes(g)) err("data/index.json", `grade ${g} is missing`); });

  // data files not listed in the manifest
  for (const dir of fs.readdirSync(path.join(ROOT, "data"))) {
    const full = path.join(ROOT, "data", dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full)) {
      const rel = `data/${dir}/${file}`;
      if (file.endsWith(".json") && !seenFiles.has(rel)) err(rel, "not listed in data/index.json");
    }
  }
  return seenIds.size;
}

const total = main();
if (errors.length) {
  console.error("Question bank check FAILED (" + errors.length + " problem" + (errors.length === 1 ? "" : "s") + "):\n");
  errors.forEach((e) => console.error(" - " + e));
  process.exit(1);
}
console.log("Question bank OK: " + total + " questions checked.");
