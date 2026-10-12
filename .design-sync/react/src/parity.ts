// Type-check only (never exported): fails `npm run build` when ui.ts changes a union.
import type * as ui from '../../../src/web/ui.ts';
import type { IconWeight as UiIconWeight } from '../../../src/web/icons.ts';
import type { FieldType, IconWeight, NavKey, Tone, Variant } from './types.ts';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const parity: [Same<Tone, ui.Tone>, Same<Variant, ui.Variant>, Same<NavKey, ui.NavKey>, Same<FieldType, ui.FieldType>, Same<IconWeight, UiIconWeight>] = [
  true,
  true,
  true,
  true,
  true,
];
