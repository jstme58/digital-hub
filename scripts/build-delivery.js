#!/usr/bin/env node
/**
 * Generates paid-delivery copies of the standalone tools.
 *
 * The source files in this repo are the public demo build: IS_DEMO = true,
 * so downloaded reports always carry the SAMPLE watermark. This script
 * copies each tool into delivery/ (gitignored — never published) and flips
 * IS_DEMO to false in the copy only, so the delivered file produces clean,
 * watermark-free reports. The source files in the repo are never modified.
 *
 * Usage: node scripts/build-delivery.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DELIVERY_DIR = path.join(ROOT, 'delivery');

const TOOLS = ['budget-planner', 'debt-tracker', 'meal-planner'];

const FIND = 'const IS_DEMO = true;';
const REPLACE = 'const IS_DEMO = false;';

function buildOne(tool) {
  const srcPath = path.join(ROOT, tool, 'index.html');
  const destDir = path.join(DELIVERY_DIR, tool);
  const destPath = path.join(destDir, 'index.html');

  const src = fs.readFileSync(srcPath, 'utf8');

  const occurrences = src.split(FIND).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `${tool}/index.html: expected exactly one occurrence of "${FIND}", found ${occurrences}. ` +
      `Refusing to build — check the file hasn't drifted before re-running.`
    );
  }

  const out = src.replace(FIND, REPLACE);

  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(destPath, out, 'utf8');

  return { srcPath, destPath };
}

function main() {
  console.log('Building paid-delivery copies (IS_DEMO: true -> false)...\n');
  const results = TOOLS.map(buildOne);
  for (const r of results) {
    console.log(`  ${path.relative(ROOT, r.srcPath)}  ->  ${path.relative(ROOT, r.destPath)}`);
  }
  console.log(`\nDone. ${results.length} file(s) written to ${path.relative(ROOT, DELIVERY_DIR)}/ (gitignored, not committed).`);
  console.log('Source files in the repo were not modified.');
}

main();
