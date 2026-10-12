// Side effects of loading the design system: the theme first, then Tailwind's
// browser build (the same one the app serves as /assets/tailwind.js), which
// generates any Tailwind utility used on the page.
import './theme.ts';
import '@tailwindcss/browser';
