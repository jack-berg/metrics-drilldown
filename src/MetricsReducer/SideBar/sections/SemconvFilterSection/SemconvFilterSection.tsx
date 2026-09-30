import { css } from '@emotion/css';
import React from 'react';

import { type GrafanaTheme2 } from '@grafana/data';
import { t, Trans } from '@grafana/i18n';
import {
  sceneGraph,
  SceneObjectBase,
  SceneObjectUrlSyncConfig,
  VariableDependencyConfig,
  type MultiValueVariable,
  type SceneComponentProps,
  type SceneObjectUrlValues,
} from '@grafana/scenes';
import { Button, Checkbox, LoadingPlaceholder, useStyles2 } from '@grafana/ui';

import {
  MetricsVariable,
  VAR_METRICS_VARIABLE,
  type MetricOptions,
} from 'MetricsReducer/metrics-variables/MetricsVariable';
import { getDefaultSemconvSession, type SemconvMetric } from '@grafana/otel-semconv-client';

import { EventSectionValueChanged } from '../EventSectionValueChanged';
import { EventFiltersChanged } from '../MetricsFilterSection/EventFiltersChanged';
import { SectionTitle } from '../SectionTitle';
import { type SideBarSectionState } from '../types';

export const SEMCONV_SECTION_KEY = 'filters-semconv';
export const NOT_IN_SEMCONV_VALUE = '__not_in_semconv__';

interface SemconvGroup {
  label: string;
  value: string;
  count: number;
}

interface SemconvFilterSectionState extends SideBarSectionState {
  groups: SemconvGroup[];
  selectedNamespaces: string[];
  loading: boolean;
  /** Raw prom metric name -> canonical namespace (or null if unknown). */
  bucketMap: Map<string, string | null>;
}

/** Filters the metric list by OpenTelemetry semantic-convention namespace. */
export class SemconvFilterSection extends SceneObjectBase<SemconvFilterSectionState> {
  protected _urlSync = new SceneObjectUrlSyncConfig(this, { keys: [SEMCONV_SECTION_KEY] });

  protected _variableDependency = new VariableDependencyConfig(this, {
    variableNames: [VAR_METRICS_VARIABLE],
    onReferencedVariableValueChanged: (variable) => {
      const { name, options } = (variable as MultiValueVariable).state;
      if (name === VAR_METRICS_VARIABLE) {
        this.recomputeGroups(options as MetricOptions);
      }
    },
  });

  getUrlState() {
    return { [SEMCONV_SECTION_KEY]: this.state.selectedNamespaces.join(',') };
  }

  updateFromUrl(values: SceneObjectUrlValues) {
    const raw = values[SEMCONV_SECTION_KEY];
    if (typeof raw !== 'string') {
      return;
    }
    const next = raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (next.join(',') !== this.state.selectedNamespaces.join(',')) {
      this.setState({ selectedNamespaces: next });
      this.emitFilter(next);
    }
  }

  constructor({
    title,
    description,
    icon,
    active,
    disabled,
  }: {
    title: SideBarSectionState['title'];
    description: SideBarSectionState['description'];
    icon: SideBarSectionState['icon'];
    active?: SideBarSectionState['active'];
    disabled?: SideBarSectionState['disabled'];
  }) {
    super({
      active: active ?? false,
      bucketMap: new Map<string, string | null>(),
      description,
      disabled: disabled ?? false,
      groups: [],
      icon,
      key: SEMCONV_SECTION_KEY,
      loading: true,
      selectedNamespaces: [],
      title,
    });

    this.addActivationHandler(this.onActivate.bind(this));
  }

  private onActivate() {
    const metricsVar = sceneGraph.findByKeyAndType(this, VAR_METRICS_VARIABLE, MetricsVariable);
    this.recomputeGroups(metricsVar.state.options as MetricOptions);
  }

  /**
   * Fetch semconv namespace for every metric we haven't classified yet.
   * Uses the shared session so tooltips and other consumers coalesce into
   * the same POST /lookup.
   */
  private async ensureBucketsFor(options: MetricOptions): Promise<Map<string, string | null>> {
    const session = getDefaultSemconvSession();
    if (!session) {
      return this.state.bucketMap;
    }
    const missing: string[] = [];
    for (const opt of options) {
      const name = opt.value as string;
      if (!this.state.bucketMap.has(name)) {
        missing.push(name);
      }
    }
    if (missing.length === 0) {
      return this.state.bucketMap;
    }
    const results = await session.getMany<SemconvMetric>({
      kind: 'metric',
      keys: missing,
      signal: { metrics: 'prometheus' },
      fields: ['namespace'],
    });
    const next = new Map(this.state.bucketMap);
    for (const name of missing) {
      const entry = results.get(name);
      next.set(name, entry?.namespace ?? null);
    }
    return next;
  }

