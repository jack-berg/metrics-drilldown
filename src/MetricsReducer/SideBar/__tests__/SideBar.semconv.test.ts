import { getDefaultSemconvSession, SEMCONV_METRIC_FAMILY_PARAM } from '@grafana/otel-semconv-client';
import { CustomVariable, EmbeddedScene, SceneVariableSet, type AdHocFiltersVariable } from '@grafana/scenes';
import { waitFor } from '@testing-library/react';

import { VAR_METRICS_VARIABLE } from 'MetricsReducer/metrics-variables/MetricsVariable';
import { evaluateFeatureFlag } from 'shared/featureFlags/openFeature';
import { VAR_OTHER_METRIC_FILTERS } from 'shared/shared';
import { embeddedTrailNamespace, getTrailFor } from 'shared/utils/utils';

import {
  SEMCONV_SECTION_KEY,
  SEMCONV_UNMATCHED_PARAM,
  SemconvFilterSection,
} from '../sections/SemconvFilterSection/SemconvFilterSection';
import { SideBar } from '../SideBar';

jest.mock('@grafana/otel-semconv-client', () => ({
  ...jest.requireActual('@grafana/otel-semconv-client'),
  getDefaultSemconvSession: jest.fn(),
}));
jest.mock('shared/featureFlags/openFeature', () => ({ evaluateFeatureFlag: jest.fn() }));
jest.mock('shared/utils/utils', () => ({
  getTrailFor: jest.fn(),
  getObjectValues: Object.values,
  getObjectKeys: Object.keys,
  embeddedTrailNamespace: 'gmd',
}));
jest.mock('MetricsReducer/MetricsReducer', () => ({ MetricsReducer: class MetricsReducer {} }));

const family = 'http.server.request.duration';
const counter = 'aspnetcore.authentication.sign_ins';
const getMany = jest.fn();
const cleanups: Array<() => void> = [];

function setup(params: URLSearchParams = new URLSearchParams()) {
  window.history.replaceState({}, '', `/?${params}`);
  const sidebar = new SideBar({});
  const root = new EmbeddedScene({
    body: sidebar,
    $variables: new SceneVariableSet({
      variables: [
        new CustomVariable({
          name: VAR_METRICS_VARIABLE,
          options: [
            { value: 'duration_seconds_count', label: 'duration_seconds_count' },
            { value: 'sign_ins_total', label: 'sign_ins_total' },
          ],
        }),
      ],
    }),
  });
  jest.mocked(getTrailFor).mockReturnValue(root as unknown as ReturnType<typeof getTrailFor>);
  const section = sidebar.state.sections.find((value) => value instanceof SemconvFilterSection) as SemconvFilterSection;
  return { sidebar, root, section };
}

beforeEach(() => {
  jest.mocked(evaluateFeatureFlag).mockResolvedValue('control');
  jest
    .mocked(getDefaultSemconvSession)
    .mockReturnValue({ getMany } as unknown as NonNullable<ReturnType<typeof getDefaultSemconvSession>>);
  getMany.mockResolvedValue(
    new Map([
      ['duration_seconds_count', [{ name: family, namespace: 'http' }]],
      ['sign_ins_total', [{ name: counter, namespace: 'aspnetcore' }]],
    ])
  );
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  window.history.replaceState({}, '', '/');
});

it('opens the semantic-conventions section and checks the linked family on initial navigation', async () => {
  const { sidebar, section, root } = setup(new URLSearchParams({ [SEMCONV_METRIC_FAMILY_PARAM]: family }));
  expect(sidebar.state.visibleSection).toBe(section);
  expect(section.state.selectedFamilies).toEqual([family]);
  expect(sidebar.state.sectionValues.get(SEMCONV_SECTION_KEY)).toEqual([family]);
  expect(section.getFilter()).toEqual([]);
  cleanups.push(sidebar.activate());
  await waitFor(() => expect(section.state.status).toBe('ready'));
  expect(section.getFilter()).toEqual(['duration_seconds_count']);
  const otherFilters = root.state.$variables!.getByName(VAR_OTHER_METRIC_FILTERS) as AdHocFiltersVariable;
  expect(otherFilters.state.filters).toEqual([
    expect.objectContaining({ key: SEMCONV_SECTION_KEY, keyLabel: 'semconv family', value: family }),
  ]);
  expect(getMany).toHaveBeenCalledTimes(1);
});

it('restores repeated families including embedded namespaced URL values', () => {
  const params = new URLSearchParams();
  params.append(`${embeddedTrailNamespace}-${SEMCONV_METRIC_FAMILY_PARAM}`, family);
  params.append(`${embeddedTrailNamespace}-${SEMCONV_METRIC_FAMILY_PARAM}`, 'custom.family,one');
  const { sidebar, section } = setup(params);
  expect(sidebar.state.visibleSection).toBe(section);
  expect(section.state.selectedFamilies).toEqual([family, 'custom.family,one']);
  expect(sidebar.state.sectionValues.get(SEMCONV_SECTION_KEY)).toEqual([family, 'custom.family,one']);
});

