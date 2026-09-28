import { VizPanel } from '@grafana/scenes';

import { fetchSemconvMetric } from './client';
import { toSemconvMetricKey } from './normalize';
import { buildSemconvMetricPanelDescription } from './panelDescription';

export function enrichPanelWithSemconvMetric(viz: VizPanel, rawMetricName: string | undefined): void {
  const key = toSemconvMetricKey(rawMetricName);
  if (!key) {
    return;
  }
  fetchSemconvMetric(key).then((metric) => {
    if (!metric) {
      return;
    }
    viz.setState({ description: buildSemconvMetricPanelDescription(metric) });
  });
}
