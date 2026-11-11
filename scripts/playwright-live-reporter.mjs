/** Tiny live-only reporter for watch-hung-tests; Playwright's JSON reporter writes at onEnd. */
import fs from 'node:fs';
import path from 'node:path';

export default class LiveReporter {
  constructor() {
    const root = process.cwd();
    const requested = path.resolve(root, process.env.WATCH_REPORT || 'test-results/playwright-live.json');
    this.file = requested.startsWith(root + path.sep) ? requested : null;
    this.active = new Map();
  }

  printsToStdio() { return false; }

  write() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ active: [...this.active.values()] }));
      fs.renameSync(temp, this.file);
    } catch (error) {
      // Diagnostics must never hide or change Playwright's actual result.
      console.error('Live browser diagnostics unavailable:', error instanceof Error ? error.message : String(error));
    }
  }

  onBegin() { this.write(); }
  onTestBegin(test) {
    this.active.set(test.id, { id: test.id, title: test.titlePath().join(' › '), file: test.location.file, startedAt: Date.now() });
    this.write();
  }
  onTestEnd(test) { this.active.delete(test.id); this.write(); }
  onEnd() { this.active.clear(); this.write(); }
}
