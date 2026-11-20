# Willow Worksheet Generator

Static site (HTML/CSS/JS – no build step, no server code, no external calls) that builds printable **A4 Computing worksheets and a separate answer key** for Willow International lower secondary (Grades 7, 8, 9). Published at **https://fichas-willow.danielpro.dev**.

## Using it
1. Choose **grade**, **topic** (or *All topics*), **difficulty** (mixed / easy / medium / hard) and how many questions of each type: multiple choice, true/false, fill in the blank, short answer, matching.
2. Press **Generate worksheet**. The *Worksheet* tab has the school header with Name / Class / Date / Score fields; the *Answer key* tab has the teacher copy.
3. **Print / Save as PDF** uses the browser print dialog (choose *Save as PDF* as the destination). *Print both* prints the worksheet followed by the key on its own page.
4. Every worksheet has a **seed** (printed in the footer). The same seed + same settings always rebuilds the same worksheet; **Copy link** stores all settings in the URL.

Topics (each for Grades 7, 8 and 9, 20 questions per grade/topic): Hardware & Software · Networks & Internet Safety · Algorithms & Flowcharts · Programming Basics (Python & Scratch) · Spreadsheets · Data Representation (Binary).

## Run / test locally
```bash
python3 -m http.server 8000     # then open http://localhost:8000  (file:// can't load the JSON)
npm test                        # no dependencies: node tests/validate-bank.js && node --test tests/generator.test.js
```

## Layout
```
index.html, css/style.css       UI and A4 print styles
js/generator.js                 seeded selection/shuffling (pure logic, also tested in Node)
js/app.js                       browser UI
data/index.json                 manifest: grades → topics → files
data/grade{7,8,9}/<topic>.json  the question bank
data/schema.json                reference JSON Schema for a topic file
tests/validate-bank.js          schema + consistency check of the whole bank
tests/generator.test.js         tests for seeding, counts, answer-key correctness
```

## Adding questions
Open `data/grade<N>/<topic>.json` and append an object to `questions`. Keep ids unique and in the form `g<grade>-<topic code>-<number>` (e.g. `g8-net-21`; the topic code is the middle part of the existing ids). One question per line keeps diffs small. Then run `npm test` – it lists every problem it finds.

Common fields: `id`, `type`, `difficulty` (`easy` | `medium` | `hard`), `q` (question text), optional `code` (shown in a code box) and `explain` (shown only in the answer key). In `q`, `` `backticks` `` make inline code.

| `type` | extra fields | example |
|---|---|---|
| `mcq` | `options`: exactly 4 different strings; `answer`: index (0–3) of the correct one. Options are shuffled on every worksheet, so don't write "All of the above". | `{"id":"g7-hw-21","type":"mcq","difficulty":"easy","q":"Which is an input device?","options":["Keyboard","Monitor","Speaker","Printer"],"answer":0}` |
| `tf` | `answer`: `true` / `false` | `{"id":"g7-hw-22","type":"tf","difficulty":"easy","q":"A mouse is an output device.","answer":false,"explain":"A mouse is an input device."}` |
| `fill` | put `____` (3+ underscores) in `q` for each blank; `answer`: array with one string per blank. Text in brackets, e.g. `"CPU (processor)"`, is shown in the key but dropped from the word bank. | `{"id":"g7-hw-23","type":"fill","difficulty":"easy","q":"The ____ carries out instructions.","answer":["CPU (processor)"]}` |
| `short` | `answer`: model answer / mark scheme text; `marks`: 1–5 (also sets the number of answer lines) | `{"id":"g7-hw-24","type":"short","difficulty":"medium","q":"State two input devices.","answer":"Any two: keyboard; mouse; …","marks":2}` |
| `match` | `pairs`: 3–6 `[left, right]` pairs; left items all different, right items all different. The right column is shuffled on the worksheet. | `{"id":"g7-hw-25","type":"match","difficulty":"easy","q":"Match each device to its use.","pairs":[["Keyboard","Typing"],["Monitor","Display"],["Speakers","Sound"]]}` |

Marks: mcq and tf = 1, fill = number of blanks, match = number of pairs, short = `marks`.

Rules the test enforces: ≥ 20 questions per grade/topic file, every type present at least once, at least two difficulty levels, unique ids and question texts, `grade`/`topic` matching the manifest.

**New topic:** create `data/grade<N>/<topic-id>.json` for each grade (`grade`, `topic`, `title`, `questions`) and list it under that grade in `data/index.json`. No code changes needed.

## Publishing
`danielpro-site.json` sets the subdomain (`fichas-willow`). Merging to `main` publishes the site (see `AGENTS.md`). Work happens on `claude/...` branches via pull requests.
