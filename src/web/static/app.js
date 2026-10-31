// Small enhancements for every page. Pages work without this file: it only adds
// confirm dialogs, a guard against double submits, dismissable flash messages,
// the drawer that opens the rail under 1024px, collapsing the rail from 1024px,
// closing the user menu, a loading bar, and in-page navigation (at the end).

// Setup for elements in the page goes through onContent: it runs on the document
// now, and again on #main's new content after an in-page navigation.
function onContent(setup) {
  setup(document);
  document.addEventListener('myest8:content', (event) => setup(event.detail));
}

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
  onContent((root) => {
    for (const flash of root.querySelectorAll('[data-flash]')) {
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
  const allShares = () => document.querySelectorAll('details[data-share]');

  const close = (share, returnFocus = false) => {
    share.open = false;
    if (returnFocus) share.querySelector('summary')?.focus();
  };

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
        for (const other of allShares()) if (other !== share) other.open = false;
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
    root.classList.remove('is-navigating');
  };
  window.addEventListener('pageshow', stop);

  const main = document.getElementById('main');
  const swappable = main && document.querySelector('[data-shell]') && !main.querySelector('script:not([type="application/json"])');
  const pageOf = (url) => url.pathname + url.search;
  let current = pageOf(new URL(location.href));
  let controller;

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
      if (push) history.pushState(null, '', arrived);
      current = pageOf(arrived);
      const focused = main.contains(document.activeElement) ? document.activeElement.id : null;
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
      stop();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      location.assign(url);
    }
  }

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
      start();
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
    } else if (!form.target) {
      start();
    }
  });

  window.addEventListener('popstate', () => {
    const url = new URL(location.href);
    // Only the hash changed (Dispatch's picked pin, an anchor): nothing to load.
    if (!swappable || pageOf(url) === current) return;
    load(url, false);
  });
})();
