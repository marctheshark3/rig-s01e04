import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus, StatusCounts } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

export const readNight: ReadNight = (runsDir, night) => {
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  return digestLog(night, contents);
};

function digestLog(night: string, contents: string): NightDigest {
  const rows = new Map<string, DigestRow>();
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = parseEvent(line);
    if (!event) {
      badLines += 1;
      continue;
    }

    counts[event.status] += 1;
    const previous = rows.get(event.job);
    rows.set(event.job, {
      job: event.job,
      owner: event.owner,
      runs: (previous?.runs ?? 0) + 1,
      retries: (previous?.retries ?? 0) + Number(event.status === 'retry'),
      lastStatus: event.status,
      lastError: event.error ?? previous?.lastError ?? null,
      firstAt: previous?.firstAt ?? event.at,
      lastAt: event.at,
    });
  }

  return {
    night,
    rows: [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0),
    badLines,
    counts,
  };
}

function parseEvent(line: string): RunEvent | null {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  return isRunEvent(event) ? event : null;
}

function isRunEvent(event: unknown): event is RunEvent {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return false;
  return 'at' in event && typeof event.at === 'string'
    && 'job' in event && typeof event.job === 'string'
    && 'status' in event && (event.status === 'ok' || event.status === 'retry' || event.status === 'fail')
    && 'owner' in event && (typeof event.owner === 'string' || event.owner === null)
    && (!('error' in event) || typeof event.error === 'string');
}
