// What every myEST8 page sets up in its <head> (src/web/ui.ts head()): the "myest8"
// daisyUI theme on <html>, and the Tailwind theme that names the design tokens for
// Tailwind's browser build, which runtime/init.ts starts next.

declare const __TAILWIND_THEME__: string;

if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = 'myest8';
  if (!document.querySelector('style[data-myest8-theme]')) {
    const style = document.createElement('style');
    style.type = 'text/tailwindcss';
    style.dataset.myest8Theme = '';
    style.textContent = __TAILWIND_THEME__;
    document.head.append(style);
  }
}
