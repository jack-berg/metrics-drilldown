import { css } from '@emotion/css';
import { type GrafanaTheme2 } from '@grafana/data';
import { t, Trans } from '@grafana/i18n';
import {
  getDefaultSemconvSession,
  registryDefinitionPath,
  SEMCONV_METRIC_FAMILY_PARAM,
  type SemconvMetric,
} from '@grafana/otel-semconv-client';
import { config } from '@grafana/runtime';
import {
  sceneGraph,
  SceneObjectBase,
  SceneObjectUrlSyncConfig,
  type SceneComponentProps,
  type SceneObjectUrlValues,
} from '@grafana/scenes';
import { Button, Checkbox, Icon, Input, LoadingPlaceholder, useStyles2 } from '@grafana/ui';
import React, { useEffect, useId, useRef } from 'react';

import {
  VAR_METRICS_VARIABLE,
  type MetricOptions,
  type MetricsVariable,
} from 'MetricsReducer/metrics-variables/MetricsVariable';

import { EventSectionValueChanged } from '../EventSectionValueChanged';
import { EventFiltersChanged } from '../MetricsFilterSection/EventFiltersChanged';
import { SectionTitle } from '../SectionTitle';
import { type SideBarSectionState } from '../types';

export const SEMCONV_SECTION_KEY = 'filters-semconv';
export const NOT_IN_SEMCONV_VALUE = '__not_in_semconv__';
export const SEMCONV_UNMATCHED_PARAM = 'semconvUnmatched';

export function unmatchedMetricLabel() {
  return t('sidebar.semconv.no-registry-match', 'No registry match');
}

type MetricIdentity = Pick<SemconvMetric, 'name' | 'namespace'>;

interface SemconvFilterSectionState extends SideBarSectionState {
  families: string[];
  selectedFamilies: string[];
  includeUnmatched: boolean;
  selectedNamespaces: string[];
  search: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  options: MetricOptions;
  bucketMap: Map<string, MetricIdentity[]>;
}

export class SemconvFilterSection extends SceneObjectBase<SemconvFilterSectionState> {
  protected _urlSync = new SceneObjectUrlSyncConfig(this, {
    keys: [SEMCONV_SECTION_KEY, SEMCONV_METRIC_FAMILY_PARAM, SEMCONV_UNMATCHED_PARAM],
  });
  private generation = 0;
  private requested = false;
  private inFlight?: { options: MetricOptions; promise: Promise<void> };

  constructor({
    title,
    description,
    icon,
    active,
    disabled,
    selectedFamilies = [],
    includeUnmatched = false,
    selectedNamespaces = [],
  }: Pick<SideBarSectionState, 'title' | 'description' | 'icon'> & {
    active?: boolean;
    disabled?: boolean;
    selectedFamilies?: string[];
    includeUnmatched?: boolean;
    selectedNamespaces?: string[];
  }) {
    super({
      active: active ?? (selectedFamilies.length > 0 || includeUnmatched || selectedNamespaces.length > 0),
      disabled: disabled ?? false,
      description,
      icon,
      title,
      key: SEMCONV_SECTION_KEY,
      families: [],
      selectedFamilies: [...selectedFamilies],
      includeUnmatched,
      selectedNamespaces: [...selectedNamespaces],
      search: '',
      status: 'idle',
      options: [],
      bucketMap: new Map(),
    });
    this.addActivationHandler(() => {
      const variable = sceneGraph.lookupVariable(VAR_METRICS_VARIABLE, this) as MetricsVariable | undefined;
      if (variable) {
        this._subs.add(
          variable.subscribeToState((next, previous) => {
            if (next.options !== previous.options || next.loading !== previous.loading) {
              void this.refresh();
            }
          })
        );
      }
      this.emitFilter(this.state.selectedFamilies.length > 0 || this.state.includeUnmatched);
      void this.refresh();
      return () => {
        this.generation++;
        this.inFlight = undefined;
      };
    });
  }

  getUrlState() {
    return {
      [SEMCONV_SECTION_KEY]: this.state.selectedNamespaces.join(','),
      [SEMCONV_METRIC_FAMILY_PARAM]: this.state.selectedFamilies,
      [SEMCONV_UNMATCHED_PARAM]: this.state.includeUnmatched ? 'true' : '',
    };
  }

