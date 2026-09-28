import { SemconvAttribute, SemconvMetric } from './types';

export function buildSemconvAttributePanelDescription(attr: SemconvAttribute): string {
  const lines: string[] = [];
  if (attr.brief) {
    lines.push(attr.brief);
  }
  const meta = [`**Stability:** ${attr.stability}`, `**Type:** ${attr.type}`];
  if (attr.examples?.length) {
    meta.push(`**Examples:** ${attr.examples.slice(0, 3).join(', ')}`);
  }
  lines.push('', meta.join(' · '), '', `_semconv: ${attr.name}_`);
  return lines.join('\n');
}

export function buildSemconvMetricPanelDescription(metric: SemconvMetric): string {
  const lines: string[] = [];
  if (metric.brief) {
    lines.push(metric.brief);
  }
  const meta = [`**Stability:** ${metric.stability}`, `**Instrument:** ${metric.instrument}`];
  if (metric.unit) {
    meta.push(`**Unit:** ${metric.unit}`);
  }
  lines.push('', meta.join(' · '), '', `_semconv: ${metric.name}_`);
  return lines.join('\n');
}