it('does not reopen a manually closed section during metadata refresh, but new URL selections open it', async () => {
  const { sidebar, section, root } = setup(new URLSearchParams({ [SEMCONV_METRIC_FAMILY_PARAM]: family }));
  cleanups.push(sidebar.activate());
  await waitFor(() => expect(section.state.status).toBe('ready'));
  sidebar.setState({ visibleSection: null });
  await section.refresh();
  expect(sidebar.state.visibleSection).toBeNull();
  section.updateFromUrl({ [SEMCONV_METRIC_FAMILY_PARAM]: counter });
  expect(sidebar.state.visibleSection).toBe(section);
  expect(sidebar.state.sectionValues.get(SEMCONV_SECTION_KEY)).toEqual([counter]);
  expect(section.getFilter()).toEqual(['sign_ins_total']);
  const otherFilters = root.state.$variables!.getByName(VAR_OTHER_METRIC_FILTERS) as AdHocFiltersVariable;
  expect(otherFilters.state.filters[0].value).toBe(counter);
  section.onClear();
  expect(sidebar.state.sectionValues.get(SEMCONV_SECTION_KEY)).toEqual([]);
  expect(otherFilters.state.filters).toEqual([]);
  expect(section.state.active).toBe(false);
});

it('keeps legacy namespace URLs operational and labels them explicitly', async () => {
  const { sidebar, section } = setup(new URLSearchParams({ [SEMCONV_SECTION_KEY]: 'http' }));
  expect(section.state.selectedNamespaces).toEqual(['http']);
  expect(sidebar.state.sectionValues.get(SEMCONV_SECTION_KEY)).toEqual(['Namespace: http']);
  cleanups.push(sidebar.activate());
  await waitFor(() => expect(section.state.status).toBe('ready'));
  expect(section.getFilter()).toEqual(['duration_seconds_count']);
});

it.each(['', `${embeddedTrailNamespace}-`])('opens and restores unmatched-only %sURL selections', async (prefix) => {
  const { sidebar, section, root } = setup(new URLSearchParams({ [`${prefix}${SEMCONV_UNMATCHED_PARAM}`]: 'true' }));
  expect(sidebar.state.visibleSection).toBe(section);
  expect(section.state.includeUnmatched).toBe(true);
  expect(sidebar.state.sectionValues.get(SEMCONV_SECTION_KEY)).toEqual(['No registry match']);
  expect(section.getFilter()).toEqual([]);
  cleanups.push(sidebar.activate());
  await waitFor(() => expect(section.state.status).toBe('ready'));
  expect(section.getFilter()).toEqual([]);
  const otherFilters = root.state.$variables!.getByName(VAR_OTHER_METRIC_FILTERS) as AdHocFiltersVariable;
  expect(otherFilters.state.filters[0].value).toBe('No registry match');
  section.onClear();
  expect(otherFilters.state.filters).toEqual([]);
  expect(section.getFilter()).toBeUndefined();
});

it('opens on unmatched URL changes but not classification refresh and clears on history restoration', async () => {
  const { sidebar, section, root } = setup();
  cleanups.push(sidebar.activate());
  section.updateFromUrl({ [SEMCONV_UNMATCHED_PARAM]: 'true', [SEMCONV_METRIC_FAMILY_PARAM]: family });
  expect(sidebar.state.visibleSection).toBe(section);
  await waitFor(() => expect(section.state.status).toBe('ready'));
  expect(section.getFilter()).toEqual(['duration_seconds_count']);
  expect(sidebar.state.sectionValues.get(SEMCONV_SECTION_KEY)).toEqual([family, 'No registry match']);
  sidebar.setState({ visibleSection: null });
  await section.refresh();
  expect(sidebar.state.visibleSection).toBeNull();
  section.updateFromUrl({});
  expect(section.state.includeUnmatched).toBe(false);
  expect(section.getFilter()).toBeUndefined();
  const otherFilters = root.state.$variables!.getByName(VAR_OTHER_METRIC_FILTERS) as AdHocFiltersVariable;
  expect(otherFilters.state.filters).toEqual([]);
});

it('does not enable unmatched for false URL values or override an embedded false with a raw true', () => {
  const params = new URLSearchParams({
    [SEMCONV_UNMATCHED_PARAM]: 'true',
    [`${embeddedTrailNamespace}-${SEMCONV_UNMATCHED_PARAM}`]: 'false',
  });
  const { sidebar, section } = setup(params);
  expect(section.state.includeUnmatched).toBe(false);
  expect(sidebar.state.visibleSection).toBeNull();
  expect(section.getFilter()).toBeUndefined();
});

it('does not classify metric options while the section is closed and no semantic selection is active', () => {
  const { sidebar, section } = setup();
  cleanups.push(sidebar.activate());
  expect(sidebar.state.visibleSection).toBeNull();
  expect(getMany).not.toHaveBeenCalled();
  expect(section.getFilter()).toBeUndefined();
});
