#!/usr/bin/env node
/** Watch the live Playwright reporter's file and annotate tests running past a limit. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const escapeData = value => stripVTControlCharacters(String(value)).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = value => escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** Produce one annotation per running test attempt, without trusting titles or file paths. */
export function longRunningAnnotations(report, now, limitMs, announced, root = process.cwd()) {
  const annotations = [];
  for (const item of Array.isArray(report?.active) ? report.active : []) {
    if (!item || typeof item.id !== 'string' || typeof item.startedAt !== 'number' || !Number.isFinite(item.startedAt) || typeof item.title !== 'string') continue;
    const key = `${item.id}:${item.startedAt}`;
    const duration = now - item.startedAt;
    if (duration < limitMs || announced.has(key)) continue;
    announced.add(key);
    const relative = typeof item.file === 'string' ? path.relative(root, path.resolve(root, item.file)) : '';
    const file = relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
      ? ` file=${escapeProperty(relative.replaceAll(path.sep, '/'))},` : ' ';
    annotations.push(`::error${file}title=Long-running browser test::${escapeData(item.title)} has been running for ${Math.round(duration / 60_000)} minutes`);
  }
  return annotations;
}

export function readLive(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.cwd();
  const requested = path.resolve(root, process.env.WATCH_REPORT || 'test-results/playwright-live.json');
  const limit = Number(process.env.WATCH_LIMIT_MINUTES ?? 8);
  const interval = Number(process.env.WATCH_INTERVAL_MS ?? 30_000);
  if (!requested.startsWith(root + path.sep) || !Number.isFinite(limit) || limit < 0 || !Number.isFinite(interval) || interval < 10) {
    console.log('::warning::Invalid live browser watcher configuration; the watcher is off.');
  } else {
    const announced = new Set();
    // Keep the process alive until the parent explicitly stops it.
    setInterval(() => {
      for (const annotation of longRunningAnnotations(readLive(requested), Date.now(), limit * 60_000, announced, root)) console.log(annotation);
    }, interval);
  }
}
