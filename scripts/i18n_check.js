#!/usr/bin/env node
/**
 * i18n completeness + hardcoded-string heuristic checker.
 *
 * Two independent checks per file:
 *   1. Completeness: every data-i18n="key" / t('key') used in the file
 *      resolves to a real key in all 4 language blocks (en/fr/es/pt) of
 *      that file's own T object. Also flags setLang() recursion/bloat.
 *   2. Hardcoded-string heuristic: flags likely English prose that was
 *      baked directly into a template/assignment instead of routed
 *      through t() -- the exact root cause behind most of this
 *      project's translation bugs (a debt card, a tip, a custom field
 *      built once at creation time with an English literal, so it
 *      never updates on a later language switch).
 *
 * This is a best-effort heuristic, not a parser: false positives are
 * expected and fine (skim and dismiss them), false negatives are the
 * thing to minimize. Every hit is for a human to look at, not to
 * auto-fix.
 *
 * Usage: node scripts/i18n_check.js [file ...]
 *   (defaults to the 5 in-scope tool files if none given)
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_FILES = [
  'index.html',
  'budget-planner/index.html',
  'debt-tracker/index.html',
  'meal-planner/index.html',
  'suite/index.html',
];

const files = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES)
  .map(f => path.isAbsolute(f) ? f : path.join(__dirname, '..', f));

function stripStrings(s) {
  // blank out string literal contents so a key-like substring inside
  // translated prose text can't cause a false "key defined" match
  return s.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

function extractLangBlock(objText, lang) {
  const marker = new RegExp('\\b' + lang + '\\s*:\\s*\\{');
  const m = marker.exec(objText);
  if (!m) return null;
  let start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < objText.length; i++) {
    if (objText[i] === '{') depth++;
    else if (objText[i] === '}') { depth--; if (depth === 0) return objText.slice(start, i + 1); }
  }
  return null;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// Looks like real translatable prose, not a CSS token, class name, id,
// URL, hex color, single word/emoji, or number.
function looksLikeProse(str) {
  if (str.length < 4) return false;
  if (/^[a-z0-9_-]+$/i.test(str) && !str.includes(' ')) return false; // single token, e.g. "flex" or "ep_income"
  if (/^#[0-9a-f]{3,8}$/i.test(str)) return false; // hex color
  if (/^https?:\/\//.test(str)) return false; // URL
  if (/^[\d.,$€£%\s/-]+$/.test(str)) return false; // pure numbers/currency/punctuation
  if (!/[a-zA-Z]{3,}/.test(str)) return false; // needs at least one real word
  return true;
}

function findHardcodedStrings(html) {
  const hits = [];
  const seen = new Set();

  function record(index, snippet, reason) {
    const ln = lineOf(html, index);
    const key = ln + '|' + reason;
    if (seen.has(key)) return; // one hit per line/reason is enough noise
    seen.add(key);
    hits.push({ line: ln, reason, snippet: snippet.trim().slice(0, 100) });
  }

  // Pass 1: .textContent = / .innerHTML = statements. Grab the rest of
  // the statement up to the line end or semicolon, and flag any string
  // literal in it that isn't the sole argument to t(...).
  const assignRe = /\.(textContent|innerHTML)\s*=\s*([^;\n]+)/g;
  let m;
  while ((m = assignRe.exec(html))) {
    const rhs = m[2];
    if (/^\s*t\(\s*['"][^'"]+['"]\s*\)\s*$/.test(rhs)) continue; // textContent=t('key') -- fine
    const litRe = /(['"])((?:(?!\1)[^\\]|\\.)*)\1/g;
    let lm;
    while ((lm = litRe.exec(rhs))) {
      const str = lm[2];
      // skip literals that are themselves the argument of a t(...) call
      // immediately preceding this match
      const before = rhs.slice(Math.max(0, lm.index - 3), lm.index);
      if (/t\(\s*$/.test(before)) continue;
      if (looksLikeProse(str)) {
        record(m.index, m[0], `hardcoded .${m[1]} literal: "${str}"`);
      }
    }
  }

  // Pass 2: object-literal display fields (txt/tip/label/tag/detail/
  // title/desc/message/msg) assigned a plain string literal instead of
  // a t(...) call. This is the exact pattern that caused the debt-card
  // and tip-tag bugs.
  const fieldRe = /\b(txt|tip|label|tag|detail|title|desc|message|msg)\s*:\s*(['"])((?:(?!\2)[^\\]|\\.)*)\2/g;
  while ((m = fieldRe.exec(html))) {
    const str = m[3];
    if (looksLikeProse(str)) {
      record(m.index, m[0], `hardcoded "${m[1]}:" field: "${str}"`);
    }
  }

  return hits.sort((a, b) => a.line - b.line);
}

for (const filePath of files) {
  const rel = path.relative(path.join(__dirname, '..'), filePath);
  let html;
  try {
    html = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.log('\n=== ' + rel + ' ===\n  COULD NOT READ FILE: ' + e.message);
    continue;
  }
  console.log('\n=== ' + rel + ' ===');

  // ---- completeness check ----
  const usedKeys = new Set();
  [...html.matchAll(/data-i18n="([^"]+)"/g)].forEach(mm => usedKeys.add(mm[1]));
  [...html.matchAll(/\bt\(['"]([^'"]+)['"]\)/g)].forEach(mm => usedKeys.add(mm[1]));

  const objMatch = html.match(/const\s+T\s*=\s*\{/);
  if (!objMatch) {
    console.log('  NO T OBJECT FOUND (skipping completeness check)');
  } else {
    let start = objMatch.index + objMatch[0].length - 1;
    let depth = 0, end = -1;
    for (let i = start; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const objText = html.slice(start, end + 1);
    const langs = ['en', 'fr', 'es', 'pt'];
    console.log('  used keys (data-i18n + t()): ' + usedKeys.size);
    let anyMissing = false;
    for (const lang of langs) {
      const block = extractLangBlock(objText, lang);
      if (!block) { console.log('  [' + lang + '] BLOCK NOT FOUND'); anyMissing = true; continue; }
      const stripped = stripStrings(block);
      const missing = [...usedKeys].filter(k => !new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:').test(stripped));
      if (missing.length) { console.log('  [' + lang + '] MISSING: ' + missing.join(', ')); anyMissing = true; }
    }
    if (!anyMissing) console.log('  all keys present in all 4 languages');
  }

  const setLangMatch = html.match(/function\s+setLang\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  if (setLangMatch) {
    const body = setLangMatch[1];
    console.log('  setLang sets documentElement.lang: ' + (body.includes('documentElement.lang') ? 'YES' : 'NO'));
    console.log('  setLang body length: ' + body.length + (body.length > 800 ? '  [!] unusually long, check for recursion/duplication' : ''));
  } else {
    console.log('  NO setLang() FOUND');
  }

  // ---- hardcoded-string heuristic ----
  const hits = findHardcodedStrings(html);
  if (hits.length) {
    console.log('  possible hardcoded strings (' + hits.length + ', review manually):');
    hits.forEach(h => console.log('    L' + h.line + ': ' + h.reason));
  } else {
    console.log('  no likely-hardcoded strings flagged');
  }
}
