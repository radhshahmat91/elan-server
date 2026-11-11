// Job registration. Every file in this folder named *.jobs.js is loaded at startup and must default-export
//   async function register({ enqueue, registerHandler, scheduleEvery }) { ... }
// Use it to register queue handlers (email) and recurring sweeps (expire unpaid orders, release stale holds).
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { enqueue, registerHandler, scheduleEvery } from './queue.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function registerJobFiles() {
  const files = readdirSync(here).filter((f) => f.endsWith('.jobs.js'));
  for (const file of files) {
    const mod = await import(pathToFileURL(join(here, file)).href);
    if (typeof mod.default !== 'function') throw new Error(`${file} must default-export a register function.`);
    await mod.default({ enqueue, registerHandler, scheduleEvery });
  }
  return files;
}
