import React from 'react';

import { css } from '@emotion/css';

import { GrafanaTheme2 } from '@grafana/data';
import { Trans } from '@grafana/i18n';
import { Badge, BadgeColor, Tooltip, useStyles2 } from '@grafana/ui';

import { SemconvAttribute, SemconvStability } from './types';
import { useSemconvAttribute } from './useSemconvAttribute';

interface Props {
  children: React.ReactElement;
  name: string | undefined;
}

const STABILITY_COLOR: Record<SemconvStability, BadgeColor> = {
  stable: 'green',
  release_candidate: 'blue',
  development: 'orange',
  alpha: 'red',
};

export function SemconvAttributeTooltip({ name, children }: Props) {
  const attr = useSemconvAttribute(name);

  if (!attr) {
    return children;
  }

  return (
    <Tooltip content={<TooltipContent attr={attr} />} interactive>
      {children}
    </Tooltip>
  );
}

function TooltipContent({ attr }: { attr: SemconvAttribute }) {
  const styles = useStyles2(getStyles);
  const examples = attr.examples?.slice(0, 3).join(', ');

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.name}>{attr.name}</span>
        <Badge text={attr.stability} color={STABILITY_COLOR[attr.stability] ?? 'darkgrey'} />
      </div>
      {attr.brief && <p className={styles.brief}>{attr.brief}</p>}
      <div className={styles.meta}>
        <span className={styles.label}>
          <Trans i18nKey="semconv.tooltip.type">Type:</Trans>
        </span>{' '}
        <span>{attr.type}</span>
      </div>
      {examples && (
        <div className={styles.meta}>
          <span className={styles.label}>
            <Trans i18nKey="semconv.tooltip.examples">Examples:</Trans>
          </span>{' '}
          <span>{examples}</span>
        </div>
      )}
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(0.75),
      maxWidth: '360px',
    }),
    header: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      justifyContent: 'space-between',
    }),
    name: css({
      fontFamily: theme.typography.fontFamilyMonospace,
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.primary,
    }),
    brief: css({
      margin: 0,
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.primary,
    }),
    meta: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    label: css({
      color: theme.colors.text.secondary,
      fontWeight: theme.typography.fontWeightMedium,
    }),
  };
}
