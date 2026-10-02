import { createTheme, ThemeContext } from '@grafana/data';
import {
  getDefaultSemconvSession,
  metricDrilldownPath,
  SEMCONV_METRIC_FAMILY_PARAM,
} from '@grafana/otel-semconv-client';
import { config } from '@grafana/runtime';
import { CustomVariable, EmbeddedScene, QueryVariable, SceneVariableSet } from '@grafana/scenes';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { VAR_METRICS_VARIABLE } from 'MetricsReducer/metrics-variables/MetricsVariable';
import { MetricsVariableFilterEngine } from 'MetricsReducer/metrics-variables/MetricsVariableFilterEngine';

import {
  NOT_IN_SEMCONV_VALUE,
  SEMCONV_SECTION_KEY,
  SEMCONV_UNMATCHED_PARAM,
  SemconvFilterSection,
} from './SemconvFilterSection';
import { EventSectionValueChanged } from '../EventSectionValueChanged';
import { EventFiltersChanged } from '../MetricsFilterSection/EventFiltersChanged';

jest.mock('@grafana/otel-semconv-client', () => ({
  ...jest.requireActual('@grafana/otel-semconv-client'),
  getDefaultSemconvSession: jest.fn(),
}));

const family = 'http.server.request.duration';
const counter = 'aspnetcore.authentication.sign_ins';
const names = [
  'http_server_request_duration_seconds',
  'http_server_request_duration_seconds_bucket',
  'http_server_request_duration_seconds_count',
  'http_server_request_duration_seconds_sum',
  'aspnetcore_authentication_sign_ins_total',
  'unrelated_metric',
];
const getMany = jest.fn();

function setup(families: string[] = [], loading = false, namespaces: string[] = [], includeUnmatched = false) {
  const model = new SemconvFilterSection({
    title: 'Semantic conventions',
    description: 'Metric families',
    icon: 'book',
    selectedFamilies: families,
    includeUnmatched,
    selectedNamespaces: namespaces,
  });
  const variable = new CustomVariable({
    name: VAR_METRICS_VARIABLE,
    options: names.map((value) => ({ value, label: value })),
    loading,
  });
  const scene = new EmbeddedScene({ body: model, $variables: new SceneVariableSet({ variables: [variable] }) });
  const events: Array<string[] | undefined> = [];
  const selections: Array<{ values: string[]; open?: boolean }> = [];
  model.subscribeToEvent(EventFiltersChanged, (event) => events.push(event.payload.filters));
  model.subscribeToEvent(EventSectionValueChanged, (event) => selections.push(event.payload));
  return { model, variable, scene, events, selections };
}

beforeEach(() => {
  jest
    .mocked(getDefaultSemconvSession)
    .mockReturnValue({ getMany } as unknown as NonNullable<ReturnType<typeof getDefaultSemconvSession>>);
  getMany.mockImplementation(
    async ({ keys }: { keys: string[] }) =>
      new Map(
        keys.map((name) => {
          if (names.indexOf(name) < 4 && names.includes(name)) {
            return [name, { name: family, namespace: 'http' }];
          }
          return [name, name === names[4] ? { name: counter, namespace: 'aspnetcore' } : null];
        })
      )
  );
});

it('does not request metadata until the section opens or a selection needs it', () => {
  const { model } = setup();
  const deactivate = model.activate();
  expect(getMany).not.toHaveBeenCalled();
  expect(model.getFilter()).toBeUndefined();
  deactivate();
});

it('lists each identified canonical family once, alphabetically, without unknown metrics or namespace groups', async () => {
  const { model } = setup();
  render(<model.Component model={model} />);
  await waitFor(() => expect(model.state.status).toBe('ready'));
  expect(model.state.families).toEqual([counter, family]);
  expect(screen.getAllByRole('checkbox').map((element) => element.getAttribute('aria-label'))).toEqual([
    'No registry match',
    counter,
    family,
  ]);
  expect(screen.queryByRole('checkbox', { name: 'http' })).not.toBeInTheDocument();
  expect(screen.queryByText('unrelated_metric')).not.toBeInTheDocument();
  expect(getMany).toHaveBeenCalledTimes(1);
  expect(getMany).toHaveBeenCalledWith({
    kind: 'metric',
    keys: names,
    signal: { metrics: 'prometheus' },
    fields: ['namespace'],
  });
});

