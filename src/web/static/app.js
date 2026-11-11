// Small enhancements for every page. Pages work without this file: it only adds
// confirm dialogs, a guard against double submits, dismissable flash messages,
// the drawer that opens the rail under 1024px, collapsing the rail from 1024px,
// closing the user menu, a loading bar, and in-page navigation (at the end).

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const motionMs = (token) => (reduceMotion.matches ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)) || 0);
const motionEase = (token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim() || 'cubic-bezier(0.25, 1, 0.5, 1)';

/** Closes a disclosure after its panel has left, so the close is quicker than the open. */
function closeDisclosure(details, { focusSummary = false } = {}) {
  if (!details.open || details.classList.contains('is-closing')) return;
  if (focusSummary) details.querySelector(':scope > summary')?.focus();
  details.classList.add('is-closing');
  // Flush so the close animation is running before we wait on it.
  void details.offsetWidth;
  const anims = [...details.querySelectorAll(':scope > :not(summary), .share-panel')].flatMap((el) => el.getAnimations());
  Promise.allSettled(anims.map((a) => a.finished)).then(() => {
    details.classList.remove('is-closing');
    details.open = false;
  });
}

/** Collapses a flash, then removes it. With no motion it goes at once. */
function dismissFlash(flash) {
  const ms = motionMs('--dur-base');
  if (!ms || !flash.animate) return flash.remove();
  const gap = parseFloat(getComputedStyle(flash.parentElement).rowGap) || 0;
  flash.style.overflow = 'hidden';
  flash
    .animate(
      [
        { opacity: 1, height: `${flash.offsetHeight}px` },
        { opacity: 0, height: '0px', paddingBlock: '0px', borderWidth: '0px', marginBlockEnd: `${-gap}px` },
      ],
      { duration: ms, easing: motionEase('--ease-exit'), fill: 'forwards' },
    )
    .finished.finally(() => flash.remove());
}

let viewTransition;
/** Cross-fades a DOM update. Skipped when the browser can't, motion is reduced, or the tab is hidden. */
function swapView(update) {
  if (!document.startViewTransition || reduceMotion.matches || document.hidden) {
    update();
    return Promise.resolve();
  }
  viewTransition?.skipTransition();
  viewTransition = document.startViewTransition(update);
  return viewTransition.updateCallbackDone;
}

// Back and Forward load a page afresh (signed-in pages are sent no-store), but the browser
// still puts back what was typed or picked in its forms when the page was left. The page
// shows things as they are now, so the forms go back to what the server sent, before
// anything below reads them.
if (performance.getEntriesByType?.('navigation')[0]?.type === 'back_forward') {
  for (const form of document.forms) form.reset();
}

if (document.querySelector('.glance-list')) {
  try {
    sessionStorage.setItem('glance', '1');
  } catch {
    // Storage blocked: the pips may fill in again next time.
  }
  // Mine/All swaps #main without reloading, so the head script that sets glance-seen
  // doesn't run again: set it on the first swap so the new pips don't fill in twice.
  document.addEventListener('myest8:content', () => document.documentElement.classList.add('glance-seen'), { once: true });
}

// Setup for elements in the page goes through onContent: it runs on the document
// now, and again on #main's new content after an in-page navigation.
function onContent(setup) {
  setup(document);
  document.addEventListener('myest8:content', (event) => setup(event.detail));
}

// The Mine/All thumb. Without this the current item stays filled, as the page drew it.
onContent((root) => {
  for (const nav of root.querySelectorAll('.segmented')) {
    if (nav.querySelector('.segmented-thumb')) continue;
    const thumb = document.createElement('span');
    thumb.className = 'segmented-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    nav.prepend(thumb);
    nav.classList.add('has-thumb');
    const place = (item) => {
      nav.style.setProperty('--thumb-x', `${item.offsetLeft}px`);
      nav.style.setProperty('--thumb-w', `${item.offsetWidth}px`);
    };
    const current = () => nav.querySelector("[aria-current='page']");
    const now = current();
    if (now) place(now);
    document.fonts.ready.then(() => {
      const item = current();
      if (item && nav.isConnected) place(item);
    });
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        const item = current();
        if (item) place(item);
      }).observe(nav);
    }
    requestAnimationFrame(() => nav.classList.add('is-ready'));
    nav.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const item = event.target instanceof Element ? event.target.closest('.segmented-item') : null;
      if (!(item instanceof HTMLElement) || item.getAttribute('aria-current') === 'page') return;
      item.classList.add('is-target');
      nav.classList.add('is-moving');
      place(item);
    });
  }
});

// A rail count that changed since the last page in this tab pops once.
try {
  const previous = JSON.parse(sessionStorage.getItem('rail-counts') || '{}');
  const next = {};
  for (const count of document.querySelectorAll('.rail-count')) {
    const href = count.closest('a')?.getAttribute('href');
    if (!href) continue;
    const value = count.textContent.replace(/\s+/g, ' ').trim();
    next[href] = value;
    if (href in previous && previous[href] !== value) count.classList.add('is-changed');
  }
  sessionStorage.setItem('rail-counts', JSON.stringify(next));
} catch {
  // Storage blocked: the counts stay still.
}

(() => {
  // A button with data-fill="<input id>" and data-value puts that value in the input (a quick choice of time).
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-fill]') : null;
    const input = button && document.getElementById(button.dataset.fill);
    if (input instanceof HTMLInputElement) {
      input.value = button.dataset.value ?? '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      markFilled(input);
    }
  });
  // The quick choice that matches the input is marked pressed, so it is clear which one is in use.
  function markFilled(input) {
    for (const choice of document.querySelectorAll(`[data-fill="${input.id}"]`)) choice.setAttribute('aria-pressed', String(choice.dataset.value === input.value));
  }
  const markAll = () => {
    for (const choice of document.querySelectorAll('[data-fill][aria-pressed]')) {
      const input = document.getElementById(choice.dataset.fill);
      if (input instanceof HTMLInputElement) markFilled(input);
    }
  };
  markAll();
  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.id) markFilled(event.target);
  });

  // Forms with data-confirm (postButton's `confirm`) ask first, in a small panel beside the
  // button rather than the browser's own dialog: the question, the action again (in red)
  // and "Keep it". A form already on its way isn't sent twice; the guard lifts after a
  // while in case the response didn't navigate (a download, say).
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.confirm && form.dataset.confirmed !== 'true') {
      event.preventDefault();
      if (typeof HTMLElement.prototype.showPopover !== 'function') {
        if (window.confirm(form.dataset.confirm)) send(form, event.submitter);
        return;
      }
      askFirst(form, event.submitter);
      return;
    }
    delete form.dataset.confirmed;
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

  function send(form, submitter) {
    form.dataset.confirmed = 'true';
    form.requestSubmit(submitter instanceof HTMLElement && submitter.form === form ? submitter : null);
  }

  // The confirm panel: a popover (Escape or a click elsewhere closes it), placed under the
  // button that asked, or over it when there is no room below.
  function askFirst(form, submitter) {
    document.querySelector('.confirm-pop')?.remove();
    const anchor = submitter instanceof HTMLElement ? submitter : form;
    const panel = document.createElement('div');
    panel.className = 'confirm-pop';
    panel.popover = 'auto';
    panel.setAttribute('role', 'alertdialog');
    const text = document.createElement('p');
    text.className = 'confirm-pop-text';
    text.id = `confirm-pop-${Date.now()}`;
    text.textContent = form.dataset.confirm;
    panel.setAttribute('aria-labelledby', text.id);
    const actions = document.createElement('div');
    actions.className = 'confirm-pop-actions';
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'btn btn-sm btn-ghost';
    keep.textContent = 'Keep it';
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'btn btn-sm btn-danger';
    yes.textContent = form.dataset.confirmYes || anchor.textContent.trim() || 'Yes';
    actions.append(keep, yes);
    panel.append(text, actions);
    document.body.append(panel);
    panel.showPopover();
    const rect = anchor.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const below = rect.bottom + 8 + height <= window.innerHeight;
    panel.style.left = `${left}px`;
    panel.style.top = `${below ? rect.bottom + 8 : Math.max(8, rect.top - height - 8)}px`;
    let sending = false;
    keep.addEventListener('click', () => panel.hidePopover());
    yes.addEventListener('click', () => {
      sending = true;
      panel.hidePopover();
      send(form, submitter);
    });
    panel.addEventListener('toggle', (e) => {
      if (e.newState !== 'closed') return;
      panel.remove();
      if (!sending && anchor.isConnected) anchor.focus();
    });
    yes.focus();
  }

  // Coming back with the browser's Back button restores the page as it was left.
  window.addEventListener('pageshow', () => document.querySelectorAll('form[data-submitting]').forEach(release));

  // Flash messages get a close button (Phosphor's x, like every other icon); "ok"
  // ones also fade after a while, unless the pointer or focus is on them. Errors
  // stay until closed.
  const X_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16" aria-hidden="true" focusable="false"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>';
  onContent((root) => {
    const flashes = root instanceof Element && root.matches('[data-flash]') ? [root] : [...root.querySelectorAll('[data-flash]')];
    for (const flash of flashes) {
      if (flash.querySelector('.flash-close')) continue;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'btn btn-ghost btn-sm btn-square flash-close';
      close.setAttribute('aria-label', 'Dismiss message');
      close.innerHTML = X_ICON;
      close.addEventListener('click', () => dismissFlash(flash));
      flash.append(close);
      if (flash.dataset.flash === 'ok') {
        const fade = () => (flash.matches(':hover, :focus-within') ? setTimeout(fade, 2000) : dismissFlash(flash));
        setTimeout(fade, 8000);
      }
    }
  });

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
    for (const menu of openMenus()) if (!menu.contains(event.target)) closeDisclosure(menu);
  });
  document.addEventListener(
    'click',
    (event) => {
      const summary = event.target instanceof Element ? event.target.closest('details[data-menu][open] > summary, details[data-share][open] > summary') : null;
      if (!summary) return;
      event.preventDefault();
      closeDisclosure(summary.parentElement);
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (shell?.classList.contains('drawer-open')) {
      setDrawer(false, true);
      return;
    }
    for (const menu of openMenus()) closeDisclosure(menu, { focusSummary: true });
  });
})();