  private async recomputeGroups(options: MetricOptions) {
    const bucketMap = await this.ensureBucketsFor(options);
    const counts = new Map<string, number>();
    for (const opt of options) {
      const bucket = bucketFor(opt.value as string, bucketMap);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    const groups = Array.from(counts.entries())
      .map(([value, count]) => ({ count, label: labelFor(value), value }))
      // Not-in-semconv sinks to bottom, then by count desc, then alpha.
      .sort((a, b) => {
        if (a.value === NOT_IN_SEMCONV_VALUE) {
          return 1;
        }
        if (b.value === NOT_IN_SEMCONV_VALUE) {
          return -1;
        }
        if (a.count !== b.count) {
          return b.count - a.count;
        }
        return a.value.localeCompare(b.value);
      });
    this.setState({ bucketMap, groups, loading: false });
    // Re-emit any URL-restored selection now that the bucket map is
    // loaded. Empty selection = no filter, consistent with prefix/suffix
    // filter sections.
    if (this.state.selectedNamespaces.length > 0) {
      this.emitFilter(this.state.selectedNamespaces);
    }
  }

  private emitFilter(selectedNamespaces: string[]) {
    const { bucketMap } = this.state;
    const metricsVar = sceneGraph.findByKeyAndType(this, VAR_METRICS_VARIABLE, MetricsVariable);
    const allOptions = metricsVar.state.options as MetricOptions;
    const selectedSet = new Set(selectedNamespaces);

    // Empty selection = no filter (show all), matching prefix/suffix
    // filter semantics.
    const matched: string[] = [];
    if (selectedNamespaces.length > 0) {
      for (const opt of allOptions) {
        const bucket = bucketFor(opt.value as string, bucketMap);
        if (selectedSet.has(bucket)) {
          matched.push(opt.value as string);
        }
      }
    }

    this.setState({ active: selectedNamespaces.length > 0 });

    this.publishEvent(
      new EventSectionValueChanged({ key: SEMCONV_SECTION_KEY, values: selectedNamespaces }),
      true
    );
    this.publishEvent(new EventFiltersChanged({ filters: matched, type: 'semconvMetrics' }), true);
  }

  public onToggle = (value: string) => {
    const set = new Set(this.state.selectedNamespaces);
    if (set.has(value)) {
      set.delete(value);
    } else {
      set.add(value);
    }
    const next = Array.from(set);
    this.setState({ selectedNamespaces: next });
    this.emitFilter(next);
  };

  public onSelectAll = () => {
    const next = this.state.groups.map((g) => g.value);
    this.setState({ selectedNamespaces: next });
    this.emitFilter(next);
  };

  public onClear = () => {
    this.setState({ selectedNamespaces: [] });
    this.emitFilter([]);
  };

  public static readonly Component = SemconvFilterSectionRenderer;
}

function SemconvFilterSectionRenderer({ model }: SceneComponentProps<SemconvFilterSection>) {
  const styles = useStyles2(getStyles);
  const { title, description, groups, selectedNamespaces, loading } = model.useState();
  const selected = new Set(selectedNamespaces);

  return (
    <div className={styles.container} data-testid="semconv-filter-section">
      <SectionTitle title={title} description={description} />

      <div className={styles.toolbar}>
        <Button size="sm" variant="secondary" fill="text" onClick={model.onSelectAll} disabled={loading}>
          <Trans i18nKey="sidebar.semconv.select-all">Select all</Trans>
        </Button>
        <Button size="sm" variant="secondary" fill="text" onClick={model.onClear} disabled={loading}>
          <Trans i18nKey="sidebar.semconv.clear">Clear</Trans>
        </Button>
      </div>

      <div className={styles.list}>
        {loading && (
          <LoadingPlaceholder text={t('sidebar.semconv.loading', 'Loading semconv…')} />
        )}
        {!loading && groups.length === 0 && (
          <div className={styles.empty}>
            <Trans i18nKey="sidebar.semconv.empty">No metrics to categorize.</Trans>
          </div>
        )}
        {!loading &&
          groups.map((g) => (
            <label key={g.value} className={styles.row}>
              <Checkbox value={selected.has(g.value)} onChange={() => model.onToggle(g.value)} />
              <span className={styles.rowLabel}>{g.label}</span>
              <span className={styles.rowCount}>{g.count}</span>
            </label>
          ))}
      </div>
    </div>
  );
}

function bucketFor(metricName: string, bucketMap: Map<string, string | null>): string {
  const ns = bucketMap.get(metricName);
  return ns ?? NOT_IN_SEMCONV_VALUE;
}

function labelFor(value: string): string {
  if (value === NOT_IN_SEMCONV_VALUE) {
    return 'Not in semconv';
  }
  return value;
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
      height: '100%',
      overflowY: 'hidden',
    }),
    empty: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      padding: theme.spacing(1),
    }),
    list: css({
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflowY: 'auto',
      padding: theme.spacing(0, 1, 1, 1),
    }),
    row: css({
      alignItems: 'center',
      cursor: 'pointer',
      display: 'flex',
      gap: theme.spacing(1),
      padding: theme.spacing(0.5, 0),
      '&:hover': { backgroundColor: theme.colors.action.hover },
    }),
    rowCount: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      marginLeft: 'auto',
    }),
    rowLabel: css({
      color: theme.colors.text.primary,
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }),
    toolbar: css({
      display: 'flex',
      gap: theme.spacing(0.5),
      padding: theme.spacing(0, 1),
    }),
  };
}
