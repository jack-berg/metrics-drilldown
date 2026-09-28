import { useEffect, useState } from 'react';

import { fetchSemconvAttribute } from './client';
import { SemconvAttribute } from './types';

interface Entry {
  name: string | undefined;
  value: SemconvAttribute | null | undefined;
}

export function useSemconvAttribute(name: string | undefined): SemconvAttribute | null | undefined {
  const [entry, setEntry] = useState<Entry>({ name: undefined, value: undefined });

  useEffect(() => {
    if (!name) {
      return;
    }
    let cancelled = false;
    fetchSemconvAttribute(name).then((value) => {
      if (!cancelled) {
        setEntry({ name, value });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  // If `name` changed since the last resolved fetch, treat as loading rather
  // than briefly showing the previous attribute's data.
  return entry.name === name ? entry.value : undefined;
}