// === share ===
// The Share panel (src/web/share.ts) is a <details> that works without this:
// here it gains Copy link (with a fallback that selects the link), the phone's
// own share sheet where there is one, a close button, and closing on Escape, a
// click elsewhere or after picking a channel. Only one panel is open at a time.
(() => {
  const allShares = () => document.querySelectorAll('details[data-share]');

  const close = (share, returnFocus = false) => closeDisclosure(share, { focusSummary: returnFocus });

  onContent((root) => {
    for (const share of root.querySelectorAll('details[data-share]')) {
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
        for (const other of allShares()) if (other !== share) closeDisclosure(other);
        // A panel opened near the bottom of a long page is brought into view.
        if (!window.matchMedia('(max-width: 39.99rem)').matches) share.querySelector('.share-panel')?.scrollIntoView({ block: 'nearest' });
      });
    }
  });

  document.addEventListener('click', (event) => {
    for (const share of allShares()) if (share.open && !share.contains(event.target)) close(share);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const share of allShares()) if (share.open) close(share, share.contains(document.activeElement));
  });
})();

// === password ===
// The Show / Hide button inside a password field (the sign-up form). Its label and
// text say what pressing it will do, and it never changes what the field posts.
onContent((root) => {
  for (const toggle of root.querySelectorAll('[data-reveal]')) {
    if (toggle.dataset.ready) continue;
    toggle.dataset.ready = '1';
    const input = document.getElementById(toggle.dataset.reveal);
    if (!(input instanceof HTMLInputElement)) continue;
    toggle.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      toggle.textContent = showing ? 'Show' : 'Hide';
    });
  }
});

// === landing ===
// The landing page's sections rise into view as they reach the screen, their parts
// in reading order. landing.css only hides [data-rise] when this file has run
// (html.js), and anyone who asks for less motion sees them in place.
(() => {
  const parts = [...document.querySelectorAll('.lp [data-rise]')];
  if (!parts.length) return;
  const show = (el) => el.classList.add('is-in');
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    parts.forEach(show);
    return;
  }
  // Number each part within its section, so the parts of one section stagger.
  for (const section of new Set(parts.map((el) => el.closest('section, aside') ?? document.body))) {
    parts.filter((el) => (el.closest('section, aside') ?? document.body) === section).forEach((el, i) => el.style.setProperty('--rise-i', String(i)));
  }
  // Anything already on screen (or above it, after a hash jump) is shown at once: a
  // deep link must never land on a hidden section, and a full-page capture or print
  // must not leave blank bands.
  const inView = (el) => el.getBoundingClientRect().top < window.innerHeight + 200;
  parts.filter(inView).forEach(show);
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        show(entry.target);
        seen.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px 200px 0px' },
  );
  for (const el of parts) if (!el.classList.contains('is-in')) seen.observe(el);
  // A link to a section further down scrolls first, then its parts are in view.
  window.addEventListener('hashchange', () => requestAnimationFrame(() => parts.filter(inView).forEach(show)));
})();

// === import ===
// The review page's "Add N Properties" button counts the ticked rows as they're
// ticked. Without this file the count is the one the page was drawn with.
onContent((root) => {
  const form = root.querySelector('[data-import-rows]');
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
});

// === copy ===
// A button with data-copy-for="<input id>" copies that field. Without this file
// the field is still there to copy by hand.
onContent((root) => {
  for (const button of root.querySelectorAll('[data-copy-for]')) {
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
});

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
      // A receipt's form also says how much the Tenant claims.
      const amount = form.querySelector('input[name=amount]');
      const done = await post('complete', {
        files: files.map((f, i) => ({ path: slots[i].path, filename: f.name, contentType: f.type })),
        ...(amount instanceof HTMLInputElement && amount.value.trim() ? { amount: amount.value } : {}),
      });
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
onContent((root) => {
  for (const form of root.querySelectorAll('form[data-autosubmit]')) {
    form.addEventListener('change', () => form.requestSubmit());
    form.querySelector('.filter-bar-apply')?.setAttribute('hidden', '');
  }
});

// === live lists ===
// A form[data-live] (the Archive) refreshes in place instead of loading a new page: a
// select, tab or date applies at once, its search box [data-live-search] a moment after
// typing stops, and a link marked [data-live-link] (a filter chip) is followed the same way.
// The new page's [data-live-region] elements replace this one's by id, and the address bar
// follows, so the search box keeps its focus and caret. Anything unexpected falls back to
// an ordinary page load.
(() => {
  const form = document.querySelector('form[data-live]');
  if (!form) return;
  form.querySelector('.filter-bar-apply')?.setAttribute('hidden', '');
  let controller = null;
  let timer = 0;

  // Only what differs from the defaults goes in the address: a select left on its first option is left out.
  const urlOf = () => {
    const params = new URLSearchParams();
    for (const [name, value] of new FormData(form)) {
      if (typeof value !== 'string' || value.trim() === '') continue;
      const select = form.querySelector(`select[name="${CSS.escape(name)}"]`);
      if (select instanceof HTMLSelectElement && select.options[0]?.value === value) continue;
      params.append(name, value.trim());
    }
    const query = params.toString();
    return `${form.getAttribute('action')}${query ? `?${query}` : ''}`;
  };

  async function load(url) {
    controller?.abort();
    controller = new AbortController();
    document.documentElement.setAttribute('data-live-loading', '');
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { accept: 'text/html' } });
      if (!res.ok || !res.headers.get('content-type')?.includes('text/html')) throw new Error(String(res.status));
      const next = new DOMParser().parseFromString(await res.text(), 'text/html');
      const focused = document.activeElement;
      const focusName = focused instanceof HTMLElement && focused.closest('[data-live-region]') ? focused.getAttribute('name') : null;
      for (const region of document.querySelectorAll('[data-live-region]')) {
        const fresh = next.getElementById(region.id);
        if (!fresh) continue;
        region.replaceWith(fresh);
        document.dispatchEvent(new CustomEvent('myest8:content', { detail: fresh }));
      }
      // The search and sort live outside the regions; a chip or Clear all that resets them has to reset them here.
      const params = new URL(url, location.href).searchParams;
      for (const control of form.querySelectorAll('input[name]:not([type=hidden]), select[name]')) {
        // Never under the caret: the person may still be typing past what this answer was for.
        if (control.closest('[data-live-region]') || control === document.activeElement) continue;
        const value = params.get(control.name) ?? (control instanceof HTMLSelectElement ? (control.options[0]?.value ?? '') : '');
        if (control.value.trim() !== value) control.value = value;
      }
      if (focusName) form.querySelector(`[data-live-region] [name="${CSS.escape(focusName)}"]`)?.focus();
      history.replaceState(history.state, '', url);
    } catch (error) {
      if (error?.name !== 'AbortError') location.assign(url);
    } finally {
      if (!controller.signal.aborted) document.documentElement.removeAttribute('data-live-loading');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(timer);
    load(urlOf());
  });
  form.addEventListener('change', (event) => {
    // A searchable select's own text box has no name; its select fires the change that counts.
    if (!(event.target instanceof Element) || !event.target.getAttribute('name') || event.target.matches('[data-live-search]')) return;
    clearTimeout(timer);
    load(urlOf());
  });
  form.addEventListener('input', (event) => {
    if (!(event.target instanceof Element) || !event.target.matches('[data-live-search]')) return;
    clearTimeout(timer);
    timer = setTimeout(() => load(urlOf()), 280);
  });
  form.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[data-live-link]') : null;
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    clearTimeout(timer);
    load(link.href);
  });
  // The results sit outside the form; their own "Show more" and "Clear filters" refresh the same way.
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('#ar-results a[href^="/archive"]') : null;
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    load(link.href.replace(/#.*$/, ''));
  });
})();

