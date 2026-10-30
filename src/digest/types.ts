export type RunStatus = 'ok' | 'retry' | 'fail';

/** Counts of valid events across all jobs, including events before recovery. */
export type StatusCounts = Record<RunStatus, number>;

/** One row per job, aggregating valid events in file order. */
export type DigestRow = {
  job: string;
  /** Owner from the final valid event, including null. */
  owner: string | null;
  /** Every valid event is one run, including retries and failures. */
  runs: number;
  /** The subset of runs whose status is retry. */
  retries: number;
  lastStatus: RunStatus;
  /** Most recently supplied error; recovery does not clear it. Null if none. */
  lastError: string | null;
  /** First valid event's at string in file order, not chronological order. */
  firstAt: string;
  /** Final valid event's at string; that event also supplies lastStatus. */
  lastAt: string;
};

/**
 * The success body of GET /api/digest/:night is this object, without a wrapper.
 * Existing empty or blank-only files yield rows: [], badLines: 0 and zero counts.
 * All-invalid files also yield rows: [] and zero counts, with badLines recording
 * every nonblank invalid line. Neither case is a missing night.
 *
 * Immutable 2026-10-28 oracle: 5 rows, 1 bad line, counts 10 ok / 4 retry / 1 fail.
 * Recovered fixtures/refresh and lane/sync retain upstream 503 and lock held.
 */
export type NightDigest = {
  night: string;
  /** Sorted ascending by job. */
  rows: DigestRow[];
  /** Nonblank lines containing invalid JSON or an invalid event schema. */
  badLines: number;
  counts: StatusCounts;
};

/**
 * Synchronous contract for the named readNight export in src/digest/read-night.ts.
 * This module supplies types only; the reader implementation lives there.
 *
 * Accept night names matching /^\d{4}-\d{2}-\d{2}$/ and read runsDir/<night>.jsonl.
 * Names must keep the file inside runsDir; path separators and traversal are invalid.
 * Invalid names or missing files (ENOENT) return null (routes respond with 404).
 * Other I/O errors propagate.
 *
 * A valid event is a JSON object with string at and job, a RunStatus status,
 * required owner (string or null), and optional string error. Extra fields are
 * ignored. Invalid JSON or event schemas increment badLines and are skipped;
 * blank or whitespace-only lines are ignored. Only valid events affect rows
 * and counts. Preserve timestamp strings and their offsets exactly as logged.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
