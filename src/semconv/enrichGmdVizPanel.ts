import { GmdVizPanel } from '../shared/GmdVizPanel/GmdVizPanel';

import { fetchSemconvMetric } from './client';
import { toSemconvMetricKey } from './normalize';
import { buildSemconvMetricPanelDescription } from './panelDescription';

/** Fire-and-forget semconv lookup; on hit sets the GmdVizPanel description. */
export function enrichGmdVizPanelWithSemconv(panel: GmdVizPanel, rawMetricName: string | undefined): void {
  const key = toSemconvMetricKey(rawMetricName);
  if (!key) {
    return;
  }
  panel.addActivationHandler(() => {
    fetchSemconvMetric(key).then((metric) => {
      if (!metric) {
        return;
      }
      const body = panel.state.body;
      if (!body) {
        return;
      }
      body.setState({ description: buildSemconvMetricPanelDescription(metric) });
    });
  });
}
