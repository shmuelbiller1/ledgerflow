import fs from 'fs';
import path from 'path';
import { computeQualityMetrics, QualityMetrics } from './quality-metrics.js';

const baselinePath = path.join(process.cwd(), 'quality-baseline.json');

function updateBaseline() {
  const currentMetrics = computeQualityMetrics();
  let baseline: QualityMetrics = {
    anyCount: Infinity,
    utcDateCount: Infinity,
    arrayIndexKeys: Infinity,
    blankNoOpener: Infinity,
    consoleLog: Infinity,
    serverTsLines: Infinity,
    filesOver800: Infinity,
    orphanFiles: Infinity,
    suppressionCount: Infinity,
    untestedViews: Infinity,
    overlaysWithoutDialog: Infinity,
    rawTables: Infinity,
    handTypedApiCalls: Infinity,
    directDbWrites: Infinity,
    screensWithManyPrimaryButtons: Infinity,
  };

  if (fs.existsSync(baselinePath)) {
    try {
      baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    } catch {
      console.warn('Failed to parse existing quality-baseline.json, initializing new baseline.');
    }
  }

  const newBaseline: QualityMetrics = { ...baseline };
  let updated = false;

  for (const key of Object.keys(currentMetrics) as (keyof QualityMetrics)[]) {
    const currentVal = currentMetrics[key];
    const baselineVal = baseline[key] ?? Infinity;

    if (currentVal < baselineVal) {
      console.log(`Ratchet improved for ${key}: ${baselineVal} -> ${currentVal}`);
      newBaseline[key] = currentVal;
      updated = true;
    } else if (baselineVal === Infinity) {
      newBaseline[key] = currentVal;
      updated = true;
    }
  }

  if (updated || !fs.existsSync(baselinePath)) {
    // the newline matters: without it every run shows a `\ No newline at end of file` diff on a file
    // that is otherwise unchanged
    fs.writeFileSync(baselinePath, `${JSON.stringify(newBaseline, null, 2)}\n`);
    console.log('quality-baseline.json updated!');
  } else {
    console.log('No ratchet improvements detected. Baseline remains unchanged.');
  }
}

updateBaseline();