  updateFromUrl(values: SceneObjectUrlValues) {
    const raw = values[SEMCONV_METRIC_FAMILY_PARAM];
    let familyValues: string[] = [];
    if (typeof raw === 'string') {
      familyValues = [raw];
    } else if (Array.isArray(raw)) {
      familyValues = raw;
    }
    const selectedFamilies = [...new Set(familyValues.filter(Boolean))];
    const includeUnmatched = values[SEMCONV_UNMATCHED_PARAM] === 'true';
    const legacy = values[SEMCONV_SECTION_KEY];
    const selectedNamespaces =
      typeof legacy === 'string'
        ? legacy
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
    if (
      JSON.stringify(selectedFamilies) === JSON.stringify(this.state.selectedFamilies) &&
      includeUnmatched === this.state.includeUnmatched &&
      JSON.stringify(selectedNamespaces) === JSON.stringify(this.state.selectedNamespaces)
    ) {
      return;
    }
    this.setState({ selectedFamilies, includeUnmatched, selectedNamespaces, search: '' });
    this.emitFilter(selectedFamilies.length > 0 || includeUnmatched);
    if (this.isActive) {
      void this.refresh();
    }
  }

  public getFilter(options: MetricOptions = this.state.options): string[] | undefined {
    const { selectedFamilies, includeUnmatched, selectedNamespaces, bucketMap, status } = this.state;
    if (!selectedFamilies.length && !includeUnmatched && !selectedNamespaces.length) {
      return undefined;
    }
    if (status !== 'ready' || options.some((option) => !bucketMap.has(option.value))) {
      return [];
    }
    const families = new Set(selectedFamilies);
    const restrictFamilies = families.size > 0 || includeUnmatched;
    const namespaces = new Set(selectedNamespaces);
    return options
      .filter((option) => {
        const entries = bucketMap.get(option.value)!;
        if (!entries.length) {
          return (!restrictFamilies || includeUnmatched) && (!namespaces.size || namespaces.has(NOT_IN_SEMCONV_VALUE));
        }
        return entries.some(
          (entry) =>
            (!restrictFamilies || families.has(entry.name)) &&
            (!namespaces.size || namespaces.has(entry.namespace ?? entry.name.split('.')[0]))
        );
      })
      .map((option) => option.value);
  }

  public requestFamilies = () => {
    this.requested = true;
    void this.refresh();
  };

  public refresh = async () => {
    if (
      !this.requested &&
      !this.state.selectedFamilies.length &&
      !this.state.includeUnmatched &&
      !this.state.selectedNamespaces.length
    ) {
      return;
    }
    const variable = sceneGraph.lookupVariable(VAR_METRICS_VARIABLE, this) as MetricsVariable | undefined;
    if (!variable || variable.state.loading) {
      this.generation++;
      this.inFlight = undefined;
      this.setState({ options: [], families: [], status: 'loading' });
      this.emitFilter();
      return;
    }
    const options = variable.state.options as MetricOptions;
    if (this.inFlight?.options === options) {
      return this.inFlight.promise;
    }
    const promise = this.classify(options, ++this.generation);
    this.inFlight = { options, promise };
    try {
      await promise;
    } finally {
      if (this.inFlight?.promise === promise) {
        this.inFlight = undefined;
      }
    }
  };

  private async classify(options: MetricOptions, generation: number) {
    this.setState({ options, status: 'loading' });
    this.emitFilter();
    try {
      const missing = [
        ...new Set(options.map((option) => option.value).filter((name) => !this.state.bucketMap.has(name))),
      ];
      const bucketMap = missing.length ? await this.lookupBuckets(missing) : this.state.bucketMap;
      if (generation !== this.generation) {
        return;
      }
      const families = [
        ...new Set(
          options.flatMap((option) => {
            return (bucketMap.get(option.value) ?? []).map((entry) => entry.name);
          })
        ),
      ].sort((a, b) => a.localeCompare(b));
      this.setState({ bucketMap, families, status: 'ready' });
      this.emitFilter();
    } catch {
      if (generation !== this.generation) {
        return;
      }
      this.setState({ status: 'error' });
      this.emitFilter();
    }
  }