// === searchable selects ===
// A <select data-combobox> (field's `search`) becomes a text box that filters its
// options as you type: every word typed must appear in the option's label or its
// data-keywords (a Property's suburb and postcode, a Tradie's name). The select stays
// in the form, hidden, and holds the value that is posted; picking an option sets it
// and fires its change event, so a filter bar still applies at once. Without this file
// it is a plain select.
//
// A Nominated Tradies picker ([data-picker]) adds a row of its <template> for each
// "Add Tradie" press, and each row's Remove button takes it away.
(() => {
  let made = 0;

  function enhance(select) {
    if (select.dataset.comboboxReady || select.multiple) return;
    select.dataset.comboboxReady = 'true';
    const n = ++made;
    const options = [...select.options].map((option) => ({
      value: option.value,
      label: option.textContent.trim(),
      text: `${option.textContent} ${option.dataset.keywords || ''}`.toLowerCase(),
    }));
    const blank = options.find((o) => o.value === '');
    const labelOf = (value) => options.find((o) => o.value === value)?.label ?? '';

    const box = document.createElement('div');
    box.className = 'combobox';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = `${select.className.replace(/\bselect\b/g, 'input')} combobox-input`;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.placeholder = blank && blank.label ? blank.label : 'Type to search';
    const list = document.createElement('ul');
    list.className = 'combobox-list';
    list.id = `combobox-${n}-list`;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    input.setAttribute('aria-controls', list.id);

    // The label, hint and error point at the text box now; the select keeps the value.
    if (select.id) {
      input.id = select.id;
      select.id = `${select.id}-value`;
    }
    for (const name of ['aria-describedby', 'aria-invalid', 'aria-label']) {
      if (select.hasAttribute(name)) input.setAttribute(name, select.getAttribute(name));
    }
    input.required = select.required;
    select.required = false;
    select.hidden = true;
    select.tabIndex = -1;
    select.after(box);
    box.append(input, list, select);
    input.value = select.value ? labelOf(select.value) : '';

    let shown = [];
    let active = -1;

    function render(query) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      shown = options.filter((o) => (o.value === '' ? !words.length && blank?.label : words.every((w) => o.text.includes(w))));
      list.replaceChildren(
        ...(shown.length
          ? shown.map((o, i) => {
              const item = document.createElement('li');
              item.id = `combobox-${n}-${i}`;
              item.className = 'combobox-option';
              item.setAttribute('role', 'option');
              item.setAttribute('aria-selected', String(o.value === select.value && o.value !== ''));
              item.textContent = o.label;
              item.addEventListener('mousedown', (event) => event.preventDefault());
              item.addEventListener('click', () => choose(o));
              return item;
            })
          : [Object.assign(document.createElement('li'), { className: 'combobox-empty', textContent: 'No matches' })]),
      );
      setActive(shown.length ? Math.max(0, shown.findIndex((o) => o.value === select.value && o.value !== '')) : -1);
    }

    function setActive(i) {
      active = i;
      for (const item of list.querySelectorAll('[role="option"]')) item.classList.toggle('is-active', item.id === `combobox-${n}-${i}`);
      if (i >= 0) {
        input.setAttribute('aria-activedescendant', `combobox-${n}-${i}`);
        document.getElementById(`combobox-${n}-${i}`)?.scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }

    function open() {
      if (!list.hidden) return;
      render(input.value === labelOf(select.value) ? '' : input.value);
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function choose(o) {
      const changed = select.value !== o.value;
      select.value = o.value;
      input.value = o.value ? o.label : '';
      input.setCustomValidity('');
      close();
      if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    input.addEventListener('focus', () => input.select());
    input.addEventListener('click', open);
    input.addEventListener('input', () => {
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      render(input.value);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (list.hidden) return open();
        if (shown.length) setActive((active + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
      } else if (event.key === 'Enter' && !list.hidden) {
        event.preventDefault();
        if (active >= 0) choose(shown[active]);
      } else if (event.key === 'Escape' && !list.hidden) {
        event.preventDefault();
        input.value = labelOf(select.value);
        close();
      }
    });
    // Leaving the box keeps what was picked: typed words that picked nothing go back to it.
    input.addEventListener('blur', () => {
      close();
      if (!input.value.trim() && select.value && blank) choose(blank);
      else input.value = labelOf(select.value);
    });
    // A required box with nothing picked says so when the form is sent.
    input.addEventListener('invalid', () => input.setCustomValidity(select.value ? '' : 'Choose one from the list'));
  }

  onContent((root) => {
    for (const select of root.querySelectorAll('select[data-combobox]')) enhance(select);

    for (const picker of root.querySelectorAll('[data-picker]')) {
      const rows = picker.querySelector('[data-picker-rows]');
      const template = picker.querySelector('template[data-picker-template]');
      const add = picker.querySelector('[data-picker-add]');
      if (!rows || !template || !add) continue;
      add.hidden = false;
      let count = rows.children.length;
      add.addEventListener('click', () => {
        const row = template.content.firstElementChild.cloneNode(true);
        count += 1;
        for (const element of row.querySelectorAll('[id]')) element.id = `${element.id}-${count}`;
        for (const label of row.querySelectorAll('label[for]')) label.htmlFor = `${label.htmlFor}-${count}`;
        rows.append(row);
        for (const select of row.querySelectorAll('select[data-combobox]')) enhance(select);
        row.querySelector('input, select')?.focus();
      });
      picker.addEventListener('click', (event) => {
        const remove = event.target instanceof Element ? event.target.closest('[data-picker-remove]') : null;
        if (!remove) return;
        const row = remove.closest('[data-picker-row]');
        const next = row?.nextElementSibling || row?.previousElementSibling;
        row?.remove();
        (next?.querySelector('input, select') || add).focus();
      });
    }
  });
})();

// === schedule ===
// The current-time line is placed by the server from the Agency's clock. The
// offset between that instant (data-now) and Date.now() is taken once, and the
// line is not moved on load: the browser clock can disagree. Once a minute the
// line moves to server time plus the time since the page opened. It hides when
// the Agency's date is no longer data-today, or the clock is outside the hours
// shown. There is no transition, so it never animates, including when less
// motion is asked for.
(() => {
  let timer;
  onContent((root) => {
    const line = root.querySelector('[data-schedule-now]');
    clearInterval(timer);
    if (line) {
      const zone = line.dataset.zone;
      const first = Number(line.dataset.first);
      const last = Number(line.dataset.last);
      const header = line.dataset.header === '1';
      const serverNow = Number(line.dataset.now);
      const today = line.dataset.today;
      const opened = Date.now();
      const place = () => {
        const when = new Date(serverNow + (Date.now() - opened));
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: 'numeric',
          minute: 'numeric',
        }).formatToParts(when);
        const part = (type) => parts.find((p) => p.type === type)?.value ?? '';
        const date = `${part('year')}-${part('month')}-${part('day')}`;
        const mins = Number(part('hour')) * 60 + Number(part('minute'));
        const start = first * 60;
        line.hidden = date !== today || mins < start || mins >= last * 60;
        const into = mins - start;
        line.style.gridRow = String(Math.floor(into / 15) + (header ? 2 : 1));
        const fraction = ((into % 15) + 15) % 15;
        line.style.setProperty('--now-frac', String(fraction / 15));
      };
      timer = setInterval(place, 60_000);
    }

    // The server marks the hour the grid should open on (an hour before the first
    // visit, or 7 am). Scroll the frame to it; without this file the grid starts
    // at the top, which is still the working day.
    const open = root.querySelector('[data-schedule-open]');
    const frame = open?.closest('.schedule-scroll');
    if (open && frame) {
      const header = frame.querySelector('.schedule-col-title');
      const headerHeight = header ? header.getBoundingClientRect().height : 0;
      const top = open.getBoundingClientRect().top - frame.getBoundingClientRect().top + frame.scrollTop;
      frame.scrollTop = Math.max(0, top - headerHeight);
    }
  });
})();

// === schedule: picked visit and visit types ===
// Clicking a visit on the grid shows its details in the Picked visit panel instead of
// opening its Ticket, when the screen is 1280px or wider. The panel's Open Ticket
// button, a modified click and a narrow screen all still go to the Ticket. The Visit kind
// boxes hide the blocks of a kind by setting data-hide on the Schedule; both are hidden
// until this file runs, since neither does anything without it.
onContent((root) => {
  const shell = root.querySelector('[data-schedule-shell]');
  if (!shell) return;
  const panel = shell.querySelector('[data-pick-panel]');
  if (panel) {
    panel.hidden = false;
    shell.classList.add('has-pick');
    const wide = matchMedia('(min-width: 80rem)');
    const empty = panel.querySelector('[data-pick-empty]');
    const close = panel.querySelector('[data-pick-close]');
    const show = (id) => {
      for (const card of panel.querySelectorAll('[data-pick-card]')) card.hidden = card.dataset.pickCard !== id;
      for (const block of shell.querySelectorAll('[data-pick]')) block.classList.toggle('is-picked', block.dataset.pick === id);
      empty.hidden = id !== null;
      close.hidden = id === null;
      shell.classList.toggle('is-open', id !== null);
    };
    shell.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const block = event.target.closest('[data-pick]');
      if (!block || !wide.matches) return;
      if (event.target.closest('.schedule-block-tradie, .booking-reschedule')) return;
      event.preventDefault();
      show(block.dataset.pick);
    });
    close.addEventListener('click', () => show(null));
  }
  const boxes = [...shell.querySelectorAll('[data-hide-key]')];
  const all = shell.querySelector('[data-hide-all]');
  if (all) {
    for (const group of shell.querySelectorAll('[data-needs-script]')) group.hidden = false;
    const apply = () => {
      shell.dataset.hide = boxes.filter((box) => !box.checked).map((box) => box.dataset.hideKey).join(' ');
      all.checked = boxes.every((box) => box.checked);
    };
    all.addEventListener('change', () => {
      for (const box of boxes) box.checked = all.checked;
      apply();
    });
    for (const box of boxes) box.addEventListener('change', apply);
  }
});