it('renders unmatched first in the family list with the same row styling and no description', async () => {
  const { model } = setup();
  render(<model.Component model={model} />);
  await waitFor(() => expect(model.state.status).toBe('ready'));
  const unmatchedLabel = screen.getByText('No registry match');
  const familyLabel = screen.getByText(counter);
  const unmatchedRow = unmatchedLabel.parentElement!.parentElement!;
  const familyRow = familyLabel.parentElement!.parentElement!;
  const list = familyRow.parentElement!;
  expect(unmatchedRow.parentElement).toBe(list);
  expect(list.firstElementChild).toBe(unmatchedRow);
  expect(unmatchedRow.className).toBe(familyRow.className);
  expect(unmatchedLabel.className).toBe(familyLabel.className);
  expect(screen.getByRole('checkbox', { name: 'No registry match' })).not.toHaveAttribute('aria-describedby');
  expect(screen.queryByText(/This does not imply invalid instrumentation/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search metric families' }), { target: { value: 'http' } });
  expect(list.firstElementChild).toBe(unmatchedRow);
  expect(screen.getAllByRole('checkbox').map((element) => element.getAttribute('aria-label'))).toEqual([
    'No registry match',
    family,
  ]);
  fireEvent.click(unmatchedLabel);
  expect(model.state.includeUnmatched).toBe(true);
});

it('searches canonical families case-insensitively without changing the metric restriction', async () => {
  const { model } = setup([family]);
  render(<model.Component model={model} />);
  await waitFor(() => expect(model.state.status).toBe('ready'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search metric families' }), { target: { value: 'SIGN_INS' } });
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(screen.getByRole('checkbox', { name: counter })).toBeInTheDocument();
  expect(model.getFilter()).toEqual(names.slice(0, 4));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search metric families' }), { target: { value: 'absent' } });
  expect(screen.getByText('No matching metric families.')).toBeInTheDocument();
  expect(model.getFilter()).toEqual(names.slice(0, 4));
});

it('unions family checkboxes and includes all observed histogram components without extra lookups', async () => {
  const { model } = setup();
  render(<model.Component model={model} />);
  await waitFor(() => expect(model.state.status).toBe('ready'));
  fireEvent.click(screen.getByText(family));
  expect(model.getFilter()).toEqual(names.slice(0, 4));
  fireEvent.click(screen.getByRole('checkbox', { name: counter }));
  expect(model.getFilter()).toEqual(names.slice(0, 5));
  fireEvent.click(screen.getByRole('checkbox', { name: family }));
  expect(model.getFilter()).toEqual([names[4]]);
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(model.getFilter()).toBeUndefined();
  expect(model.state.active).toBe(false);
  expect(getMany).toHaveBeenCalledTimes(1);
});

it('reveals the linked selection and clears stale family search on URL navigation', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  const reveal = jest.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: reveal });
  try {
    const { model } = setup([family]);
    render(<model.Component model={model} />);
    await waitFor(() => expect(model.state.status).toBe('ready'));
    expect(reveal).toHaveBeenCalledWith({ block: 'nearest' });
    const search = screen.getByRole('textbox', { name: 'Search metric families' });
    fireEvent.change(search, { target: { value: 'http' } });
    act(() => model.updateFromUrl({ [SEMCONV_METRIC_FAMILY_PARAM]: counter }));
    expect(search).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: counter })).toBeChecked();
  } finally {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  }
});

