// A small in-process job queue with retry and backoff for slow or retryable work (email, reports).
// For multiple server instances, swap this module for BullMQ + Redis; the enqueue() API stays the same.
import { logger } from '../utils/logger.js';

const handlers = new Map();
const pending = [];
let timer = null;
let running = false;

/** Registers the function that processes jobs with this name. */
export function registerHandler(name, handler) {
  handlers.set(name, handler);
}

/** Adds a job. Returns immediately; processing happens in the background. */
export function enqueue(name, payload, { attempts = 3, backoffMs = 2000, delayMs = 0 } = {}) {
  pending.push({ name, payload, attempts, backoffMs, tries: 0, runAt: Date.now() + delayMs });
  if (timer) tick();
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const due = pending.filter((job) => job.runAt <= now);
    for (const job of due) {
      pending.splice(pending.indexOf(job), 1);
      const handler = handlers.get(job.name);
      if (!handler) {
        logger.warn('No handler for job', { name: job.name });
        continue;
      }
      try {
        await handler(job.payload);
      } catch (err) {
        job.tries += 1;
        if (job.tries < job.attempts) {
          job.runAt = Date.now() + job.backoffMs * 2 ** (job.tries - 1);
          pending.push(job);
          logger.warn('Job failed, will retry', { name: job.name, tries: job.tries, message: err.message });
        } else {
          logger.error('Job failed permanently', { name: job.name, message: err.message });
        }
      }
    }
  } finally {
    running = false;
  }
}

const recurring = [];

/** Runs `fn` every `ms` milliseconds (errors are logged, never thrown). Stops with stopJobs(). */
export function scheduleEvery(name, ms, fn) {
  const handle = setInterval(async () => {
    try {
      await fn();
    } catch (err) {
      logger.warn('Recurring job failed', { name, message: err.message });
    }
  }, ms);
  handle.unref?.();
  recurring.push(handle);
}

export function startJobs(intervalMs = 1000) {
  if (timer) return;
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  timer = null;
  while (recurring.length) clearInterval(recurring.pop());
}

/** Test helper: run every due job now. */
export async function drainJobs() {
  await tick();
}
