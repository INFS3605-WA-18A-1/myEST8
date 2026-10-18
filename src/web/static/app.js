// Small enhancements for every page. Pages work without this file: it only adds
// confirm dialogs, a guard against double submits, dismissable flash messages,
// the drawer that opens the rail under 1024px, collapsing the rail from 1024px,
// and closing the user menu.

(() => {
  // A button with data-fill="<input id>" and data-value puts that value in the input (a quick choice of time).
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-fill]') : null;
    const input = button && document.getElementById(button.dataset.fill);
    if (input instanceof HTMLInputElement) {
      input.value = button.dataset.value ?? '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

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

  // Flash messages get a close button (Phosphor's x, like every other icon); "ok"
  // ones also fade after a while, unless the pointer or focus is on them. Errors
  // stay until closed.
  const X_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16" aria-hidden="true" focusable="false"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>';
  for (const flash of document.querySelectorAll('[data-flash]')) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-ghost btn-sm btn-square flash-close';
    close.setAttribute('aria-label', 'Dismiss message');
    close.innerHTML = X_ICON;
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

  // The drawer: under 1024px the rail slides in from the left, opened by the
  // menu button in the top bar. Escape, the scrim or a larger screen closes it
  // and the focus goes back to the button (or stays put, on a larger screen).
  const shell = document.querySelector('[data-shell]');
  const toggle = document.querySelector('[data-drawer-toggle]');
  const content = document.getElementById('main');
  const scrim = document.querySelector('[data-drawer-scrim]');
  const wide = window.matchMedia('(min-width: 64rem)');

  function setDrawer(open, returnFocus = false) {
    if (!shell || !toggle) return;
    shell.classList.toggle('drawer-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (content) content.inert = open;
    if (open) {
      document.querySelector('#rail a')?.focus();
    } else if (returnFocus) {
      toggle.focus();
    }
  }

  toggle?.addEventListener('click', () => setDrawer(!shell.classList.contains('drawer-open')));
  scrim?.addEventListener('click', () => setDrawer(false, true));
  wide.addEventListener('change', (event) => {
    if (event.matches) setDrawer(false);
  });

  // Collapse menu (from 1024px): folds the rail to its icons. head() sets the class
  // before the first paint from localStorage, so pages don't jump; this keeps the
  // button's words and aria-expanded in step and remembers the choice.
  const railToggle = document.querySelector('[data-rail-toggle]');
  const root = document.documentElement;

  function showRail() {
    const collapsed = root.classList.contains('rail-collapsed');
    railToggle.setAttribute('aria-expanded', String(!collapsed));
    railToggle.querySelector('.rail-label').textContent = collapsed ? 'Expand menu' : 'Collapse menu';
  }

  if (railToggle) {
    showRail();
    railToggle.addEventListener('click', () => {
      const collapsed = root.classList.toggle('rail-collapsed');
      try {
        if (collapsed) localStorage.setItem('rail', 'collapsed');
        else localStorage.removeItem('rail');
      } catch {
        // Storage blocked: the choice lasts until the next page.
      }
      showRail();
    });
  }

  // The Property Manager's menu (<details data-menu>) closes on a click elsewhere or Escape.
  const openMenus = () => document.querySelectorAll('details[data-menu][open]');
  document.addEventListener('click', (event) => {
    for (const menu of openMenus()) if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (shell?.classList.contains('drawer-open')) {
      setDrawer(false, true);
      return;
    }
    for (const menu of openMenus()) {
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
})();

// === share ===
// The Share panel (src/web/share.ts) is a <details> that works without this:
// here it gains Copy link (with a fallback that selects the link), the phone's
// own share sheet where there is one, a close button, and closing on Escape, a
// click elsewhere or after picking a channel. Only one panel is open at a time.
(() => {
  const shares = [...document.querySelectorAll('details[data-share]')];
  if (!shares.length) return;

  const close = (share, returnFocus = false) => {
    share.open = false;
    if (returnFocus) share.querySelector('summary')?.focus();
  };

  for (const share of shares) {
    const input = share.querySelector('[data-share-url]');
    const status = share.querySelector('[data-share-status]');
    const copy = share.querySelector('[data-share-copy]');
    const native = share.querySelector('[data-share-native]');
    const closeButton = share.querySelector('[data-share-close]');
    let clear;

    const say = (message) => {
      status.textContent = message;
      clearTimeout(clear);
      clear = setTimeout(() => (status.textContent = ''), 5000);
    };
    const selectLink = () => {
      input.focus();
      input.select();
      input.setSelectionRange(0, input.value.length);
    };

    if (copy) {
      copy.hidden = false;
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(input.value);
          say('Link copied');
        } catch {
          selectLink();
          say('The link is selected: copy it with Ctrl+C, or Cmd+C on a Mac.');
        }
      });
    }

    if (native && typeof navigator.share === 'function') {
      native.hidden = false;
      native.querySelector('button')?.addEventListener('click', async () => {
        try {
          await navigator.share({ title: share.dataset.shareTitle, text: share.dataset.shareText, url: input.value });
          close(share, true);
        } catch (error) {
          if (error?.name !== 'AbortError') say("Your device's share options didn't open. Copy the link instead.");
        }
      });
    }

    if (closeButton) {
      closeButton.hidden = false;
      closeButton.addEventListener('click', () => close(share, true));
    }

    input.addEventListener('focus', () => input.select());
    for (const link of share.querySelectorAll('[data-share-channel]')) link.addEventListener('click', () => close(share));

    share.addEventListener('toggle', () => {
      if (!share.open) {
        status.textContent = '';
        return;
      }
      for (const other of shares) if (other !== share) other.open = false;
      // A panel opened near the bottom of a long page is brought into view.
      if (!window.matchMedia('(max-width: 39.99rem)').matches) share.querySelector('.share-panel')?.scrollIntoView({ block: 'nearest' });
    });
  }

  document.addEventListener('click', (event) => {
    for (const share of shares) if (share.open && !share.contains(event.target)) close(share);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const share of shares) if (share.open) close(share, share.contains(document.activeElement));
  });
})();

