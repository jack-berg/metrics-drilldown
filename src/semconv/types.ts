export type SemconvStability = 'alpha' | 'development' | 'release_candidate' | 'stable';

export interface SemconvMember {
  brief: string;
  id: string;
  stability: string;
  value: string;
}

export interface SemconvAttribute {
  brief: string;
  examples?: string[];
  members?: SemconvMember[];
  name: string;
  namespace: string;
  note?: string;
  stability: SemconvStability;
  type: string;
}

export interface SemconvMetric {
  attributes?: Array<{ name: string; brief?: string; stability?: string }>;
  brief: string;
  instrument: 'counter' | 'gauge' | 'histogram' | 'updowncounter' | string;
  name: string;
  note?: string;
  stability: SemconvStability;
  unit?: string;
}