  private async lookupBuckets(keys: string[]) {
    const bucketMap = new Map(this.state.bucketMap);
    const session = getDefaultSemconvSession();
    if (!session) {
      throw new Error('Registry session unavailable');
    }
    const results = await session.getMany<SemconvMetric>({
      kind: 'metric',
      keys,
      fields: ['namespace'],
    });
    for (const name of keys) {
      const entries = results.get(name);
      if (!entries) {
        throw new Error(`Registry lookup omitted candidates for ${name}`);
      }
      bucketMap.set(
        name,
        entries.map((entry) => ({ name: entry.name, namespace: entry.namespace }))
      );
    }
    return bucketMap;
  }

  private emitFilter(open = false) {
    const { selectedFamilies, includeUnmatched, selectedNamespaces } = this.state;
    this.setState({ active: selectedFamilies.length > 0 || includeUnmatched || selectedNamespaces.length > 0 });
    this.publishEvent(
      new EventSectionValueChanged({
        key: SEMCONV_SECTION_KEY,
        values: [
          ...selectedFamilies,
          ...(includeUnmatched ? [unmatchedMetricLabel()] : []),
          ...selectedNamespaces.map(legacyNamespaceLabel),
        ],
        open,
      }),
      true
    );
    this.publishEvent(new EventFiltersChanged({ filters: this.getFilter(), type: 'semconvMetrics' }), true);
  }

  public onToggle = (name: string) => {
    const selected = new Set(this.state.selectedFamilies);
    if (selected.has(name)) {
      selected.delete(name);
    } else {
      selected.add(name);
    }
    this.setState({ selectedFamilies: [...selected] });
    this.emitFilter();
  };

  public onToggleUnmatched = () => {
    this.setState({ includeUnmatched: !this.state.includeUnmatched });
    this.emitFilter();
  };

  public onSelectAll = () => {
    const search = this.state.search.toLowerCase().trim();
    const visible = this.state.families.filter((name) => name.toLowerCase().includes(search));
    this.setState({ selectedFamilies: [...new Set([...this.state.selectedFamilies, ...visible])] });
    this.emitFilter();
  };

  public onClear = () => {
    this.setState({ selectedFamilies: [], includeUnmatched: false, selectedNamespaces: [] });
    this.emitFilter();
  };

  public onClearNamespaces = () => {
    this.setState({ selectedNamespaces: [] });
    this.emitFilter();
  };

  public static readonly Component = SemconvFilterSectionRenderer;
}

export function legacyNamespaceLabel(namespace: string) {
  return namespace === NOT_IN_SEMCONV_VALUE
    ? t('sidebar.semconv.not-in-registry', 'Not in registry')
    : t('sidebar.semconv.legacy-namespace-label', 'Namespace: {{namespace}}', { namespace });
}

