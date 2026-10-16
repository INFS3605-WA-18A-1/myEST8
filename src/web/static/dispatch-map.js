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

  // A group of pins that overlap: a disc with how many.
  function groupDisc(count) {
    const element = document.createElement('span');
    element.className = 'map-group';
    const number = document.createElement('b');
    number.textContent = String(count);
    element.append(number);
    return element;
  }

  for (const item of document.querySelectorAll('[data-map-legend] [data-pin]')) {
    const kind = item.dataset.pin;
    item.querySelector('[data-pin-sample]')?.append(kind === 'group' ? groupDisc(3) : pin(kind, ''));
  }

  // === Picking something ===
  const panels = new Map([...side.querySelectorAll('[data-panel]')].map((panel) => [panel.dataset.panel, panel]));
  const markers = new Map(); // key -> { marker, element, latlng }
  let selected = null;
  let trigger = null;
  let ring = null;
  let map = null;
  let group = null; // the pins, grouped where they overlap

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
    if (pinned && map) {
      pinned.element.classList.add('is-selected');
      pinned.marker.setZIndexOffset(100000);
      // A group holding the picked pin is marked too, in case the map is zoomed out again.
      group.refreshClusters(pinned.marker);
      // The ring is the Tradie search radius, drawn quietly; the map doesn't zoom out to it.
      if (key.startsWith('property-')) ring = L.circle(pinned.latlng, { radius: data.radiusKm * 1000, className: 'dispatch-ring', interactive: false }).addTo(map);
      // Zoom in until the pin stands on its own, if it was in a group, and bring it into view.
      group.zoomToShowLayer(pinned.marker);
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
    const pinned = markers.get(selected);
    panels.get(selected)?.classList.remove('is-open');
    side.classList.remove('has-selection');
    pinned?.element.classList.remove('is-selected');
    if (pinned) {
      pinned.marker.setZIndexOffset((pinned.marker.options.rank + 1) * 1000);
      group?.refreshClusters(pinned.marker);
    }
    for (const row of document.querySelectorAll('[data-row][data-selected]')) delete row.dataset.selected;
    for (const link of document.querySelectorAll('[data-select][aria-current]')) link.removeAttribute('aria-current');
    ring?.remove();
    ring = null;
    selected = null;
    if (returnFocus && trigger) {
      // A pin's element is made again when its group splits or forms: focus the one there now, or the map.
      const target = trigger.isConnected ? trigger : trigger.dataset.pinKey ? pinned?.marker.getElement() || mapElement : null;
      target?.focus();
    }
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
  // Without Leaflet or its grouping (a file didn't load) the table and panels still work.
  if (typeof L !== 'undefined' && L.MarkerClusterGroup) {
    mapElement.replaceChildren();
    map = L.map(mapElement, { scrollWheelZoom: false, zoomAnimation: !reduceMotion, fadeAnimation: !reduceMotion, markerZoomAnimation: !reduceMotion });
    // A view first: markers only get their elements once the map has one.
    map.setView([-33.8688, 151.2093], 12);
    const { url, subdomains, attribution, maxZoom } = data.tiles;
    L.tileLayer(url, { ...(subdomains ? { subdomains } : {}), attribution, maxZoom }).addTo(map);
    // Street level is close enough to tell neighbours apart; past it, pins still together fan out.
    map.setMaxZoom(Math.min(maxZoom, 18));
    // The page scrolls: the wheel only zooms the map once the map has been clicked or focused.
    map.on('focus', () => map.scrollWheelZoom.enable());
    map.on('blur', () => map.scrollWheelZoom.disable());

    // Leaflet makes a marker's element again each time it is shown (a group splitting does that),
    // so the element's name and key are set wherever it is made, here.
    const PinIcon = L.DivIcon.extend({
      createIcon(old) {
        const element = L.DivIcon.prototype.createIcon.call(this, old);
        element.setAttribute('aria-label', this.options.label);
        if (this.options.key) element.dataset.pinKey = this.options.key;
        return element;
      },
    });

    const RANK = { urgent: 3, high: 2, routine: 1 };
    const WORST = ['', 'routine', 'high', 'urgent'];

    // A group: a white disc with the number of pins in it, and the worst Urgency's shape on its
    // shoulder when a Property in it has an Urgent or High Ticket. Enter or a click zooms in to it.
    group = L.markerClusterGroup({
      maxClusterRadius: 40,
      showCoverageOnHover: false,
      animate: !reduceMotion,
      spiderLegPolylineOptions: { className: 'dispatch-spider-leg', weight: 1.5 },
      iconCreateFunction(cluster) {
        const children = cluster.getAllChildMarkers();
        const properties = children.filter((m) => m.options.rank >= 0);
        const tradies = children.length - properties.length;
        const worst = WORST[Math.max(0, ...properties.map((m) => m.options.rank))];
        const element = groupDisc(children.length);
        if (selected && children.includes(markers.get(selected)?.marker)) element.classList.add('is-selected');
        if (worst === 'urgent' || worst === 'high') element.append(pin(worst, ''));
        const parts = [];
        if (properties.length) parts.push(properties.length === 1 ? '1 Property' : `${properties.length} Properties`);
        if (tradies) parts.push(tradies === 1 ? '1 Tradie' : `${tradies} Tradies`);
        const label = `Group of ${children.length} pins: ${parts.join(' and ')}${worst && worst !== 'routine' ? `, worst urgency ${worst}` : ''}. Press Enter to zoom in.`;
        return new PinIcon({ className: 'map-pin-icon map-group-icon', html: element, iconSize: [36, 36], label });
      },
    });

    function add(key, kind, label, name, item, rank) {
      const latlng = L.latLng(item.lat, item.lng);
      const element = pin(kind, label);
      const size = kind === 'tradie' ? 26 : 32;
      const marker = L.marker(latlng, {
        icon: new PinIcon({ className: 'map-pin-icon', html: element, iconSize: [size, size], iconAnchor: [size / 2, size / 2], label: name, key }),
        keyboard: true,
        title: name,
        zIndexOffset: (rank + 1) * 1000,
        riseOnHover: true,
        rank,
      });
      marker.on('click', () => select(key, marker.getElement()));
      markers.set(key, { marker, element, latlng });
      return marker;
    }

    const propertyPins = data.properties.map((p) => {
      const open = p.openTickets === 1 ? '1 open Ticket' : `${p.openTickets} open Tickets`;
      const worst = p.urgency ? `, worst urgency ${p.urgency}` : '';
      return add(p.key, p.urgency || 'none', p.openTickets ? String(p.openTickets) : '', `${p.address}, ${open}${worst}`, p, RANK[p.urgency] || 0);
    });
    const tradiePins = data.tradies.map((t) =>
      add(t.key, 'tradie', (t.name.trim()[0] || '?').toUpperCase(), `Tradie: ${t.name}, ${t.trades.join(', ').replaceAll('_', ' ')}`, t, -1),
    );
    group.addLayers([...propertyPins, ...tradiePins]);
    map.addLayer(group);

    // A pin is a button: Enter or Space picks it. (Leaflet turns Enter into a click only for markers with a popup.)
    mapElement.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const button = event.target instanceof Element ? event.target.closest('[data-pin-key]') : null;
      if (!button) return;
      event.preventDefault();
      select(button.dataset.pinKey, button);
    });

    // Open on the Agency's Properties (the Tradies around them may be spread across Sydney).
    const framed = propertyPins.length ? propertyPins : tradiePins;
    if (framed.length) map.fitBounds(L.latLngBounds(framed.map((m) => m.getLatLng())), { padding: [32, 32], maxZoom: 15, animate: false });
    // The map was sized by the stylesheet after it was made; make sure it knows.
    requestAnimationFrame(() => map.invalidateSize());
  }

  // Arriving on a link to a panel (a reload, a shared address) picks it.
  const fromHash = location.hash.startsWith('#panel-') ? location.hash.slice('#panel-'.length) : null;
  if (fromHash && panels.has(fromHash)) select(fromHash, null);
})();