// === Profiles: the Ticket history button ===
// Each household lists its open Tickets under the card. With this file running the list is
// folded away behind its Ticket history button; without it the Tickets are just listed.
onContent((root) => {
  for (const button of root.querySelectorAll('[data-history-toggle]')) {
    const panel = root.querySelector(`#${button.getAttribute('aria-controls')}`);
    if (!panel) continue;
    button.hidden = false;
    panel.hidden = true;
    button.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    });
  }
});

// === Profiles lists: the toolbar's search narrows the rows ===
// On Properties, Tenants, Property Owners, Tradies and Building Managers the search hides the
// rows that don't hold every word typed, and says so when none is left. Without this file
// the box is hidden and every row shows.
onContent((root) => {
  for (const input of root.querySelectorAll('input[data-list-filter]')) {
    const scope = input.closest('.profiles-card')?.querySelector('[data-list-scope]');
    if (!scope) continue;
    const none = scope.querySelector('[data-list-none]');
    input.addEventListener('input', () => {
      const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const row of scope.querySelectorAll('tbody tr')) {
        const text = row.textContent.toLowerCase();
        row.hidden = !words.every((word) => text.includes(word));
        if (!row.hidden) shown++;
      }
      if (none) none.hidden = shown > 0 || !words.length;
    });
  }
});

// === Profiles: a Property photo that will not load ===
// A household's photo is found for its address. When the file is gone or the address finds
// nothing, the broken picture is swapped for the quiet empty slot (a dashed box) rather
// than leaving a blank square. Image errors do not bubble, so this listens in capture.
const photoGone = (img) => img.closest('.household-photo-slot')?.classList.add('is-empty');
document.addEventListener(
  'error',
  (event) => {
    if (event.target instanceof HTMLImageElement && event.target.classList.contains('household-photo')) photoGone(event.target);
  },
  true,
);
onContent((root) => {
  for (const img of root.querySelectorAll('img.household-photo')) if (img.complete && img.currentSrc && img.naturalWidth === 0) photoGone(img);
});

// === photo viewer ===
// A photoGrid ([data-photo-grid]) is a list of links to full images, which open in
// the same tab without this file. Here a click on one opens that grid's photos in
// a <dialog> over the page, built once with DOM calls and reused by every grid.
(() => {
  // Phosphor's caret-left, caret-right and x, written out as the flash message's x is above.
  const PATHS = {
    previous: 'M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z',
    next: 'M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z',
    close: 'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z',
  };

  let viewer;
  let photos = [];
  let index = 0;
  let opener;

  function iconButton(name, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `photo-viewer-button is-${name}`;
    button.setAttribute('aria-label', label);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 256 256');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', PATHS[name]);
    svg.append(path);
    button.append(svg);
    button.addEventListener('click', onClick);
    return button;
  }

  function build() {
    const dialog = document.createElement('dialog');
    dialog.className = 'photo-viewer';
    const figure = document.createElement('figure');
    figure.className = 'photo-viewer-figure';
    const image = document.createElement('img');
    image.className = 'photo-viewer-photo';
    image.draggable = false;
    image.addEventListener('load', () => dialog.style.setProperty('--photo-ratio', String(image.naturalWidth / image.naturalHeight)));
    const caption = document.createElement('figcaption');
    caption.className = 'photo-viewer-caption';
    figure.append(image, caption);
    const count = document.createElement('p');
    count.className = 'photo-viewer-count num';
    count.setAttribute('aria-live', 'polite');
    const previous = iconButton('previous', 'Previous photo', () => move(-1));
    const next = iconButton('next', 'Next photo', () => move(1));
    dialog.append(iconButton('close', 'Close', () => dialog.close()), previous, figure, next, count);
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') move(-1);
      else if (event.key === 'ArrowRight') move(1);
    });
    // A drag across the photo. More than 48 px horizontally, and further across than
    // down, steps on: a finger moving left brings the next photo, moving right the
    // previous. The click that follows that drag is swallowed, so releasing over the
    // backdrop does not close the viewer.
    let origin = null;
    let swallowClick = false;
    image.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      origin = { x: event.clientX, y: event.clientY };
      image.setPointerCapture(event.pointerId);
    });
    const endDrag = (event) => {
      if (!origin) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      origin = null;
      if (Math.abs(dx) <= 48 || Math.abs(dx) < Math.abs(dy)) return;
      swallowClick = true;
      move(dx < 0 ? 1 : -1);
    };
    image.addEventListener('pointerup', endDrag);
    image.addEventListener('pointercancel', () => {
      origin = null;
    });
    // The backdrop is the dialog's own empty space: anything but a control, the photo or its words.
    dialog.addEventListener('click', (event) => {
      if (swallowClick) {
        swallowClick = false;
        return;
      }
      if (!event.target.closest('button, img, figcaption, .photo-viewer-count')) dialog.close();
    });
    // Esc, Close and the backdrop all end here. Focus goes back to the photo that opened the viewer.
    dialog.addEventListener('close', () => opener?.focus());
    document.body.append(dialog);
    return { dialog, image, caption, count, steps: [previous, next, count] };
  }

  function show(i) {
    index = i;
    const photo = photos[i];
    viewer.image.src = photo.src;
    viewer.image.alt = photo.alt;
    viewer.caption.textContent = photo.caption;
    // One photo has nothing to step to or count.
    const several = photos.length > 1;
    for (const part of viewer.steps) part.hidden = !several;
    viewer.count.textContent = `${i + 1} of ${photos.length}`;
    viewer.dialog.setAttribute('aria-label', several ? `Photo ${i + 1} of ${photos.length}` : 'Photo');
  }

  // Past the last photo is the first, and before the first is the last.
  function move(step) {
    if (photos.length < 2) return;
    show((index + step + photos.length) % photos.length);
  }

  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('[data-photo-grid] a[href]') : null;
    // Ctrl, Cmd, Shift, Alt and the middle button stay with the browser, which opens a new tab or window.
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const grid = link.closest('[data-photo-grid]');
    const links = [...grid.querySelectorAll('a[href]')];
    photos = links.map((a) => ({
      src: a.href,
      alt: a.querySelector('img')?.alt ?? '',
      caption: a.closest('figure')?.querySelector('figcaption')?.textContent.trim() ?? '',
    }));
    viewer ??= build();
    opener = link;
    show(links.indexOf(link));
    viewer.dialog.showModal();
  });
})();