function SemconvFilterSectionRenderer({ model }: Readonly<SceneComponentProps<SemconvFilterSection>>) {
  const styles = useStyles2(getStyles);
  const { title, description, families, selectedFamilies, includeUnmatched, selectedNamespaces, search, status } =
    model.useState();
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const firstSelected = selectedFamilies[0];
  useEffect(() => model.requestFamilies(), [model]);
  useEffect(() => {
    if (status === 'ready' && firstSelected) {
      listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [firstSelected, status]);
  const selected = new Set(selectedFamilies);
  const observed = new Set(families);
  const visible = [...new Set([...families, ...selectedFamilies])]
    .filter((name) => name.toLowerCase().includes(search.toLowerCase().trim()))
    .sort((a, b) => a.localeCompare(b));

  return (
    <div className={styles.container} data-testid="semconv-filter-section">
      <SectionTitle title={title} description={description} />
      <Input
        prefix={<Icon name="search" />}
        aria-label={t('sidebar.semconv.search', 'Search metric families')}
        placeholder={t('sidebar.semconv.search', 'Search metric families')}
        value={search}
        onChange={(event) => model.setState({ search: event.currentTarget.value })}
      />
      <div className={styles.toolbar}>
        <Button size="sm" variant="secondary" fill="text" onClick={model.onSelectAll} disabled={status !== 'ready'}>
          <Trans i18nKey="sidebar.semconv.select-visible">Select visible</Trans>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          fill="text"
          onClick={model.onClear}
          disabled={!selectedFamilies.length && !includeUnmatched && !selectedNamespaces.length}
        >
          <Trans i18nKey="sidebar.semconv.clear">Clear</Trans>
        </Button>
      </div>
      {selectedNamespaces.length > 0 && (
        <div className={styles.legacy}>
          <span>{selectedNamespaces.map(legacyNamespaceLabel).join(', ')}</span>
          <Button size="sm" variant="secondary" fill="text" onClick={model.onClearNamespaces}>
            <Trans i18nKey="sidebar.semconv.clear-legacy">Clear legacy filter</Trans>
          </Button>
        </div>
      )}
      {(status === 'idle' || status === 'loading') && (
        <LoadingPlaceholder text={t('sidebar.semconv.loading', 'Loading metric families…')} />
      )}
      {status === 'error' && (
        <div role="alert">
          <Trans i18nKey="sidebar.semconv.error">Registry lookup failed. Active selections remain restricted.</Trans>
          <Button size="sm" variant="secondary" onClick={model.refresh}>
            <Trans i18nKey="sidebar.semconv.retry">Retry</Trans>
          </Button>
        </div>
      )}
      <div className={styles.list} ref={listRef}>
        <div className={styles.row}>
          <div className={styles.rowLabel}>
            <Checkbox
              id={`unmatched-${listId}`}
              aria-label={unmatchedMetricLabel()}
              value={includeUnmatched}
              onChange={model.onToggleUnmatched}
            />
            <label className={styles.name} htmlFor={`unmatched-${listId}`}>
              {unmatchedMetricLabel()}
            </label>
          </div>
        </div>
        {status === 'ready' && visible.length === 0 && (
          <div className={styles.empty}>
            <Trans i18nKey="sidebar.semconv.empty-families">No matching metric families.</Trans>
          </div>
        )}
        {visible.map((name) => (
          <div key={name} className={styles.row} data-selected={selected.has(name)}>
            <div className={styles.rowLabel}>
              <Checkbox
                id={`${listId}-${encodeURIComponent(name)}`}
                value={selected.has(name)}
                onChange={() => model.onToggle(name)}
                aria-label={name}
              />
              <label className={styles.name} htmlFor={`${listId}-${encodeURIComponent(name)}`}>
                {name}
                {status === 'ready' && !observed.has(name) && (
                  <span className={styles.unavailable}>
                    <Trans i18nKey="sidebar.semconv.unavailable">Not found in current list</Trans>
                  </span>
                )}
              </label>
            </div>
            <a
              className={styles.link}
              href={`${config.appSubUrl ?? ''}${registryDefinitionPath('metric', name)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('sidebar.semconv.registry-link', 'View {{name}} in registry', {
                name,
                interpolation: { escapeValue: false },
              })}
              title={t('sidebar.semconv.registry-link', 'View {{name}} in registry', {
                name,
                interpolation: { escapeValue: false },
              })}
            >
              <Icon name="external-link-alt" size="sm" />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
      height: '100%',
      overflow: 'hidden',
    }),
    empty: css({ color: theme.colors.text.secondary, padding: theme.spacing(1) }),
    legacy: css({ color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize }),
    list: css({ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }),
    row: css({
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(0.5),
      padding: theme.spacing(0.5, 0),
      '&:hover': { backgroundColor: theme.colors.action.hover },
    }),
    rowLabel: css({
      display: 'flex',
      alignItems: 'flex-start',
      gap: theme.spacing(1),
      cursor: 'pointer',
      flex: 1,
      minWidth: 0,
    }),
    name: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      overflowWrap: 'anywhere',
    }),
    unavailable: css({ display: 'block', color: theme.colors.text.secondary, fontFamily: theme.typography.fontFamily }),
    link: css({ flexShrink: 0, '&, &:hover, &:focus-visible': { color: theme.colors.text.link } }),
    toolbar: css({ display: 'flex', gap: theme.spacing(0.5) }),
  };
}
