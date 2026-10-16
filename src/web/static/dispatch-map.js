// The Dispatch map (src/web/pages/dispatch.ts). The page works without this file, as
// a table with a panel per Property; this adds the Leaflet map, and makes the map
// pins and the table rows pick the panel shown beside the map.
//
// Everything it draws comes from the JSON block #dispatch-data, and is built with
// DOM calls and textContent, never innerHTML, so an address can't inject markup. Colours
// come from the design tokens in app.css through the classes below, never from here.

(() => {
  const dataElement = document.getElementById('dispatch-data');
  const mapElement = document.getElementById('dispatch-map');
  const side = document.getElementById('dispatch-side');
  if (!dataElement || !mapElement || !side) return;

  const data = JSON.parse(dataElement.textContent || '{}');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sideBySide = window.matchMedia('(min-width: 64rem)'); // the breakpoint where the panel sits beside the map
  const SVG = 'http://www.w3.org/2000/svg';

  // === Pins ===
  // Shape says the Urgency as well as colour: a triangle is Urgent, a diamond High, a
  // filled circle Routine, an open circle nothing open, a square a Tradie. A Property's
  // pin carries its number of open Tickets; a Tradie's its initial.
  const SHAPES = {
    urgent: ['path', { d: 'M16 3 30 28H2z' }],
    high: ['path', { d: 'M16 2 30 16 16 30 2 16z' }],
    routine: ['circle', { cx: 16, cy: 16, r: 13 }],
    none: ['circle', { cx: 16, cy: 16, r: 12 }],
    tradie: ['rect', { x: 4, y: 4, width: 24, height: 24, rx: 5 }],
  };

  function pin(kind, label) {
    const [tag, attributes] = SHAPES[kind];
    const shape = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, String(value));
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.append(shape);
    const text = document.createElement('b');
    text.textContent = label;
    const root = document.createElement('span');
    root.className = `map-pin map-pin-${kind}`;
    root.append(svg, text);
    return root;
  }

  for (const item of document.querySelectorAll('[data-map-legend] [data-pin]')) {
    item.querySelector('[data-pin-sample]')?.append(pin(item.dataset.pin, ''));
  }

  // === Picking something ===
  const panels = new Map([...side.querySelectorAll('[data-panel]')].map((panel) => [panel.dataset.panel, panel]));
  const markers = new Map(); // key -> { marker, element, latlng }
  let selected = null;
  let trigger = null;
  let ring = null;
  let map = null;

  function select(key, from) {
    const panel = panels.get(key);
    if (!panel) return;
    clearSelection(false);
    selected = key;
    trigger = from || null;
    panel.classList.add('is-open');
    side.classList.add('has-selection');
    for (const button of panel.querySelectorAll('[data-dispatch-clear]')) button.hidden = false;
    for (const row of document.querySelectorAll(`[data-row="${key}"]`)) row.dataset.selected = 'true';
    for (const link of document.querySelectorAll(`[data-select="${key}"]`)) link.setAttribute('aria-current', 'true');

    const pinned = markers.get(key);
    if (pinned) {
      pinned.element.classList.add('is-selected');
      if (map && key.startsWith('property-')) {
        // The ring is the Tradie search radius: fit it, so it is the thing the Property Manager sees.
        ring = L.circle(pinned.latlng, { radius: data.radiusKm * 1000, className: 'dispatch-ring', interactive: false }).addTo(map);
        map.fitBounds(ring.getBounds(), { padding: [16, 16], animate: !reduceMotion });
      } else if (map) {
        map.panTo(pinned.latlng, { animate: !reduceMotion });
      }
    }

    // Picked from the table, the map and panel are above: scroll up to them.
    const board = side.parentElement;
    if (from && from.closest('table') && board && board.getBoundingClientRect().top < 0) board.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    panel.querySelector('h2')?.focus({ preventScroll: true });
    // Stacked under the map (a phone), the panel can be off screen: bring it into view. Beside the map it already is.
    if (!sideBySide.matches) panel.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  function clearSelection(returnFocus) {
    if (!selected) return;
    panels.get(selected)?.classList.remove('is-open');
    side.classList.remove('has-selection');
    markers.get(selected)?.element.classList.remove('is-selected');
    for (const row of document.querySelectorAll('[data-row][data-selected]')) delete row.dataset.selected;
    for (const link of document.querySelectorAll('[data-select][aria-current]')) link.removeAttribute('aria-current');
    ring?.remove();
    ring = null;
    selected = null;
    if (returnFocus && trigger && trigger.isConnected) trigger.focus();
    trigger = null;
  }

  // Table rows: the address link picks the Property. Without this file it jumps to the panel (:target).
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('[data-select]') : null;
    if (!link) return;
    event.preventDefault();
    select(link.dataset.select, link);
  });

  for (const button of side.querySelectorAll('[data-dispatch-clear]')) button.addEventListener('click', () => clearSelection(true));
  side.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') clearSelection(true);
  });

  // === The map ===
  // Without Leaflet (the file didn't load) the table and panels still work.
  if (typeof L !== 'undefined') {
    mapElement.replaceChildren();
    map = L.map(mapElement, { scrollWheelZoom: false, zoomAnimation: !reduceMotion, fadeAnimation: !reduceMotion, markerZoomAnimation: !reduceMotion });
    // A view first: markers only get their elements once the map has one, and the aria-labels and key handlers need them.
    map.setView([-33.8688, 151.2093], 10);
    L.tileLayer(data.tiles.url, { subdomains: data.tiles.subdomains, attribution: data.tiles.attribution, maxZoom: data.tiles.maxZoom }).addTo(map);
    // The page scrolls: the wheel only zooms the map once the map has been clicked or focused.
    map.on('focus', () => map.scrollWheelZoom.enable());
    map.on('blur', () => map.scrollWheelZoom.disable());

    const RANK = { urgent: 3, high: 2, routine: 1 };
    const points = [];

    function add(key, kind, label, name, item, rank) {
      const latlng = L.latLng(item.lat, item.lng);
      const element = pin(kind, label);
      const size = kind === 'tradie' ? 26 : 32;
      const marker = L.marker(latlng, {
        icon: L.divIcon({ className: 'map-pin-icon', html: element, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        keyboard: true,
        title: name,
        zIndexOffset: rank * 10000,
        riseOnHover: true,
      }).addTo(map);
      // The marker is a focusable button: Tab to it, Enter opens its panel. Its name says what it is.
      const button = marker.getElement();
      button?.setAttribute('aria-label', name);
      marker.on('click', () => select(key, button));
      // Leaflet turns Enter into a click only for markers with a popup, so do it here, with Space as buttons do.
      button?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        select(key, button);
      });
      markers.set(key, { marker, element, latlng });
      points.push(latlng);
    }

    for (const p of data.properties) {
      const open = p.openTickets === 1 ? '1 open Ticket' : `${p.openTickets} open Tickets`;
      const worst = p.urgency ? `, worst urgency ${p.urgency}` : '';
      add(p.key, p.urgency || 'none', p.openTickets ? String(p.openTickets) : '', `${p.address}, ${open}${worst}`, p, RANK[p.urgency] || 0);
    }
    for (const t of data.tradies) {
      add(t.key, 'tradie', (t.name.trim()[0] || '?').toUpperCase(), `Tradie: ${t.name}, ${t.trades.join(', ').replaceAll('_', ' ')}`, t, -1);
    }

    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 });
    // The map was sized by the stylesheet after it was made; make sure it knows.
    requestAnimationFrame(() => map.invalidateSize());
  }

  // Arriving on a link to a panel (a reload, a shared address) picks it.
  const fromHash = location.hash.startsWith('#panel-') ? location.hash.slice('#panel-'.length) : null;
  if (fromHash && panels.has(fromHash)) select(fromHash, null);
})();
