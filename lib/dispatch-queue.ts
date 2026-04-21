import os from "os";

export interface QueueJob {
  id: string;
  dispatch: () => Promise<void> | void;
}

export interface QueueSize {
  running: number;
  pending: number;
}

const GB = 1024 * 1024 * 1024;

/**
 * Choose a safe default concurrency cap based on host memory.
 * - <16GB: 1 (safe for laptops — a single Claude CLI can use 1–2GB)
 * - 16–48GB: 2
 * - ≥48GB: 4
 * Override with CASCADE_MAX_CONCURRENT_SUBAGENTS=<int>; values <1 or non-numeric are ignored.
 */
export function detectDefaultConcurrency(): number {
  const raw = process.env.CASCADE_MAX_CONCURRENT_SUBAGENTS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  const total = os.totalmem();
  if (total < 16 * GB) return 1;
  if (total < 48 * GB) return 2;
  return 4;
}

/**
 * Process-wide concurrency gate for Claude CLI subagent dispatches.
 * Holds a slot from the moment dispatch() is called until release(id) fires.
 * Excess jobs wait in FIFO until slots free.
 */
export class DispatchQueue {
  private readonly cap: number;
  private readonly running = new Set<string>();
  private readonly pending: QueueJob[] = [];

  constructor(cap: number) {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new Error(`DispatchQueue cap must be a positive integer, got ${cap}`);
    }
    this.cap = cap;
  }

  async enqueue(job: QueueJob): Promise<void> {
    if (this.running.size < this.cap) {
      this.running.add(job.id);
      try {
        await job.dispatch();
      } catch (err) {
        this.running.delete(job.id);
        this.drain();
        throw err;
      }
    } else {
      this.pending.push(job);
    }
  }

  release(jobId: string): void {
    if (!this.running.has(jobId)) return;
    this.running.delete(jobId);
    this.drain();
  }

  size(): QueueSize {
    return { running: this.running.size, pending: this.pending.length };
  }

  private drain(): void {
    while (this.running.size < this.cap && this.pending.length > 0) {
      const next = this.pending.shift()!;
      this.running.add(next.id);
      Promise.resolve()
        .then(() => next.dispatch())
        .catch(() => {
          this.running.delete(next.id);
          this.drain();
        });
    }
  }
}

let singleton: DispatchQueue | null = null;

export function getDispatchQueue(): DispatchQueue {
  if (!singleton) {
    singleton = new DispatchQueue(detectDefaultConcurrency());
  }
  return singleton;
}

/**
 * Reset the singleton — for tests only.
 */
export function __resetDispatchQueueForTests(): void {
  singleton = null;
}
