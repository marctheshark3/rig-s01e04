import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow, NightDigest } from '../src/digest/types.js';

const baseConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: 'runs',
};

let runsDir: string;

function writeNight(night: string, contents: string): void {
  writeFileSync(join(runsDir, `${night}.jsonl`), contents);
}

function app() {
  return createApp({ ...baseConfig, runsDir });
}

function htmlRows(html: string): Array<{ cells: string[]; warned: boolean }> {
  return [...html.matchAll(/<tr\b([^>]*)>(.*?)<\/tr>/gs)]
    .map(([, attributes, body]) => ({
      cells: [...body.matchAll(/<td\b[^>]*>(.*?)<\/td>/gs)].map(([, cell]) =>
        cell.replace(/<[^>]+>/g, '').replace(/&mdash;/g, '—').trim(),
      ),
      warned: /\bwarn\b/.test(`${attributes} ${body}`),
    }))
    .filter(({ cells }) => cells.length > 0);
}

const expectedRows: DigestRow[] = [
  {
    job: 'alpha',
    owner: null,
    runs: 2,
    retries: 0,
    lastStatus: 'ok',
    lastError: 'upstream 503',
    firstAt: '2026-10-28T23:50:00-04:00',
    lastAt: '2026-10-28T23:55:00-04:00',
  },
  {
    job: 'beta',
    owner: 'owner-b',
    runs: 2,
    retries: 2,
    lastStatus: 'retry',
    lastError: 'lock held',
    firstAt: '2026-10-28T23:10:00-04:00',
    lastAt: '2026-10-28T23:11:00-04:00',
  },
  {
    job: 'delta',
    owner: 'owner-d',
    runs: 1,
    retries: 0,
    lastStatus: 'fail',
    lastError: 'disk full',
    firstAt: '2026-10-28T23:40:00-04:00',
    lastAt: '2026-10-28T23:40:00-04:00',
  },
  {
    job: 'gamma',
    owner: 'owner-g',
    runs: 4,
    retries: 3,
    lastStatus: 'ok',
    lastError: 'busy',
    firstAt: '2026-10-28T23:20:00-04:00',
    lastAt: '2026-10-28T23:23:00-04:00',
  },
];

const fixture = [
  '{"at":"2026-10-28T23:50:00-04:00","job":"alpha","status":"fail","owner":"owner-a","error":"upstream 503"}',
  '{"at":"2026-10-28T23:55:00-04:00","job":"alpha","status":"ok","owner":null}',
  '{"at":"2026-10-28T23:10:00-04:00","job":"beta","status":"retry","owner":"owner-b","error":"lock held"}',
  '{"at":"2026-10-28T23:11:00-04:00","job":"beta","status":"retry","owner":"owner-b","error":"lock held"}',
  '{"at":"2026-10-28T23:40:00-04:00","job":"delta","status":"fail","owner":"owner-d","error":"disk full"}',
  '{"at":"2026-10-28T23:20:00-04:00","job":"gamma","status":"retry","owner":"owner-g","error":"busy"}',
  '{"at":"2026-10-28T23:21:00-04:00","job":"gamma","status":"retry","owner":"owner-g","error":"busy"}',
  '{"at":"2026-10-28T23:22:00-04:00","job":"gamma","status":"retry","owner":"owner-g","error":"busy"}',
  '{"at":"2026-10-28T23:23:00-04:00","job":"gamma","status":"ok","owner":"owner-g"}',
  '{invalid json',
  '{"at":"2026-10-28T23:59:00-04:00","job":"bad-schema","status":"ok","owner":7}',
].join('\n');

describe('digest routes', () => {
  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('serves matching HTML and JSON rows from the injected runs directory', async () => {
    writeNight('2026-10-28', fixture);

    const [htmlResponse, jsonResponse] = await Promise.all([
      app().request('/digest/2026-10-28'),
      app().request('/api/digest/2026-10-28'),
    ]);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const html = await htmlResponse.text();
    const digest = (await jsonResponse.json()) as NightDigest;

    expect(digest).toEqual({
      night: '2026-10-28',
      rows: expectedRows,
      badLines: 2,
      counts: { ok: 2, retry: 5, fail: 2 },
    });

    const rows = htmlRows(html);
    expect(rows.map(({ cells }) => cells)).toEqual([
      ['alpha', '—', '2', '0', 'ok', 'upstream 503', expectedRows[0].firstAt, expectedRows[0].lastAt],
      ['beta', 'owner-b', '2', '2', 'retry', 'lock held', expectedRows[1].firstAt, expectedRows[1].lastAt],
      ['delta', 'owner-d', '1', '0', 'fail', 'disk full', expectedRows[2].firstAt, expectedRows[2].lastAt],
      ['gamma', 'owner-g', '4', '3', 'ok', 'busy', expectedRows[3].firstAt, expectedRows[3].lastAt],
    ]);
    expect(rows.map(({ warned }) => warned)).toEqual([false, false, true, true]);
  });

  it('returns 404 for missing nights in both formats', async () => {
    const [html, json] = await Promise.all([
      app().request('/digest/2026-10-30'),
      app().request('/api/digest/2026-10-30'),
    ]);

    expect(html.status).toBe(404);
    expect(json.status).toBe(404);
  });

  it('treats blank-only files as empty nights in HTML and JSON', async () => {
    writeNight('2026-10-29', ' \n\n  \n');

    const [htmlResponse, jsonResponse] = await Promise.all([
      app().request('/digest/2026-10-29'),
      app().request('/api/digest/2026-10-29'),
    ]);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const html = await htmlResponse.text();
    const digest = (await jsonResponse.json()) as NightDigest;

    expect(digest).toEqual({
      night: '2026-10-29',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
    expect(htmlRows(html)).toEqual([]);
  });

  it('reports all-invalid files as present nights with every bad line counted', async () => {
    writeNight('2026-10-30', '{not json}\n{"job":"missing-required-fields"}\n');

    const [htmlResponse, jsonResponse] = await Promise.all([
      app().request('/digest/2026-10-30'),
      app().request('/api/digest/2026-10-30'),
    ]);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const html = await htmlResponse.text();
    const digest = (await jsonResponse.json()) as NightDigest;

    expect(digest).toEqual({
      night: '2026-10-30',
      rows: [],
      badLines: 2,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
    expect(htmlRows(html)).toEqual([]);
  });
});

describe('status board digest links', () => {
  it('links both supplied nights and shows their event counts', async () => {
    const response = await createApp(baseConfig).request('/');
    const html = (await response.text()).replace(/\s+/g, ' ');

    expect(response.status).toBe(200);
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('href="/digest/2026-10-27"');
    expect(html).toMatch(/10 ok \/ 4 retry \/ 1 fail/);
    expect(html).toMatch(/7 ok \/ 0 retry \/ 0 fail/);
  });
});