// === address suggestions ===
// A Property's Address (input[data-address-suggest]) offers matching addresses as
// you type, from /properties/address-suggestions. Choosing one fills Address,
// Suburb and the hidden lat and lng. Arrow keys move, Enter picks, Escape closes
// the list. A reply still on its way is dropped when the query goes below 3
// characters, a suggestion is chosen, Escape is pressed, or the field is left,
// and nothing is drawn while the field isn't focused. Without this file it is a
// plain text box, the hidden pin stays empty, and the address is geocoded on save.
(() => {
  let made = 0;

  onContent((root) => {
    for (const input of root.querySelectorAll('input[data-address-suggest]')) {
      if (!(input instanceof HTMLInputElement) || !input.form) continue;
      const form = input.form;
      const suburb = form.elements.namedItem('suburb');
      const lat = form.elements.namedItem('lat');
      const lng = form.elements.namedItem('lng');
      if (!(suburb instanceof HTMLInputElement) || !(lat instanceof HTMLInputElement) || !(lng instanceof HTMLInputElement)) continue;

      const n = ++made;
      const box = document.createElement('div');
      box.className = 'combobox';
      input.before(box);
      input.classList.add('combobox-input');
      input.autocomplete = 'off';
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      const list = document.createElement('ul');
      list.className = 'combobox-list';
      list.id = `address-suggest-${n}-list`;
      list.setAttribute('role', 'listbox');
      list.hidden = true;
      input.setAttribute('aria-controls', list.id);
      box.append(input, list);

      /** @type {{ label: string, address: string, suburb: string, location: { lat: number, lng: number } }[]} */
      let shown = [];
      let active = -1;
      let timer = 0;
      let request = 0;

      function setActive(i) {
        active = i;
        for (const item of list.querySelectorAll('[role="option"]')) {
          const on = item.id === `address-suggest-${n}-${i}`;
          item.classList.toggle('is-active', on);
          item.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        if (i >= 0) {
          input.setAttribute('aria-activedescendant', `address-suggest-${n}-${i}`);
          document.getElementById(`address-suggest-${n}-${i}`)?.scrollIntoView({ block: 'nearest' });
        } else input.removeAttribute('aria-activedescendant');
      }

      function close() {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
      }

      /** Drops a suggestion that has been asked for but not drawn yet. */
      function dropInFlight() {
        window.clearTimeout(timer);
        request++;
      }

      function render(suggestions) {
        // The field was left while this reply was on its way.
        if (document.activeElement !== input) return;
        shown = suggestions;
        list.replaceChildren(
          ...(shown.length
            ? shown.map((suggestion, i) => {
                const item = document.createElement('li');
                item.id = `address-suggest-${n}-${i}`;
                item.className = 'combobox-option';
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', 'false');
                item.textContent = suggestion.label;
                item.addEventListener('mousedown', (event) => event.preventDefault());
                item.addEventListener('click', () => choose(suggestion));
                return item;
              })
            : [Object.assign(document.createElement('li'), { className: 'combobox-empty', textContent: 'No matches' })]),
        );
        setActive(shown.length ? 0 : -1);
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
      }

      function choose(suggestion) {
        dropInFlight();
        input.value = suggestion.address;
        suburb.value = suggestion.suburb;
        lat.value = String(suggestion.location.lat);
        lng.value = String(suggestion.location.lng);
        close();
      }

      input.addEventListener('input', () => {
        // A typed change is no longer the pin that was picked.
        lat.value = '';
        lng.value = '';
        window.clearTimeout(timer);
        const query = input.value.trim();
        if (query.length < 3) {
          dropInFlight();
          return close();
        }
        const mine = ++request;
        timer = window.setTimeout(async () => {
          let suggestions = [];
          try {
            const response = await fetch(`/properties/address-suggestions?q=${encodeURIComponent(query)}`, { headers: { accept: 'application/json' } });
            const body = response.ok ? await response.json() : [];
            if (Array.isArray(body)) suggestions = body;
          } catch {
            suggestions = [];
          }
          if (mine === request) render(suggestions);
        }, 300);
      });

      input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (list.hidden || !shown.length) return;
          setActive((active + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
        } else if (event.key === 'Enter' && !list.hidden && active >= 0) {
          event.preventDefault();
          choose(shown[active]);
        } else if (event.key === 'Escape') {
          dropInFlight();
          if (!list.hidden) {
            event.preventDefault();
            close();
          }
        }
      });
      input.addEventListener('blur', () => {
        dropInFlight();
        close();
      });
    }
  });
})();

// === predictive header search ===
// The Dispatch search box (input[data-search-suggest]) offers matching Properties
// and Tickets as the Property Manager types, from /search/suggest; the Profiles search
// (data-search-suggest="property") offers Properties only. Arrow keys move,
// Enter picks, Escape closes, a click picks. Without this file Enter still submits
// the ordinary search form.
(() => {
  let made = 0;

  onContent((root) => {
    for (const input of root.querySelectorAll('input[data-search-suggest]')) {
      if (!(input instanceof HTMLInputElement) || !input.form) continue;
      const list = document.getElementById(input.getAttribute('aria-controls') ?? '');
      if (!(list instanceof HTMLUListElement)) continue;
      const icons = document.getElementById('search-suggest-icons');

      const n = ++made;
      let shown = [];
      let active = -1;
      let timer = 0;
      let request = 0;

      function setActive(i) {
        active = i;
        for (const item of list.querySelectorAll('[role="option"]')) {
          const on = item.id === `search-suggest-${n}-${i}`;
          item.classList.toggle('is-active', on);
          item.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        if (i >= 0) {
          input.setAttribute('aria-activedescendant', `search-suggest-${n}-${i}`);
          document.getElementById(`search-suggest-${n}-${i}`)?.scrollIntoView({ block: 'nearest' });
        } else input.removeAttribute('aria-activedescendant');
      }

      function close() {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
      }

      function dropInFlight() {
        window.clearTimeout(timer);
        request++;
      }

      function iconFor(type) {
        const template = icons?.content.querySelector(`[data-icon="${type}"]`);
        return template ? template.cloneNode(true) : document.createDocumentFragment();
      }

      function choose(suggestion) {
        dropInFlight();
        close();
        window.location.assign(suggestion.href);
      }

      function render(suggestions) {
        if (document.activeElement !== input) return;
        shown = suggestions;
        list.replaceChildren(
          ...(suggestions.length
            ? suggestions.map((suggestion, i) => {
                const item = document.createElement('li');
                item.id = `search-suggest-${n}-${i}`;
                item.className = 'combobox-option search-suggest-option';
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', 'false');
                const main = document.createElement('span');
                main.className = 'search-suggest-main';
                const primary = document.createElement('span');
                primary.className = 'search-suggest-label';
                primary.textContent = suggestion.label;
                const secondary = document.createElement('span');
                secondary.className = 'search-suggest-sub';
                secondary.textContent = suggestion.sub;
                main.append(primary, secondary);
                item.append(iconFor(suggestion.type), main);
                item.addEventListener('mousedown', (event) => event.preventDefault());
                item.addEventListener('click', () => choose(suggestion));
                return item;
              })
            : [Object.assign(document.createElement('li'), { className: 'combobox-empty', textContent: 'No matches' })]),
        );
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        setActive(suggestions.length ? 0 : -1);
      }

      input.addEventListener('input', () => {
        dropInFlight();
        const query = input.value.trim();
        if (query.length < 2) {
          shown = [];
          return close();
        }
        const mine = ++request;
        timer = window.setTimeout(async () => {
          let suggestions = [];
          try {
            const kind = input.dataset.searchSuggest ? `&kind=${encodeURIComponent(input.dataset.searchSuggest)}` : '';
            const response = await fetch(`/search/suggest?q=${encodeURIComponent(query)}${kind}`, { headers: { accept: 'application/json' } });
            const body = response.ok ? await response.json() : [];
            if (Array.isArray(body)) suggestions = body;
          } catch {
            suggestions = [];
          }
          if (mine === request) render(suggestions);
        }, 150);
      });

      input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (shown.length === 0) return;
          event.preventDefault();
          if (list.hidden) {
            list.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            setActive(0);
            return;
          }
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setActive((active + step + shown.length) % shown.length);
          return;
        }
        if (event.key === 'Enter' && !list.hidden && active >= 0 && shown[active]) {
          event.preventDefault();
          choose(shown[active]);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      });

      input.addEventListener('focus', () => {
        if (shown.length && input.value.trim().length >= 2) {
          list.hidden = false;
          input.setAttribute('aria-expanded', 'true');
        }
      });

      input.addEventListener('blur', () => {
        // A click on an option is handled on mousedown, so this only closes the list.
        close();
      });
    }
  });
})();

// === inbox modal ===
// The dashboard's Inbox opens over the page as a mail client: people on the left and
// the selected person's thread on the right. Each preview opens it on that person,
// "Check all N messages" opens the newest, and the search narrows the people by name,
// number and message text. The dialog is native, so focus is trapped and Escape closes
// it; closing returns focus to the control that opened it.
(() => {
  let opener = null;

  function select(dialog, index) {
    for (const button of dialog.querySelectorAll('[data-inbox-person]')) {
      const on = Number(button.getAttribute('data-inbox-person')) === index;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    for (const pane of dialog.querySelectorAll('[data-inbox-thread]')) {
      pane.hidden = Number(pane.getAttribute('data-inbox-thread')) !== index;
    }
  }

  function open(link, index) {
    const dialog = document.getElementById('inbox-dialog');
    if (!(dialog instanceof HTMLDialogElement)) return;
    opener = link;
    if (!dialog.open) dialog.showModal();
    select(dialog, index);
    const selected = dialog.querySelector(`[data-inbox-person="${index}"]`);
    if (selected instanceof HTMLElement) selected.focus();
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const close = target.closest('[data-dialog-close]');
    if (close) {
      const dialog = close.closest('dialog');
      if (dialog instanceof HTMLDialogElement) {
        event.preventDefault();
        dialog.close();
      }
      return;
    }

    if (target instanceof HTMLDialogElement && target.classList.contains('inbox-modal') && target.open) {
      const box = target.getBoundingClientRect();
      const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
      if (outside) target.close();
      return;
    }

    const person = target.closest('[data-inbox-person]');
    if (person) {
      const dialog = target.closest('dialog');
      if (dialog instanceof HTMLDialogElement) select(dialog, Number(person.getAttribute('data-inbox-person')));
      return;
    }

    // A Ticket's conversation row opens that one conversation, already scrolled to its latest message.
    const row = target.closest('[data-dialog-open]');
    if (row instanceof HTMLElement) {
      const dialog = document.getElementById(row.getAttribute('data-dialog-open') ?? '');
      if (!(dialog instanceof HTMLDialogElement)) return;
      event.preventDefault();
      opener = row;
      if (!dialog.open) dialog.showModal();
      const thread = dialog.querySelector('[data-convo-thread]');
      if (thread instanceof HTMLElement) thread.scrollTop = thread.scrollHeight;
      return;
    }

    const link = target.closest('[data-inbox-open]');
    if (!(link instanceof HTMLElement)) return;
    event.preventDefault();
    open(link, Number(link.getAttribute('data-inbox-open') ?? 0));
  });

  // The search filters people by what they said as well as who they are.
  document.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('[data-inbox-search]')) return;
    const dialog = input.closest('dialog');
    if (!dialog) return;
    const query = input.value.trim().toLowerCase();
    let shown = 0;
    for (const item of dialog.querySelectorAll('[data-inbox-person]')) {
      const matches = !query || (item.getAttribute('data-inbox-haystack') ?? '').includes(query);
      if (item.parentElement instanceof HTMLElement) item.parentElement.hidden = !matches;
      if (matches) shown++;
    }
    const none = dialog.querySelector('[data-inbox-no-matches]');
    if (none instanceof HTMLElement) none.hidden = shown > 0;
  });

  // close does not bubble; capture hears it from the dialog.
  document.addEventListener(
    'close',
    (event) => {
      const dialog = event.target;
      if (!(dialog instanceof HTMLDialogElement) || !dialog.classList.contains('inbox-modal')) return;
      const back = opener;
      opener = null;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    },
    true,
  );
})();