// === landing ===
// The landing page's workflow loops, so it gets a pause button (WCAG 2.2.2). The
// button is hidden in the markup and only shown here, where it can work; with
// less motion asked for there is nothing moving, so it stays hidden.
(() => {
  const flow = document.querySelector('[data-flow]');
  const pause = flow?.querySelector('[data-flow-pause]');
  if (!flow || !pause) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const label = pause.querySelector('[data-flow-pause-label]');
  pause.hidden = false;
  pause.addEventListener('click', () => {
    const paused = !flow.hasAttribute('data-paused');
    flow.toggleAttribute('data-paused', paused);
    if (label) label.textContent = paused ? 'Play' : 'Pause';
  });
})();

// === import ===
// The review page's "Add N Properties" button counts the ticked rows as they're
// ticked. Without this file the count is the one the page was drawn with.
(() => {
  const form = document.querySelector('[data-import-rows]');
  const add = form?.querySelector('[data-import-add]');
  if (!form || !add) return;
  const status = form.querySelector('[data-import-count]');
  const { nounOne, nounMany } = form.dataset;
  const update = () => {
    const ticked = [...form.querySelectorAll('input[name="include"]:checked')];
    const ready = ticked.filter((box) => box.closest('tr')?.dataset.status !== 'needs_fix').length;
    const fixing = ticked.length - ready;
    add.textContent = `Add ${ready} ${ready === 1 ? nounOne : nounMany}`;
    if (status) status.textContent = fixing ? `Plus ${fixing} ticked ${fixing === 1 ? 'row that needs' : 'rows that need'} a fix: fill in the flagged cells to add ${fixing === 1 ? 'it' : 'them'} too.` : '';
  };
  form.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === 'include') update();
  });
})();

// === copy ===
// A button with data-copy-for="<input id>" copies that field. Without this file
// the field is still there to copy by hand.
(() => {
  for (const button of document.querySelectorAll('[data-copy-for]')) {
    button.addEventListener('click', async () => {
      const input = document.getElementById(button.getAttribute('data-copy-for'));
      if (!(input instanceof HTMLInputElement)) return;
      const label = button.textContent;
      try {
        await navigator.clipboard.writeText(input.value);
        button.textContent = 'Copied';
        setTimeout(() => {
          button.textContent = label;
        }, 2000);
      } catch {
        input.focus();
        input.select();
      }
    });
  }
})();

// === direct upload ===
// The Tenant upload form (data-direct-upload="<token>") sends its files straight to
// storage, because a hosted function accepts only about 4 MB per request. When the
// server says it has no storage (direct: false) or anything fails, the form is
// submitted the ordinary way, so it still works without this file.
(() => {
  const form = document.querySelector('form[data-direct-upload]');
  if (!(form instanceof HTMLFormElement)) return;
  const token = encodeURIComponent(form.dataset.directUpload);
  const input = form.querySelector('input[type=file]');
  const post = (path, body) => fetch(`/api/u/${token}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let plain = false;
  form.addEventListener('submit', async (event) => {
    if (plain || !(input instanceof HTMLInputElement) || !input.files?.length) return;
    event.preventDefault();
    const button = form.querySelector('button[type=submit], button:not([type])');
    if (button instanceof HTMLButtonElement) button.disabled = true;
    const fallback = () => {
      plain = true;
      if (button instanceof HTMLButtonElement) button.disabled = false;
      // The page-wide double-submit guard marked this form busy when the first submit was stopped.
      delete form.dataset.submitting;
      form.removeAttribute('aria-busy');
      form.requestSubmit();
    };
    try {
      const files = [...input.files];
      const prepared = await post('prepare', { files: files.map((f) => ({ filename: f.name })) });
      if (!prepared.ok) return fallback();
      const { direct, slots } = await prepared.json();
      if (!direct) return fallback();
      for (const [i, file] of files.entries()) {
        const put = await fetch(slots[i].url, { method: 'PUT', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
        if (!put.ok) throw new Error('upload');
      }
      const done = await post('complete', { files: files.map((f, i) => ({ path: slots[i].path, filename: f.name, contentType: f.type })) });
      if (!done.ok) throw new Error('complete');
      location.assign(`/u/${token}?ok=${files.length}`);
    } catch {
      fallback();
    }
  });
})();

// === filter bar ===
// A filter bar's selects apply as soon as one changes, so its Apply button is only
// for pages without this file.
(() => {
  for (const form of document.querySelectorAll('form[data-autosubmit]')) {
    form.addEventListener('change', () => form.requestSubmit());
    form.querySelector('.filter-bar-apply')?.setAttribute('hidden', '');
  }
})();