it('selects visible search results while retaining previously selected families', async () => {
  const { model } = setup([family]);
  render(<model.Component model={model} />);
  await waitFor(() => expect(model.state.status).toBe('ready'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search metric families' }), { target: { value: 'sign_ins' } });
  fireEvent.click(screen.getByRole('button', { name: 'Select visible' }));
  expect(model.state.selectedFamilies).toEqual([family, counter]);
  expect(model.getFilter()).toEqual(names.slice(0, 5));
});

it('restores registry links and repeated family URL values without splitting canonical commas', async () => {
  const { model, selections } = setup();
  model.updateFromUrl(Object.fromEntries(new URL(metricDrilldownPath(family), 'http://localhost').searchParams));
  expect(model.getFilter()).toEqual([]);
  expect(selections.at(-1)).toEqual(expect.objectContaining({ values: [family], open: true }));
  await model.refresh();
  expect(model.getFilter()).toEqual(names.slice(0, 4));
  model.updateFromUrl({ [SEMCONV_METRIC_FAMILY_PARAM]: [family, counter, family, 'custom.family,one'] });
  expect(model.getUrlState()).toEqual({
    [SEMCONV_SECTION_KEY]: '',
    [SEMCONV_METRIC_FAMILY_PARAM]: [family, counter, 'custom.family,one'],
    [SEMCONV_UNMATCHED_PARAM]: '',
  });
  expect(model.getFilter()).toEqual(names.slice(0, 5));
});

it('clears state when Back/Forward removes URL keys and restores it when returning', async () => {
  const { model, events } = setup([family]);
  await model.refresh();
  model.updateFromUrl({});
  expect(model.getFilter()).toBeUndefined();
  expect(events.at(-1)).toBeUndefined();
  model.updateFromUrl({ [SEMCONV_METRIC_FAMILY_PARAM]: family });
  expect(model.getFilter()).toEqual(names.slice(0, 4));
});

it('retains unavailable selected families as removable checked rows and matches nothing', async () => {
  const { model } = setup(['removed.metric']);
  render(<model.Component model={model} />);
  await waitFor(() => expect(model.state.status).toBe('ready'));
  expect(model.getFilter()).toEqual([]);
  expect(screen.getByRole('checkbox', { name: 'removed.metric' })).toBeChecked();
  expect(screen.getByText('Not found in current list')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'removed.metric' }));
  expect(model.getFilter()).toBeUndefined();
  expect(screen.queryByRole('checkbox', { name: 'removed.metric' })).not.toBeInTheDocument();
});

it('does not request catalog definitions that have no observed metric names', async () => {
  const { model, variable } = setup();
  variable.setState({ options: [{ label: 'unknown', value: 'unknown' }] });
  render(<model.Component model={model} />);
  await waitFor(() => expect(model.state.status).toBe('ready'));
  expect(model.state.families).toEqual([]);
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  expect(screen.getByRole('checkbox', { name: 'No registry match' })).not.toBeChecked();
  expect(getMany).toHaveBeenCalledWith(expect.objectContaining({ keys: ['unknown'] }));
});

it('retains failed selections, keeps results restricted, and supports retry and clear', async () => {
  getMany.mockRejectedValueOnce(new Error('offline'));
  const { model } = setup([family]);
  render(<model.Component model={model} />);
  await waitFor(() => expect(model.state.status).toBe('error'));
  expect(model.getFilter()).toEqual([]);
  expect(screen.getByRole('checkbox', { name: family })).toBeChecked();
  expect(screen.getByRole('alert')).toHaveTextContent('Active selections remain restricted');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(model.getFilter()).toEqual(names.slice(0, 4)));
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(model.getFilter()).toBeUndefined();
});

it('fails closed without a registry session', async () => {
  jest.mocked(getDefaultSemconvSession).mockReturnValue(undefined);
  const { model } = setup([family]);
  await model.refresh();
  expect(model.state.status).toBe('error');
  expect(model.getFilter()).toEqual([]);
});