// === loading and in-page navigation ===
// A thin bar along the top shows while a page or a form's reply is on its way.
// A link or GET form that stays on the same page and only changes the query (the
// Schedule's Day, Week and Month, its previous and next, Mine and All, Settings'
// sections, a filter bar) fetches the page and swaps #main's content in place:
// the address bar and Back and Forward follow, and onContent's setup runs on the
// new content. Anything else, a reply that isn't the same page, a failed fetch,
// or a page with a script of its own (Dispatch's map) is an ordinary navigation.
(() => {
  const root = document.documentElement;
  const bar = document.createElement('div');
  bar.className = 'nav-progress';
  bar.setAttribute('aria-hidden', 'true');
  const status = document.createElement('p');
  status.className = 'sr-only';
  status.setAttribute('aria-live', 'polite');
  document.body.append(bar, status);

  let stopTimer;
  const start = () => {
    root.classList.add('is-navigating');
    // A download doesn't leave the page, so the bar doesn't wait for it forever.
    clearTimeout(stopTimer);
    stopTimer = setTimeout(stop, 10_000);
  };
  const stop = () => {
    clearTimeout(stopTimer);
    root.classList.remove('is-navigating', 'is-leaving');
    for (const el of document.querySelectorAll('[data-pending]')) el.removeAttribute('data-pending');
  };
  // Following a link to another page: the old one fades back while the new one is on its way
  // (from Seoul, so it can take a moment), and the link pressed keeps looking pressed.
  const leave = (link) => {
    start();
    root.classList.add('is-leaving');
    link.setAttribute('data-pending', '');
  };
  // A change made by fetch (inline edit) can make a page prefetched earlier out of date:
  // putting the speculation rules back drops what was fetched, and hovering fetches it again.
  const refreshSpeculation = () => {
    const rules = document.querySelector('script[type="speculationrules"]');
    if (!rules) return;
    const fresh = document.createElement('script');
    fresh.type = 'speculationrules';
    fresh.textContent = rules.textContent;
    // Removed in one task and added back in the next, so the browser sees the rules go.
    rules.remove();
    setTimeout(() => document.head.append(fresh));
  };
  window.addEventListener('pageshow', stop);

  const main = document.getElementById('main');
  const swappable = main && document.querySelector('[data-shell]') && !main.querySelector('script:not([type="application/json"])');
  const pageOf = (url) => url.pathname + url.search;
  let current = pageOf(new URL(location.href));
  let controller;

  // === Inline edit ===
  // A pen (data-inline-open) turns a block's values into its inputs where they
  // sit. The tick posts the form that was already there and swaps the block (and
  // any ids in data-inline-refresh) from the reply. The cross and Escape put the
  // original values back. One block edits at a time: a clean one gives way, a
  // dirty one stays and takes focus. Nothing here changes the page.
  const originals = new WeakMap();

  function namedControls(form) {
    return [...form.querySelectorAll('input[name], textarea[name], select[name]')];
  }

  function capture(form) {
    return namedControls(form).map((el) => ({ name: el.name, value: el.value, checked: !!el.checked }));
  }

  function restore(form, saved) {
    const els = namedControls(form);
    saved.forEach((item, i) => {
      const el = els[i];
      if (!el || el.name !== item.name) return;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = item.checked;
      else el.value = item.value;
    });
    for (const select of form.querySelectorAll('select')) {
      const input = select.parentElement?.querySelector(':scope > input.combobox-input');
      if (!(input instanceof HTMLInputElement)) continue;
      const option = [...select.options].find((o) => o.value === select.value);
      input.value = option && select.value ? option.textContent.trim() : '';
    }
  }

  function dirty(block) {
    const saved = originals.get(block);
    const form = block.querySelector('form');
    if (!saved || !form) return false;
    const now = capture(form);
    return saved.length !== now.length || saved.some((item, i) => item.name !== now[i]?.name || item.value !== now[i]?.value || item.checked !== now[i]?.checked);
  }

  function clearErrors(block) {
    block.querySelector('.inline-edit-refusal')?.remove();
    for (const el of block.querySelectorAll('.field-error')) el.remove();
    for (const el of block.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    for (const el of block.querySelectorAll('.input-error, .textarea-error, .select-error')) {
      el.classList.remove('input-error', 'textarea-error', 'select-error');
    }
  }

  function firstField(block) {
    const fieldset = block.querySelector('fieldset');
    const was = fieldset?.disabled;
    if (fieldset) fieldset.disabled = false;
    const field = [...block.querySelectorAll('input, textarea, select')].find((el) => {
      if (el.closest('.inline-edit-tools, .inline-edit-read')) return false;
      if (el.type === 'hidden' || el.hidden || el.disabled) return false;
      return el.getClientRects().length > 0;
    });
    if (fieldset && was && !block.classList.contains('is-editing')) fieldset.disabled = true;
    return field ?? null;
  }

  function focusPen(block) {
    const pen = block.querySelector('[data-inline-open]');
    if (pen instanceof HTMLElement) pen.focus();
  }

  function closeEdit(block, { restoreValues }) {
    const form = block.querySelector('form');
    if (restoreValues && form) {
      const saved = originals.get(block);
      if (saved) restore(form, saved);
      clearErrors(block);
    }
    const fieldset = form?.querySelector('fieldset');
    if (fieldset) fieldset.disabled = true;
    block.classList.remove('is-editing');
    focusPen(block);
  }

  function openEdit(block) {
    if (!(block instanceof HTMLElement)) return;
    const other = document.querySelector('[data-inline-edit].is-editing');
    if (other && other !== block) {
      if (dirty(other)) {
        firstField(other)?.focus();
        return;
      }
      closeEdit(other, { restoreValues: true });
    }
    const form = block.querySelector('form');
    if (!form) return;
    if (!originals.has(block)) originals.set(block, capture(form));
    const fieldset = form.querySelector('fieldset');
    if (fieldset) fieldset.disabled = false;
    block.classList.add('is-editing');
    firstField(block)?.focus();
  }

  function editingBlock(node) {
    return node instanceof Element ? node.closest('[data-inline-edit]') : null;
  }

  function releaseForm(form) {
    delete form.dataset.submitting;
    form.removeAttribute('aria-busy');
  }

  function showFlash(doc) {
    const incoming = doc.querySelector('[data-flash]');
    const main = document.getElementById('main');
    if (!main) return;
    const existing = main.querySelector(':scope > [data-flash]');
    if (!incoming) {
      existing?.remove();
      return;
    }
    const node = document.importNode(incoming, true);
    if (existing) existing.replaceWith(node);
    else main.querySelector('.page-header')?.after(node);
    document.dispatchEvent(new CustomEvent('myest8:content', { detail: node }));
  }

  function applyChrome(doc) {
    document.title = doc.title;
    const title = doc.querySelector('h1.page-title');
    const liveTitle = document.querySelector('h1.page-title');
    if (title && liveTitle) liveTitle.textContent = title.textContent;
    const subtitle = doc.querySelector('.page-subtitle');
    const liveSubtitle = document.querySelector('.page-subtitle');
    if (subtitle && liveSubtitle) liveSubtitle.replaceWith(document.importNode(subtitle, true));
  }

  function inlineError(block, message) {
    const field = block.querySelector('.inline-edit-control textarea, .inline-edit-control input, .inline-edit-extra textarea, .inline-edit-extra input');
    if (!(field instanceof HTMLElement)) return;
    field.setAttribute('aria-invalid', 'true');
    field.classList.add(field.tagName === 'TEXTAREA' ? 'textarea-error' : 'input-error');
    let error = field.parentElement?.querySelector('.field-error');
    if (!error) {
      error = document.createElement('p');
      error.className = 'field-error';
      if (field.id) error.id = `${field.id}-error`;
      field.after(error);
    }
    error.textContent = message;
    if (field.id && error.id) field.setAttribute('aria-describedby', [error.id, field.getAttribute('aria-describedby')].filter(Boolean).join(' '));
    field.focus();
  }

  async function saveEdit(block) {
    const form = block.querySelector('form');
    if (!form || form.dataset.inlineSaving) return;
    const fieldset = form.querySelector('fieldset');
    if (fieldset) fieldset.disabled = false;
    form.dataset.inlineSaving = 'true';
    start();
    try {
      const response = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { accept: 'text/html' } });
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const next = doc.getElementById(block.id);
      if (!next) throw new Error('missing block');
      const kept = originals.get(block);
      const refused = next.classList.contains('is-editing') || next.querySelector('.field-error, .inline-edit-refusal');
      const flashError = doc.querySelector('[data-flash="error"]');
      if (!refused && flashError) {
        const message = flashError.textContent.replace(/^Error:\s*/, '').replace(/\s+/g, ' ').trim();
        inlineError(block, message);
        return;
      }
      if (!refused) refreshSpeculation();
      const imported = document.importNode(next, true);
      if (refused && kept) originals.set(imported, kept);
      const refresh = (block.dataset.inlineRefresh || '').split(/\s+/).filter(Boolean);
      const refreshed = refresh.flatMap((id) => {
        const live = document.getElementById(id);
        const fresh = doc.getElementById(id);
        if (!live || !fresh || live === block) return [];
        const node = document.importNode(fresh, true);
        return [{ live, node }];
      });
      await swapView(() => {
        block.replaceWith(imported);
        for (const item of refreshed) item.live.replaceWith(item.node);
        if (!refused) {
          applyChrome(doc);
          showFlash(doc);
          focusPen(imported);
        }
        document.dispatchEvent(new CustomEvent('myest8:content', { detail: imported }));
        for (const item of refreshed) document.dispatchEvent(new CustomEvent('myest8:content', { detail: item.node }));
        if (refused) {
          const invalid = imported.querySelector('[aria-invalid="true"]');
          if (invalid instanceof HTMLElement) invalid.focus();
          else firstField(imported)?.focus();
        }
      });
    } catch {
      form.submit();
    } finally {
      delete form.dataset.inlineSaving;
      releaseForm(form);
      stop();
    }
  }

  onContent((root) => {
    for (const block of root.querySelectorAll('[data-inline-edit].is-editing')) {
      if (!originals.has(block)) {
        const form = block.querySelector('form');
        if (form) originals.set(block, capture(form));
      }
    }
  });

  document.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const opener = event.target instanceof Element ? event.target.closest('[data-inline-open]') : null;
    if (opener) {
      const block = editingBlock(opener) || document.getElementById(opener.getAttribute('data-inline-target') || '');
      if (!block) return;
      event.preventDefault();
      openEdit(block);
      return;
    }
    const cancel = event.target instanceof Element ? event.target.closest('[data-inline-cancel]') : null;
    if (!cancel) return;
    const block = editingBlock(cancel);
    if (!block) return;
    event.preventDefault();
    closeEdit(block, { restoreValues: true });
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.classList.contains('inline-edit-form') || event.defaultPrevented) return;
    // Confirm on a Maintenance Request submits this form to another action. That post stays a normal navigation.
    const submitter = event.submitter;
    const posted = new URL(submitter?.getAttribute('formaction') || form.action, location.href);
    const own = new URL(form.action, location.href);
    if (posted.pathname !== own.pathname) return;
    event.preventDefault();
    const block = editingBlock(form);
    if (block) saveEdit(block);
  });

  document.addEventListener('keydown', (event) => {
    const block = event.target instanceof Element ? event.target.closest('[data-inline-edit].is-editing') : null;
    if (!block) return;
    if (event.key === 'Escape') {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeEdit(block, { restoreValues: true });
      return;
    }
    if (event.key !== 'Enter' || event.defaultPrevented || event.shiftKey || event.altKey) return;
    const area = event.target instanceof HTMLTextAreaElement;
    if (area && !(event.metaKey || event.ctrlKey)) return;
    if (!area && !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    saveEdit(block);
  });

  // The same page, maybe another query; a jump to an anchor on this page stays with the browser.
  const samePage = (url) =>
    swappable && url.origin === location.origin && url.pathname === location.pathname && !(url.search === location.search && url.hash);

  async function load(url, push, focusHref) {
    controller?.abort();
    controller = new AbortController();
    start();
    main.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'text/html' } });
      const arrived = new URL(response.url);
      if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html') || arrived.pathname !== url.pathname) throw new Error('not this page');
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const next = doc.getElementById('main');
      if (!next || next.querySelector('script:not([type="application/json"])')) throw new Error('not this page');
      arrived.hash = url.hash;
      // Another tab, filter or week of the same page takes this page's place in the history,
      // so Back goes to the page before rather than stepping back through each change.
      if (push) history.replaceState(null, '', arrived);
      current = pageOf(arrived);
      const focused = main.contains(document.activeElement) ? document.activeElement.id : null;
      await swapView(() => {
        document.title = doc.title;
        main.replaceChildren(...[...next.childNodes].map((node) => document.importNode(node, true)));
        document.dispatchEvent(new CustomEvent('myest8:content', { detail: main }));
        // Focus goes back to the control that was used (a filter, the tab picked), or to the content.
        const target =
          (focused && document.getElementById(focused)) ||
          (focusHref && [...main.querySelectorAll('a[href]')].find((a) => a.href === focusHref)) ||
          null;
        if (target) target.focus({ preventScroll: true });
        else if (focused !== null || focusHref) {
          main.tabIndex = -1;
          main.focus({ preventScroll: true });
        }
        if (url.hash) document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
        status.textContent = `Loaded ${doc.title}`;
        main.removeAttribute('aria-busy');
      });
      stop();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      location.assign(url);
    }
  }

  // A day chip refreshes only Next 7 days. Its href is still the whole dashboard, so
  // Back and Forward load the page the usual way. A failure follows that href.
  // Registered before the generic swapper, which leaves a click alone once prevented.
  let dayLoad = 0;
  let dayController;
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[data-fragment]') : null;
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const fragment = link.getAttribute('data-fragment');
    const section = document.getElementById('next-7-days');
    if (!fragment || !(section instanceof HTMLElement)) return;
    event.preventDefault();
    const href = link.href;
    const loadId = ++dayLoad;
    dayController?.abort();
    dayController = new AbortController();
    section.setAttribute('aria-busy', 'true');
    start();
    fetch(fragment, { signal: dayController.signal, headers: { accept: 'text/html' } })
      .then(async (response) => {
        const type = response.headers.get('content-type') ?? '';
        const arrived = new URL(response.url, location.origin);
        if (!response.ok || !type.includes('text/html') || arrived.pathname !== '/next-7-days') throw new Error('not the day');
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const next = doc.getElementById('next-7-days');
        if (!next || doc.getElementById('main')) throw new Error('not the day');
        if (loadId !== dayLoad) return;
        const live = document.getElementById('next-7-days');
        if (!live) throw new Error('not the day');
        const imported = document.importNode(next, true);
        swapView(() => {
          live.replaceWith(imported);
          const url = new URL(href);
          history.replaceState(null, '', url);
          current = pageOf(url);
          const day = url.searchParams.get('day');
          const scope = document.querySelector('#main .page-header-controls .segmented');
          if (scope && day) {
            for (const item of scope.querySelectorAll('a[href]')) {
              const nextHref = new URL(item.getAttribute('href'), location.origin);
              if (nextHref.pathname !== '/') continue;
              nextHref.searchParams.set('day', day);
              nextHref.hash = 'next-7-days';
              item.setAttribute('href', `${nextHref.pathname}${nextHref.search}${nextHref.hash}`);
            }
          }
          const chosen = imported.querySelector('[aria-current="date"]');
          if (chosen instanceof HTMLElement) chosen.focus({ preventScroll: true });
          const heading = imported.querySelector('.visit-heading');
          status.textContent = `Loaded ${heading?.textContent?.trim() || 'the day'}`;
        });
        stop();
      })
      .catch((error) => {
        if (error?.name === 'AbortError' || loadId !== dayLoad) return;
        location.assign(href);
      });
  });

  // Registered last, so the confirm, photo viewer and upload handlers above have had their say.
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin) return;
    if (samePage(url)) {
      event.preventDefault();
      load(url, true, link.href);
    } else if (!(url.pathname === location.pathname && url.search === location.search && url.hash)) {
      leave(link);
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || event.defaultPrevented) return;
    const submitter = event.submitter;
    const method = (submitter?.getAttribute('formmethod') || form.method).toLowerCase();
    const url = new URL(submitter?.getAttribute('formaction') || form.action, location.href);
    if (method === 'get' && !form.target && samePage(new URL(url.pathname, location.href))) {
      event.preventDefault();
      url.search = new URLSearchParams(new FormData(form, submitter)).toString();
      load(url, true).finally(() => {
        delete form.dataset.submitting;
        form.removeAttribute('aria-busy');
      });
    } else if (method === 'post' && !form.target && document.querySelector('[data-shell]')) {
      event.preventDefault();
      post(form, submitter, url);
    } else if (!form.target) {
      start();
    }
  });

  // A form that posts is sent with fetch. The server answers with where to go next
  // (x-myest8-redirect, src/web/server.ts), and coming back to this same page replaces it in
  // the history: Back then goes to the page before, never to this page as it was before
  // the change. Going anywhere else is an ordinary step forward. A page that answers the
  // form itself (a refused change, shown with its field) takes #main's place.
  async function post(form, submitter, url) {
    start();
    const done = () => {
      stop();
      delete form.dataset.submitting;
      form.removeAttribute('aria-busy');
    };
    let response;
    try {
      response = await fetch(url, { method: 'POST', body: new FormData(form, submitter), headers: { accept: 'text/html', 'x-myest8-post': '1' } });
    } catch {
      // Never reached the server: send it the ordinary way, keeping the button that was used.
      done();
      if (submitter?.name) form.append(Object.assign(document.createElement('input'), { type: 'hidden', name: submitter.name, value: submitter.value }));
      return HTMLFormElement.prototype.submit.call(form);
    }
    let text = '';
    try {
      const to = response.headers.get('x-myest8-redirect');
      if (to) {
        const next = new URL(to, location.href);
        if (next.origin !== location.origin || next.pathname !== location.pathname) return location.assign(next);
        if (next.search === location.search) {
          history.replaceState(history.state, '', next);
          return location.reload();
        }
        return location.replace(next);
      }
      text = await response.text();
      const doc = (response.headers.get('content-type') ?? '').includes('text/html') ? new DOMParser().parseFromString(text, 'text/html') : null;
      const next = doc?.getElementById('main');
      if (!main || !next || next.querySelector('script:not([type="application/json"])')) throw new Error('not a page');
      await swapView(() => {
        document.title = doc.title;
        main.replaceChildren(...[...next.childNodes].map((node) => document.importNode(node, true)));
        document.dispatchEvent(new CustomEvent('myest8:content', { detail: main }));
        main.tabIndex = -1;
        main.focus({ preventScroll: true });
        window.scrollTo({ top: 0 });
      });
      done();
    } catch {
      // Some other answer (an error page): it was handled once already, so it is shown as it
      // came rather than sent again.
      done();
      if (!text) return location.reload();
      document.open();
      document.write(text);
      document.close();
    }
  }

  window.addEventListener('popstate', () => {
    const url = new URL(location.href);
    // Only the hash changed (Dispatch's picked pin, an anchor): nothing to load.
    if (!swappable || pageOf(url) === current) return;
    load(url, false);
  });

  // A page the browser kept in its back-forward cache shows how things were when it was
  // left. Coming back to it loads it again, so it shows how things are now.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    if (swappable) load(new URL(location.href), false);
    else location.reload();
  });
})();

