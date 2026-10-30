import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-28T23:00:00+01:00',
  job: 'lane/sync',
  status: 'ok',
  owner: 'rook',
};
const oneRun: NightDigest = {
  night,
  rows: [{
    job: 'lane/sync', owner: 'rook', runs: 1, retries: 0,
    lastStatus: 'ok', lastError: null,
    firstAt: event.at, lastAt: event.at,
  }],
  badLines: 0,
  counts: { ok: 1, retry: 0, fail: 0 },
};

function eventLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...event, ...overrides });
}

describe('readNight', () => {
  let sandbox: string;
  let runsDir: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'rig-digest-reader-'));
    runsDir = join(sandbox, 'runs');
    mkdirSync(runsDir);
  });

  afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

  function writeNight(contents: string, name = night): void {
    writeFileSync(join(runsDir, `${name}.jsonl`), contents);
  }

  it('matches every row and valid-event count in the supplied fixture', () => {
    const fixtureDir = fileURLToPath(new URL('../runs/', import.meta.url));
    const digest = readNight(fixtureDir, night);

    expect(digest).toEqual({
      night,
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00',
          lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
          lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00',
          lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1,
          lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00',
          lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00',
          lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00',
          lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
    });
    expect(digest?.rows.reduce((total, row) => total + row.runs, 0)).toBe(15);
    expect(digest?.rows.reduce((total, row) => total + row.retries, 0)).toBe(4);
  });

  it.each([
    ['truncated JSON', '{"at":'],
    ['invalid JSON', 'not-json'],
    ['multiple records on one line', `${eventLine()} ${eventLine()}`],
    ['null', 'null'],
    ['array', JSON.stringify([event])],
    ['string', '"event"'],
    ['number', '42'],
    ['boolean', 'true'],
    ['empty object', '{}'],
    ['missing at', JSON.stringify({ job: 'lane/sync', status: 'ok', owner: null })],
    ['non-string at', eventLine({ at: 123 })],
    ['missing job', JSON.stringify({ at: event.at, status: 'ok', owner: null })],
    ['non-string job', eventLine({ job: null })],
    ['missing status', JSON.stringify({ at: event.at, job: 'lane/sync', owner: null })],
    ['unknown status', eventLine({ status: 'success' })],
    ['wrong-case status', eventLine({ status: 'OK' })],
    ['non-string status', eventLine({ status: null })],
    ['missing owner', JSON.stringify({ at: event.at, job: 'lane/sync', status: 'ok' })],
    ['number owner', eventLine({ owner: 0 })],
    ['boolean owner', eventLine({ owner: false })],
    ['object owner', eventLine({ owner: {} })],
    ['array owner', eventLine({ owner: [] })],
    ['null error', eventLine({ error: null })],
    ['number error', eventLine({ error: 0 })],
    ['boolean error', eventLine({ error: false })],
    ['object error', eventLine({ error: {} })],
    ['array error', eventLine({ error: [] })],
  ])('counts %s once, skips it, and continues with valid records', (_label, badLine) => {
    const lastAt = '2026-10-29T01:00:00-04:00';
    writeNight([
      eventLine({ status: 'retry', error: 'retained' }),
      badLine,
      eventLine({ at: lastAt, owner: null }),
    ].join('\n'));

    expect(readNight(runsDir, night)).toEqual({
      night,
      rows: [{
        job: 'lane/sync', owner: null, runs: 2, retries: 1,
        lastStatus: 'ok', lastError: 'retained',
        firstAt: event.at, lastAt,
      }],
      badLines: 1,
      counts: { ok: 1, retry: 1, fail: 0 },
    });
  });

  it.each([
    ['empty', ''],
    ['blank-only', '\n \r\n\t\n'],
  ])('returns an empty digest for an existing %s file', (_label, contents) => {
    writeNight(contents);
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('preserves the bad-line count when every nonblank line is invalid', () => {
    writeNight(`{\nnull\n\t\n${eventLine({ error: null })}\n`);
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 3, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each([
    ['no terminal newline', ''],
    ['terminal LF', '\n'],
    ['terminal CRLF', '\r\n'],
    ['multiple terminal newlines', '\n\n'],
  ])('ignores blank lines and accepts %s', (_label, ending) => {
    writeNight(` \r\n\t\n  ${eventLine()} \t${ending}`);
    expect(readNight(runsDir, night)).toEqual(oneRun);
  });

  it('accepts string fields verbatim and ignores extra properties', () => {
    writeNight(eventLine({
      at: 'not a date', job: '', owner: '', error: '',
      runs: 99, retries: 99, extra: { ignored: true },
    }));
    expect(readNight(runsDir, night)).toEqual({
      night,
      rows: [{
        job: '', owner: '', runs: 1, retries: 0,
        lastStatus: 'ok', lastError: '', firstAt: 'not a date', lastAt: 'not a date',
      }],
      badLines: 0,
      counts: { ok: 1, retry: 0, fail: 0 },
    });
  });

  it.each([
    { owners: ['rook', 'tern'], finalOwner: 'tern' },
    { owners: ['rook', null], finalOwner: null },
    { owners: [null, 'rook'], finalOwner: 'rook' },
  ])('uses the final owner for $owners, including null', ({ owners, finalOwner }) => {
    writeNight(owners.map((owner) => eventLine({ owner })).join('\n'));
    expect(readNight(runsDir, night)).toEqual({
      ...oneRun,
      rows: [{ ...oneRun.rows[0], owner: finalOwner, runs: 2 }],
      counts: { ok: 2, retry: 0, fail: 0 },
    });
  });

  it('uses file order for first/last timestamps and final status, preserving offsets', () => {
    writeNight([
      eventLine({ at: '2026-10-29T06:00:00+01:00' }),
      eventLine({ at: '2026-10-29T04:00:00+01:00', status: 'retry' }),
      eventLine({ at: '2026-10-28T22:00:00-04:00', status: 'fail', error: 'last in file' }),
    ].join('\r\n'));
    expect(readNight(runsDir, night)).toEqual({
      night,
      rows: [{
        job: 'lane/sync', owner: 'rook', runs: 3, retries: 1,
        lastStatus: 'fail', lastError: 'last in file',
        firstAt: '2026-10-29T06:00:00+01:00', lastAt: '2026-10-28T22:00:00-04:00',
      }],
      badLines: 0,
      counts: { ok: 1, retry: 1, fail: 1 },
    });
  });

  it.each(['replacement', ''])('retains the latest supplied error %j through recovery', (error) => {
    writeNight([
      eventLine({ status: 'retry', error: 'original' }),
      eventLine({ status: 'fail', error }),
      eventLine(),
    ].join('\n'));
    expect(readNight(runsDir, night)).toEqual({
      ...oneRun,
      rows: [{ ...oneRun.rows[0], runs: 3, retries: 1, lastError: error }],
      counts: { ok: 1, retry: 1, fail: 1 },
    });
  });

  it('sorts jobs consistently and handles names that resemble object properties', () => {
    const jobs = ['z', 'constructor', 'a', '__proto__', 'A', 'a/child'];
    writeNight(jobs.map((job) => eventLine({ job })).join('\n'));
    expect(readNight(runsDir, night)).toEqual({
      ...oneRun,
      rows: ['A', '__proto__', 'a', 'a/child', 'constructor', 'z'].map((job) => ({
        ...oneRun.rows[0], job,
      })),
      counts: { ok: 6, retry: 0, fail: 0 },
    });
  });

  it('validates the night format without imposing calendar validation', () => {
    writeNight(eventLine(), '2026-99-99');
    expect(readNight(runsDir, '2026-99-99')).toEqual({ ...oneRun, night: '2026-99-99' });
  });

  it('returns null for a missing file', () => {
    expect(readNight(runsDir, night)).toBeNull();
  });

  it('returns null when the runs directory is missing', () => {
    expect(readNight(join(sandbox, 'missing'), night)).toBeNull();
  });

  it.each([
    '', '2026-1-28', '2026-10-2', '26-10-28', '20261028', '2026-10-280',
    '2026-10-28.jsonl', '2026-10-28\n', '2026-10-28\r', '2026-10-28\r\n',
    '2026-10-28 ', ' 2026-10-28', '../2026-10-28', '..\\2026-10-28',
    'nested/2026-10-28', 'nested\\2026-10-28', '2026-10-28/..',
    '2026-10-28\0', '２０２６-１０-２８',
  ])('rejects invalid night %j before reading the filesystem', (invalidNight) => {
    const notDirectory = join(sandbox, 'not-a-directory');
    writeFileSync(notDirectory, '');
    expect(readNight(notDirectory, invalidNight)).toBeNull();
  });

  it('rejects traversal and absolute names even when the outside file exists', () => {
    writeFileSync(join(sandbox, `${night}.jsonl`), eventLine());
    expect(readNight(runsDir, `../${night}`)).toBeNull();
    expect(readNight(runsDir, join(sandbox, night))).toBeNull();
  });

  it('propagates an attempt to read a directory as a log', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrowError(expect.objectContaining({ code: 'EISDIR' }));
  });

  it('propagates non-ENOENT failures resolving the runs directory', () => {
    const notDirectory = join(sandbox, 'not-a-directory');
    writeFileSync(notDirectory, '');
    expect(() => readNight(notDirectory, night)).toThrowError(expect.objectContaining({ code: 'ENOTDIR' }));
  });
});
