#!/usr/bin/env node
/**
 * Generates paid-delivery copies of the standalone tools and publishes
 * them into paid/, which IS committed to the repo (unlike the earlier
 * delivery/ output, which was gitignored and never published).
 *
 * IMPORTANT: paths under paid/ are reachable by anyone who knows or
 * guesses the URL — robots.txt and the noindex meta tag this script
 * injects only stop search engines from *indexing* these pages, they
 * do not restrict who can *visit* them. This is intentional per current
 * direction, not an oversight — there is no real access control here.
 *
 * The source files in this repo are the public demo build: IS_DEMO = true,
 * so Download/Save stay locked behind the upgrade modal. This script
 * copies each tool into paid/<tool>/index.html, flips IS_DEMO to false
 * in the copy only, and adds <meta name="robots" content="noindex"> to
 * its <head>. The source files in the repo are never modified.
 *
 * Usage: node scripts/build-delivery.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAID_DIR = path.join(ROOT, 'paid');

const TOOLS = ['budget-planner', 'debt-tracker', 'meal-planner'];

const FIND_DEMO = 'const IS_DEMO = true;';
const REPLACE_DEMO = 'const IS_DEMO = false;';

const HEAD_MARKER = '<meta charset="UTF-8">';
const NOINDEX_TAG = '<meta name="robots" content="noindex, nofollow">';

function buildOne(tool) {
  const srcPath = path.join(ROOT, tool, 'index.html');
  const destDir = path.join(PAID_DIR, tool);
  const destPath = path.join(destDir, 'index.html');

  const src = fs.readFileSync(srcPath, 'utf8');

  const demoOccurrences = src.split(FIND_DEMO).length - 1;
  if (demoOccurrences !== 1) {
    throw new Error(
      `${tool}/index.html: expected exactly one occurrence of "${FIND_DEMO}", found ${demoOccurrences}. ` +
      `Refusing to build — check the file hasn't drifted before re-running.`
    );
  }
  // Note: HEAD_MARKER can legitimately appear more than once (the
  // generated PDF-report template embedded later in the file has its own
  // <meta charset> for the standalone report document). That's fine --
  // String.prototype.replace() with a plain string only ever touches the
  // *first* match, and the real page's <head> always comes first in
  // document order, well before the report template is defined.
  const headOccurrences = src.split(HEAD_MARKER).length - 1;
  if (headOccurrences < 1) {
    throw new Error(
      `${tool}/index.html: expected at least one occurrence of "${HEAD_MARKER}" to anchor the noindex tag, found none. ` +
      `Refusing to build — check the file hasn't drifted before re-running.`
    );
  }

  let out = src.replace(FIND_DEMO, REPLACE_DEMO);
  out = out.replace(HEAD_MARKER, `${HEAD_MARKER}\n${NOINDEX_TAG}`);

  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(destPath, out, 'utf8');

  return { srcPath, destPath };
}

function main() {
  console.log('Building paid copies (IS_DEMO: true -> false, + noindex)...\n');
  const results = TOOLS.map(buildOne);
  for (const r of results) {
    console.log(`  ${path.relative(ROOT, r.srcPath)}  ->  ${path.relative(ROOT, r.destPath)}`);
  }
  console.log(`\nDone. ${results.length} file(s) written to ${path.relative(ROOT, PAID_DIR)}/.`);
  console.log('paid/ is committed to the repo (not gitignored) -- remember to `git add paid/` and commit after running this.');
  console.log('Source files in the repo were not modified.');
}

main();