// === Ticket page: Progress tabs and tools ===
// The Progress card's three views (Timeline, the Job, Costs) show one at a time, with its
// tab buttons; without this file they show one under another. Its tools print the page
// and fill the screen.
onContent((root) => {
  for (const tabs of root.querySelectorAll('[data-tabs]')) {
    const selected = tabs.querySelector('[role="tab"][aria-selected="true"]') || tabs.querySelector('[role="tab"]');
    if (selected) selectTab(selected);
  }
  // A slider under the Timeline board that scrolls it sideways (and follows it), shown
  // only while the board is wider than the card. Dragging the board itself works too.
  for (const board of root.querySelectorAll('.tl-board')) {
    if (board.dataset.slider) continue;
    board.dataset.slider = '1';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'tl-slider';
    slider.min = '0';
    slider.step = '1';
    slider.value = '0';
    slider.setAttribute('aria-label', 'Scroll the Timeline sideways');
    board.after(slider);
    // Open on the stage the Job is at (or the last one when it is done), aligned to the
    // start of its column: at 1440 the later columns would otherwise sit off-screen, and
    // an 8px nudge left the previous stage's arrow clipped at the edge.
    const current = board.querySelector('[data-current]');
    if (current) {
      const left = current.getBoundingClientRect().left - board.getBoundingClientRect().left + board.scrollLeft;
      board.scrollLeft = Math.max(0, Math.round(left));
    }
    const sync = () => {
      const max = board.scrollWidth - board.clientWidth;
      slider.hidden = max <= 4;
      slider.max = String(Math.max(0, Math.round(max)));
      slider.value = String(Math.round(board.scrollLeft));
      board.classList.toggle('is-cut-start', board.scrollLeft > 2);
      board.classList.toggle('is-cut-end', board.scrollLeft < max - 2);
    };
    slider.addEventListener('input', () => {
      board.scrollLeft = Number(slider.value);
    });
    // Shift + a plain mouse wheel scrolls sideways, as it does in most browsers already;
    // this makes it the same everywhere. A trackpad's own sideways swipe is left alone.
    board.addEventListener(
      'wheel',
      (event) => {
        if (!event.shiftKey || event.deltaX || !event.deltaY || board.scrollWidth <= board.clientWidth) return;
        board.scrollLeft += event.deltaY;
        event.preventDefault();
      },
      { passive: false },
    );
    board.addEventListener('scroll', sync, { passive: true });
    if ('ResizeObserver' in window) new ResizeObserver(sync).observe(board);
    window.addEventListener('resize', sync);
    sync();
  }
});