it('preserves legacy namespace URLs as explicit restrictions and intersects them with family selections', async () => {
  const { model } = setup();
  model.updateFromUrl({ [SEMCONV_SECTION_KEY]: 'http', [SEMCONV_METRIC_FAMILY_PARAM]: counter });
  render(<model.Component model={model} />);
  await waitFor(() => expect(model.state.status).toBe('ready'));
  expect(model.getFilter()).toEqual([]);
  expect(screen.getByText('Namespace: http')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear legacy filter' }));
  expect(model.getFilter()).toEqual([names[4]]);
  expect(model.getUrlState()[SEMCONV_SECTION_KEY]).toBe('');
  act(() => model.updateFromUrl({ [SEMCONV_SECTION_KEY]: 'http' }));
  expect(model.getFilter()).toEqual(names.slice(0, 4));
});

it('preserves the legacy not-in-semconv restriction without offering it as a metric family', async () => {
  const { model } = setup([], false, [NOT_IN_SEMCONV_VALUE]);
  await model.refresh();
  expect(model.getFilter()).toEqual([names[5]]);
  expect(model.state.families).not.toContain(NOT_IN_SEMCONV_VALUE);
  model.onClear();
  expect(model.getFilter()).toBeUndefined();
});

it('keeps an unavailable legacy namespace restrictive', async () => {
  const { model } = setup([], false, ['removed-namespace']);
  await model.refresh();
  expect(model.getFilter()).toEqual([]);
  expect(model.state.selectedNamespaces).toEqual(['removed-namespace']);
});

it('waits for metric loading, retains selections across datasource changes, and classifies only new names', async () => {
  const { model, variable } = setup([family], true);
  const deactivate = model.activate();
  expect(model.getFilter()).toEqual([]);
  expect(getMany).not.toHaveBeenCalled();
  act(() => variable.setState({ loading: false }));
  await waitFor(() => expect(model.getFilter()).toEqual(names.slice(0, 4)));
  getMany.mockResolvedValue(new Map([['new_name', { name: family, namespace: 'http' }]]));
  act(() => variable.setState({ options: [{ value: 'new_name', label: 'new_name' }] }));
  expect(model.getFilter()).toEqual([]);
  await waitFor(() => expect(model.getFilter()).toEqual(['new_name']));
  expect(model.state.selectedFamilies).toEqual([family]);
  expect(getMany).toHaveBeenLastCalledWith(expect.objectContaining({ keys: ['new_name'] }));
  deactivate();
});

it('deduplicates simultaneous classification and applies the latest family selection', async () => {
  let resolve!: (value: Map<string, { name: string; namespace: string }>) => void;
  getMany.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { model } = setup([family]);
  const request = model.refresh();
  const duplicate = model.refresh();
  model.updateFromUrl({ [SEMCONV_METRIC_FAMILY_PARAM]: counter });
  resolve(
    new Map([
      [names[0], { name: family, namespace: 'http' }],
      [names[4], { name: counter, namespace: 'aspnetcore' }],
    ])
  );
  await Promise.all([request, duplicate]);
  expect(getMany).toHaveBeenCalledTimes(1);
  expect(model.getFilter()).toEqual([names[4]]);
});

it('ignores stale datasource results after a newer option list is classified', async () => {
  let resolve!: (value: Map<string, { name: string }>) => void;
  getMany.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { model, variable } = setup([family]);
  const deactivate = model.activate();
  getMany.mockResolvedValue(new Map([['new_name', { name: counter, namespace: 'aspnetcore' }]]));
  act(() => variable.setState({ options: [{ value: 'new_name', label: 'new_name' }] }));
  await waitFor(() => expect(model.state.status).toBe('ready'));
  resolve(new Map([[names[0], { name: family }]]));
  await act(async () => {});
  expect(model.state.families).toEqual([counter]);
  expect(model.getFilter()).toEqual([]);
  deactivate();
});

it('discards pending metadata after deactivation', async () => {
  let resolve!: (value: Map<string, { name: string }>) => void;
  getMany.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { model } = setup([family]);
  const deactivate = model.activate();
  deactivate();
  resolve(new Map([[names[0], { name: family }]]));
  await act(async () => {});
  expect(model.state.bucketMap.size).toBe(0);
  expect(model.getFilter()).toEqual([]);
});

it('does not restore an active restriction when cleared during classification', async () => {
  let resolve!: (value: Map<string, { name: string }>) => void;
  getMany.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { model } = setup([family]);
  const request = model.refresh();
  model.onClear();
  resolve(new Map([[names[0], { name: family }]]));
  await request;
  expect(model.state.active).toBe(false);
  expect(model.getFilter()).toBeUndefined();
});

it('keeps the unmatched checkbox visible regardless of search and unions it with selected families', async () => {
  const { model, selections } = setup([family]);
  render(<model.Component model={model} />);
  await waitFor(() => expect(model.state.status).toBe('ready'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search metric families' }), { target: { value: 'absent' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'No registry match' }));
  expect(model.getFilter()).toEqual([...names.slice(0, 4), names[5]]);
  expect(selections.at(-1)?.values).toEqual([family, 'No registry match']);
  expect(model.getUrlState()[SEMCONV_UNMATCHED_PARAM]).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Select visible' }));
  expect(model.state.selectedFamilies).toEqual([family]);
  expect(model.state.includeUnmatched).toBe(true);
  expect(getMany).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('checkbox', { name: 'No registry match' }));
  expect(model.getFilter()).toEqual(names.slice(0, 4));
});

it('shows only unmatched metrics and intersects ordinary metric filters', async () => {
  const { model } = setup([], false, [], true);
  await model.refresh();
  expect(model.getFilter()).toEqual([names[5]]);
  const variable = new QueryVariable({ name: 'filtered' });
  const engine = new MetricsVariableFilterEngine(variable);
  engine.setInitOptions(names.map((value) => ({ value, label: value })));
  engine.applyFilters({ semconvMetrics: model.getFilter(), names: ['http'] }, { forceUpdate: true, notify: false });
  expect(variable.state.options).toEqual([]);
  engine.applyFilters(
    { semconvMetrics: model.getFilter(), names: ['unrelated'] },
    { forceUpdate: true, notify: false }
  );
  expect(variable.state.options.map((option) => option.value)).toEqual([names[5]]);
});

it('restores and clears unmatched URL state without reserving a canonical family name', async () => {
  const { model } = setup();
  model.updateFromUrl({ [SEMCONV_UNMATCHED_PARAM]: 'true' });
  expect(model.getFilter()).toEqual([]);
  expect(model.state.selectedFamilies).toEqual([]);
  await model.refresh();
  expect(model.getFilter()).toEqual([names[5]]);
  const url = model.getUrlState();
  expect(url[SEMCONV_UNMATCHED_PARAM]).toBe('true');
  model.updateFromUrl({});
  expect(model.getFilter()).toBeUndefined();
  model.updateFromUrl(url);
  expect(model.getFilter()).toEqual([names[5]]);
  model.onClear();
  expect(model.getUrlState()[SEMCONV_UNMATCHED_PARAM]).toBe('');
  expect(model.getFilter()).toBeUndefined();
  expect(model.state.active).toBe(false);
});

it.each(['lookup failure', 'absent session'])(
  'keeps unmatched restrictive on %s and supports clear',
  async (reason) => {
    if (reason === 'lookup failure') {
      getMany.mockRejectedValue(new Error('offline'));
    } else {
      jest.mocked(getDefaultSemconvSession).mockReturnValue(undefined);
    }
    const { model } = setup([], false, [], true);
    render(<model.Component model={model} />);
    await waitFor(() => expect(model.state.status).toBe('error'));
    expect(model.getFilter()).toEqual([]);
    expect(screen.getByRole('checkbox', { name: 'No registry match' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(model.getFilter()).toBeUndefined();
    expect(model.state.includeUnmatched).toBe(false);
  }
);

it('waits for classification before treating a metric as unmatched and supports retry', async () => {
  getMany.mockRejectedValueOnce(new Error('offline'));
  const { model, variable } = setup([], true, [], true);
  const deactivate = model.activate();
  render(<model.Component model={model} />);
  expect(model.getFilter()).toEqual([]);
  expect(getMany).not.toHaveBeenCalled();
  act(() => variable.setState({ loading: false }));
  await waitFor(() => expect(model.state.status).toBe('error'));
  expect(model.getFilter()).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(model.getFilter()).toEqual([names[5]]));
  expect(model.getFilter([{ value: 'unclassified', label: 'unclassified' }])).toEqual([]);
  deactivate();
});

it('excludes identified custom metrics and remains restrictive when all metrics are identified', async () => {
  getMany.mockResolvedValue(
    new Map([['github_rate_limit_limit', { name: 'github.rate_limit.limit', namespace: 'github' }]])
  );
  const { model, variable } = setup([], false, [], true);
  variable.setState({ options: [{ value: 'github_rate_limit_limit', label: 'github_rate_limit_limit' }] });
  await model.refresh();
  expect(model.getFilter()).toEqual([]);
  expect(model.state.families).toEqual(['github.rate_limit.limit']);
  expect(model.state.includeUnmatched).toBe(true);
});

it('intersects unmatched and family unions with legacy namespace restrictions', async () => {
  const { model } = setup([family], false, ['http'], true);
  await model.refresh();
  expect(model.getFilter()).toEqual(names.slice(0, 4));
  model.updateFromUrl({
    [SEMCONV_SECTION_KEY]: NOT_IN_SEMCONV_VALUE,
    [SEMCONV_METRIC_FAMILY_PARAM]: family,
    [SEMCONV_UNMATCHED_PARAM]: 'true',
  });
  expect(model.getFilter()).toEqual([names[5]]);
  model.onClearNamespaces();
  expect(model.getFilter()).toEqual([...names.slice(0, 4), names[5]]);
});

it('checks new raw options before initial filter-engine load, preventing a stale membership flash', async () => {
  const { model } = setup([family]);
  await model.refresh();
  expect(model.getFilter([{ value: 'unclassified', label: 'unclassified' }])).toEqual([]);
});

it('links from each family to its exact registry definition without toggling its checkbox', async () => {
  const previous = config.appSubUrl;
  try {
    config.appSubUrl = '/grafana';
    const name = 'custom.sign_ins /?&+#';
    const { model, variable } = setup([name]);
    variable.setState({ options: [] });
    render(<model.Component model={model} />);
    await waitFor(() => expect(model.state.status).toBe('ready'));
    const link = screen.getByRole('link', { name: `View ${name} in registry` });
    const url = new URL(link.getAttribute('href')!, 'http://localhost');
    expect(url.pathname).toBe('/grafana/a/grafana-otel-schema-registry-app/metrics');
    expect(url.searchParams.get('name')).toBe(name);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const toggle = jest.spyOn(model, 'onToggle');
    fireEvent.click(link);
    expect(toggle).not.toHaveBeenCalled();
    expect(model.state.selectedFamilies).toEqual([name]);
  } finally {
    config.appSubUrl = previous;
  }
});

it.each(['light', 'dark'] as const)('uses theme link styling for registry links in the %s theme', async (mode) => {
  const theme = createTheme({ colors: { mode } });
  const { model } = setup();
  render(
    <ThemeContext.Provider value={theme}>
      <model.Component model={model} />
      <span data-testid="link-color" style={{ color: theme.colors.text.link }} />
    </ThemeContext.Provider>
  );
  await waitFor(() => expect(model.state.status).toBe('ready'));
  expect(getComputedStyle(screen.getByRole('link', { name: `View ${family} in registry` })).color).toBe(
    getComputedStyle(screen.getByTestId('link-color')).color
  );
});

it('keeps an active empty semantic restriction closed in the filter engine and clearing restores options', () => {
  const variable = new QueryVariable({ name: 'filtered' });
  const engine = new MetricsVariableFilterEngine(variable);
  const options = names.map((value) => ({ value, label: value }));
  engine.setInitOptions(options);
  engine.applyFilters({ semconvMetrics: [] }, { forceUpdate: true, notify: false });
  expect(variable.state.options).toEqual([]);
  engine.applyFilters({ semconvMetrics: undefined }, { forceUpdate: true, notify: false });
  expect(variable.state.options).toEqual(options);
  const filters = { ...engine.getFilters(), names: ['_count$'], semconvMetrics: names.slice(0, 4) };
  expect(MetricsVariableFilterEngine.getFilteredOptions(options, filters)).toEqual([options[2]]);
});
