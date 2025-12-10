#!/usr/bin/env node
/**
 * Preprocess raw sequences by removing frames where pressure_delta < threshold
 * (e.g., contact glitch around -800). Writes cleaned JSONs to a target folder.
 *
 * Usage:
 *   node preprocess_pressure_drop.js \
 *     --input ../data/raw/251209pillowmate_full \
 *     --output ../data/preprocessed/251209pillowmate_full \
 *     --threshold -800
 */

import fs from "fs";
import path from "path";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { threshold: -800 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--input") opts.input = args[++i];
    else if (a === "--output") opts.output = args[++i];
    else if (a === "--threshold") opts.threshold = Number(args[++i]);
  }
  if (!opts.input || !opts.output) {
    console.error("Usage: node preprocess_pressure_drop.js --input <raw_dir> --output <clean_dir> [--threshold -800]");
    process.exit(1);
  }
  return opts;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function preprocessFile(srcPath, dstPath, threshold) {
  const raw = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  const idx = raw.feature_names.indexOf("pressure_delta");
  if (idx === -1) {
    console.warn(`Skipping ${srcPath}: pressure_delta not found`);
    return { kept: 0, removed: 0, skipped: true };
  }
  const features = raw.features || [];
  const cleaned = [];
  let removed = 0;
  for (const frame of features) {
    if (typeof frame[idx] === "number" && frame[idx] < threshold) {
      removed++;
      continue;
    }
    cleaned.push(frame);
  }
  const out = {
    ...raw,
    frame_count: cleaned.length,
    features: cleaned,
  };
  fs.writeFileSync(dstPath, JSON.stringify(out));
  return { kept: cleaned.length, removed, skipped: false };
}

function main() {
  const { input, output, threshold } = parseArgs();
  const srcDir = path.resolve(input);
  const dstDir = path.resolve(output);
  ensureDir(dstDir);

  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".json"));
  let totalRemoved = 0;
  let totalKept = 0;
  for (const f of files) {
    const srcPath = path.join(srcDir, f);
    const dstPath = path.join(dstDir, f);
    const { kept, removed, skipped } = preprocessFile(srcPath, dstPath, threshold);
    totalKept += kept;
    totalRemoved += removed;
    if (!skipped) {
      console.log(`${f}: kept ${kept}, removed ${removed}`);
    }
  }
  console.log(`Done. Removed ${totalRemoved} frames across ${files.length} files. Kept ${totalKept}.`);
}

main();