function selectTab(tab) {
  const tabs = tab.closest('[data-tabs]');
  if (!tabs) return;
  for (const other of tabs.querySelectorAll('[role="tab"]')) {
    const on = other === tab;
    other.setAttribute('aria-selected', String(on));
    const pane = document.getElementById(other.getAttribute('aria-controls'));
    if (pane) pane.hidden = !on;
  }
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const tab = target.closest('[data-tabs] [role="tab"]');
  if (tab) return selectTab(tab);
  const link = target.closest('[data-tab-link]');
  if (link) {
    const pane = document.getElementById(link.getAttribute('data-tab-link'));
    const own = pane && document.getElementById(`tab-${pane.id}`);
    if (own) {
      selectTab(own);
      event.preventDefault();
      pane.closest('[data-tabs]')?.scrollIntoView({ block: 'start' });
    }
    return;
  }
  if (target.closest('[data-print]')) return window.print();
  const expand = target.closest('[data-expand]');
  if (expand) {
    const card = expand.closest('[data-tabs]');
    const on = card?.classList.toggle('is-expanded');
    expand.setAttribute('aria-pressed', String(Boolean(on)));
    document.documentElement.classList.toggle('has-expanded', Boolean(on));
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const open = document.querySelector('[data-tabs].is-expanded');
  if (!open) return;
  open.classList.remove('is-expanded');
  open.querySelector('[data-expand]')?.setAttribute('aria-pressed', 'false');
  document.documentElement.classList.remove('has-expanded');
});

// The Progress timeline: drag it sideways with the mouse (touch scrolls it natively).
// A drag is not a click, so a link under the pointer isn't followed when it ends.
{
  let drag = null;
  document.addEventListener('dragstart', (event) => {
    if (event.target instanceof Element && event.target.closest('.tl-board')) event.preventDefault();
  });
  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const board = event.target instanceof Element ? event.target.closest('.tl-board') : null;
    if (!board || board.scrollWidth <= board.clientWidth) return;
    drag = { board, x: event.clientX, left: board.scrollLeft, moved: false };
  });
  document.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return;
    drag.moved = true;
    drag.board.classList.add('is-dragging');
    drag.board.scrollLeft = drag.left - dx;
    event.preventDefault();
  });
  const end = () => {
    if (!drag) return;
    const { board, moved } = drag;
    drag = null;
    board.classList.remove('is-dragging');
    if (moved) {
      const stop = (e) => e.stopPropagation();
      board.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => board.removeEventListener('click', stop, true), 0);
    }
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
}

// === Tradie profile: filter the Quotes ===
// Search, Trade and Outcome narrow the Quotes already in the page. Without this file the
// filters are not shown and every Quote is listed.
onContent((root) => {
  for (const list of root.querySelectorAll('[data-quotes]')) {
    const scope = list.closest('.tradie-pane') ?? root;
    const search = scope.querySelector('[data-quote-search]');
    const trade = scope.querySelector('[data-quote-trade]');
    const outcome = scope.querySelector('[data-quote-outcome]');
    if (!search && !trade && !outcome) continue;
    const apply = () => {
      const words = (search?.value ?? '').trim().toLowerCase();
      let shown = 0;
      for (const quote of list.querySelectorAll('[data-quote]')) {
        const fits =
          (!words || (quote.getAttribute('data-text') ?? '').includes(words)) &&
          (!trade?.value || quote.getAttribute('data-trade') === trade.value) &&
          (!outcome?.value || quote.getAttribute('data-outcome') === outcome.value);
        quote.hidden = !fits;
        if (fits) shown += 1;
      }
      const none = list.querySelector('[data-quotes-none]');
      if (none) none.hidden = shown > 0;
    };
    for (const control of [search, trade, outcome]) control?.addEventListener(control === search ? 'input' : 'change', apply);
  }
});
