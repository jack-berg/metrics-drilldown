/**
 * Reverse the prom-side transformations (`_` for `.`, unit/aggregation
 * suffix) to reach a semconv canonical name. Best-effort heuristic; suffix
 * list isn't exhaustive and blind `_` → `.` misses names with real
 * underscores in a segment. See scratch/followups.md.
 */
const UNIT_SUFFIXES = [
  '_seconds',
  '_milliseconds',
  '_microseconds',
  '_nanoseconds',
  '_bytes',
  '_ratio',
  '_percent',
  '_total',
  '_count',
  '_info',
  '_bucket',
  '_sum',
];

export function toSemconvMetricKey(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  let stripped = name;
  // Histogram/summary series stack suffixes (`_seconds_count`); iterate.
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of UNIT_SUFFIXES) {
      if (stripped.endsWith(suffix) && stripped.length > suffix.length) {
        stripped = stripped.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  return stripped.includes('.') ? stripped : stripped.replace(/_/g, '.');
}

export function toSemconvAttributeKey(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  return name.includes('.') ? name : name.replace(/_/g, '.');
}
