// The design system's variant classes, typed with cva. The server's templates (ui.ts) and the
// React islands (client/) both build their classes here, so a button or an alert looks the same
// whichever side draws it. The classes themselves are daisyUI's, restyled in static/app.css.

import { cva, type VariantProps } from 'class-variance-authority';

/**
 * daisyUI `btn`: Primary is Harbour, Secondary outlined, Danger red text, Ghost bare. Confirm (filled green) commits to a
 * decision: confirm a request, choose a Quote, book a visit. Destructive (filled red) is the last step of an undoing one:
 * reject, decline, or the Yes after Cancel Job. Sizes are 32, 36 and 44px (44px on phones).
 */
export const buttonVariants = cva('btn', {
  variants: {
    variant: { primary: 'btn-primary', confirm: 'btn-success', destructive: 'btn-error', secondary: 'btn-outline', danger: 'btn-danger', ghost: 'btn-ghost' },
    size: { sm: 'btn-sm', md: '', lg: 'btn-lg' },
    block: { true: 'btn-block', false: '' },
  },
  defaultVariants: { variant: 'primary', size: 'md', block: false },
});

/** daisyUI `alert`, soft style: the tone's tint behind the icon and words, never colour alone. */
export const alertVariants = cva('alert alert-soft', {
  variants: {
    tone: { neutral: '', info: 'alert-info', success: 'alert-success', warning: 'alert-warning', error: 'alert-error' },
  },
  defaultVariants: { tone: 'info' },
});

export type ButtonVariants = VariantProps<typeof buttonVariants>;
export type AlertVariants = VariantProps<typeof alertVariants>;
