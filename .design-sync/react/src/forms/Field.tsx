import type * as React from 'react';
import type { ReactElement } from 'react';
import * as ui from '../../../../src/web/ui.ts';
import { HtmlHost } from '../runtime/host.tsx';
import type { FieldType } from '../types.ts';

export interface FieldProps {
  label: string;
  /** The form field name; the control's id is field-<name> unless id is given. */
  name: string;
  /** Defaults to text. textarea, select, file and checkbox render their own control. */
  type?: FieldType;
  /** The starting value (the control is uncontrolled; read changes with onInput). */
  value?: string | number | null;
  required?: boolean;
  placeholder?: string;
  /** For select. */
  options?: { value: string; label: string }[];
  /** A line under the control, tied to it for screen readers. */
  hint?: string;
  /** Why the value was refused: red text and an invalid control. */
  error?: string;
  /** For checkbox. */
  checked?: boolean;
  multiple?: boolean;
  accept?: string;
  step?: string;
  id?: string;
  autocomplete?: string;
  min?: string | number;
  max?: string | number;
  /** For textarea; defaults to 4. */
  rows?: number;
  /** Fires on every edit; read event.target. */
  onInput?: (event: React.FormEvent<HTMLElement>) => void;
}

/** A labelled form control (daisyUI input, select, textarea, file-input or checkbox) with an optional hint and error. */
export function Field({ onInput, ...o }: FieldProps): ReactElement {
  return <HtmlHost onInput={onInput} render={() => ui.field(o)} />;
}
