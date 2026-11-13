// The flash after an action, as a toast. The server still draws each flash in the page
// (ui.ts flashMessage), so without JavaScript it stays where it was; here it moves into Sonner,
// which stacks them, pauses while the pointer or focus is on one, and lets them be swiped away.
// Each toast is a Night slip (.flash-toast in app.css, the same one the landing's demo shows):
// the server's filled Phosphor mark and the words, with `status` or `alert` as before.

import { toast, Toaster } from 'sonner';

/** "ok" flashes fade after 8 s; errors stay until closed. */
const OK_MS = 8000;

export function FlashToaster() {
  return <Toaster position="bottom-right" visibleToasts={3} offset={16} mobileOffset={12} gap={8} toastOptions={{ unstyled: true }} />;
}

function FlashToast(props: { id: string | number; error: boolean; message: string; icon: string }) {
  return (
    <div role={props.error ? 'alert' : 'status'} className={props.error ? 'flash-toast is-error' : 'flash-toast'}>
      <span className="flash-toast-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: props.icon }} />
      <span className="flash-toast-words">
        <span className="sr-only">{props.error ? 'Error: ' : 'Done: '}</span>
        {props.message}
      </span>
      <button type="button" className="btn btn-ghost btn-sm btn-square flash-close" aria-label="Dismiss message" onClick={() => toast.dismiss(props.id)}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
        </svg>
      </button>
    </div>
  );
}

/** Moves every server-drawn flash under `root` into a toast, and takes it out of the page. */
export function toastFlashes(root: ParentNode) {
  const flashes = root instanceof Element && root.matches('[data-flash]') ? [root] : [...root.querySelectorAll('[data-flash]')];
  for (const flash of flashes) {
    if (!(flash instanceof HTMLElement)) continue;
    const error = flash.dataset.flash === 'error';
    const message = flash.dataset.flashMessage ?? '';
    // The icon is the server's own Phosphor SVG, built by ui.ts, never anything typed.
    const icon = flash.querySelector('svg')?.outerHTML ?? '';
    flash.remove();
    toast.custom((id) => <FlashToast id={id} error={error} message={message} icon={icon} />, { duration: error ? Infinity : OK_MS });
  }
}
