// The design system's shared unions, written out so the published types stand
// alone. parity.ts checks they still match src/web/ui.ts.

import type * as React from 'react';

/** A badge, alert, stat or chat bubble's colour, always backed by its words. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
/** primary: the one main action. secondary: outlined. danger: destructive. ghost: quiet. */
export type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
/** A rail section. */
export type NavKey = 'dashboard' | 'calendar' | 'setup' | 'simulator';
export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'number'
  | 'date'
  | 'datetime-local'
  | 'time'
  | 'url'
  | 'password'
  | 'textarea'
  | 'select'
  | 'file'
  | 'checkbox';
/** A Phosphor icon weight. */
export type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';

/** Events a component passes up from inside its markup. */
export interface HostEvents {
  /** Clicks anywhere inside, including on its links (call preventDefault to stay on the page). */
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
}
