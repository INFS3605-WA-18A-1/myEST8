// Small enhancements for every page. Pages work without this file: it only adds
// confirm dialogs, a guard against double submits, dismissable flash messages
// and closing the phone menu.

(() => {
  // Forms with data-confirm (postButton's `confirm`) ask first. A form already
  // on its way isn't sent twice; the guard lifts after a while in case the
  // response didn't navigate (a download, say).
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
      event.preventDefault();
      return;
    }
    if (form.dataset.submitting) {
      event.preventDefault();
      return;
    }
    form.dataset.submitting = 'true';
    form.setAttribute('aria-busy', 'true');
    setTimeout(() => release(form), 8000);
  });

  function release(form) {
    delete form.dataset.submitting;
    form.removeAttribute('aria-busy');
  }

  // Coming back with the browser's Back button restores the page as it was left.
  window.addEventListener('pageshow', () => document.querySelectorAll('form[data-submitting]').forEach(release));

  // Flash messages get a close button; "ok" ones also fade after a while,
  // unless the pointer or focus is on them. Errors stay until closed.
  for (const flash of document.querySelectorAll('[data-flash]')) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-ghost btn-sm btn-square';
    close.setAttribute('aria-label', 'Dismiss message');
    close.textContent = '×';
    close.addEventListener('click', () => flash.remove());
    flash.append(close);
    if (flash.dataset.flash === 'ok') {
      const fade = () => (flash.matches(':hover, :focus-within') ? setTimeout(fade, 2000) : flash.remove());
      setTimeout(fade, 8000);
    }
  }

  // Drop ?ok= / ?error= from the address bar so a reload doesn't repeat the message.
  const url = new URL(window.location.href);
  if (url.searchParams.has('ok') || url.searchParams.has('error')) {
    url.searchParams.delete('ok');
    url.searchParams.delete('error');
    window.history.replaceState(window.history.state, '', url);
  }

  // The phone menu (<details class="dropdown">) closes on a click elsewhere or Escape.
  const openMenus = () => document.querySelectorAll('details.dropdown[open]');
  document.addEventListener('click', (event) => {
    for (const menu of openMenus()) if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const menu of openMenus()) {
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
})();
