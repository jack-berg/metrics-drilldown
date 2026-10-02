import { BusEventWithPayload } from '@grafana/data';

import { type MetricFilters } from 'MetricsReducer/metrics-variables/MetricsVariableFilterEngine';

type EventFiltersChangedPayload =
  | { type: Exclude<keyof MetricFilters, 'semconvMetrics'>; filters: string[] }
  | { type: 'semconvMetrics'; filters: string[] | undefined };

export class EventFiltersChanged extends BusEventWithPayload<EventFiltersChangedPayload> {
  public static readonly type = 'filters-changed';
}
