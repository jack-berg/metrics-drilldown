import { getBackendSrv, isFetchError } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { SemconvAttribute, SemconvMetric } from './types';

const BASE = '/api/plugins/grafana-otel-schema-registry-app/resources';

const attributeCache = new Map<string, Promise<SemconvAttribute | null>>();
const metricCache = new Map<string, Promise<SemconvMetric | null>>();
let allMetricsPromise: Promise<Map<string, SemconvMetric>> | undefined;

export function fetchSemconvAttribute(name: string): Promise<SemconvAttribute | null> {
  return fetchCached(attributeCache, `${BASE}/attributes/`, name);
}

export function fetchSemconvMetric(name: string): Promise<SemconvMetric | null> {
  return fetchCached(metricCache, `${BASE}/metrics/`, name);
}

/**
 * Fetch every semconv metric in one shot. Primes the per-metric cache so
 * subsequent `fetchSemconvMetric` calls for known names skip the network.
 * Concurrent callers share a single in-flight promise.
 */
export function fetchAllSemconvMetrics(): Promise<Map<string, SemconvMetric>> {
  if (allMetricsPromise) {
    return allMetricsPromise;
  }
  allMetricsPromise = lastValueFrom(
    getBackendSrv().fetch<{ metrics?: SemconvMetric[]; items?: SemconvMetric[] }>({
      method: 'GET',
      showErrorAlert: false,
      url: `${BASE}/metrics?limit=1000`,
    })
  )
    .then((res) => {
      const list = res?.data?.metrics ?? res?.data?.items ?? [];
      const map = new Map<string, SemconvMetric>();
      for (const metric of list) {
        map.set(metric.name, metric);
        metricCache.set(metric.name, Promise.resolve(metric));
      }
      return map;
    })
    .catch((err: unknown) => {
      console.warn('[semconv] failed to fetch all metrics', err);
      allMetricsPromise = undefined; // allow retry
      return new Map<string, SemconvMetric>();
    });
  return allMetricsPromise;
}

function fetchCached<T>(cache: Map<string, Promise<T | null>>, urlBase: string, name: string): Promise<T | null> {
  const cached = cache.get(name);
  if (cached) {
    return cached;
  }
  const promise = lastValueFrom(
    getBackendSrv().fetch<T>({
      method: 'GET',
      showErrorAlert: false,
      url: urlBase + encodeURIComponent(name),
    })
  )
    .then((res) => res?.data ?? null)
    .catch((err: unknown) => {
      if (isFetchError(err) && err.status === 404) {
        return null;
      }
      console.warn('[semconv] failed to fetch', urlBase, name, err);
      return null;
    });
  cache.set(name, promise);
  return promise;
}
