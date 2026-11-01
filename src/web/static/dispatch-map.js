// The Dispatch map (src/web/pages/dispatch.ts). The page works without this file, as
// a table with a panel per Property; this adds the MapLibre GL JS map, and makes the map
// pins and the table rows pick the panel shown beside the map.
//
// MapLibre draws the basemap (OpenFreeMap's Positron style) and works out which pins
// overlap (a GeoJSON source with `cluster: true`). The pins and the groups themselves are
// HTML buttons laid over the map, so each one is a real focusable element: Tab to it, Enter
// or a click picks it.
//
// Everything it draws comes from the JSON block #dispatch-data, and is built with
// DOM calls and textContent, never innerHTML, so an address can't inject markup. Colours
// come from the design tokens in app.css through the classes below, never from here
// (the one exception is the search ring, drawn by MapLibre: it reads --action from the CSS).
//
// This is an ES module, so MapLibre (an ES module too) is imported once the page has run
// far enough to need it: if that, WebGL or the basemap's style fails, the map's place
// says so and the table and panels still work.

// === The Properties table's filter and search (progressive: without JavaScript the whole table shows) ===
(() => {
  const tabs = [...document.querySelectorAll('[data-prop-filter]')];
  const search = document.querySelector('[data-prop-search]');
  const table = document.getElementById('properties');
  if (!tabs.length || !search || !table) return;
  let mode = 'all';
  function apply() {
    const words = search.value.trim().toLowerCase();
    for (const row of table.querySelectorAll('tbody tr[data-row]')) {
      const urgent = row.dataset.urgency === 'urgent' || row.dataset.urgency === 'high';
      const matchesTab = mode === 'all' || (mode === 'open' && 'urgency' in row.dataset && row.closest('details') === null) || (mode === 'urgent' && urgent);
      const matchesText = !words || (row.querySelector('th')?.textContent || '').toLowerCase().includes(words);
      row.hidden = !(matchesTab && matchesText);
    }
    // "Open tickets" and "High & urgent" leave the quiet Properties folded away.
    for (const more of table.querySelectorAll('details.dispatch-more')) more.hidden = mode !== 'all' && !words;
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.propFilter === mode));
  }
  for (const tab of tabs) tab.addEventListener('click', () => { mode = tab.dataset.propFilter; apply(); });
  search.addEventListener('input', apply);
})();

(() => {
  const dataElement = document.getElementById('dispatch-data');
  const mapElement = document.getElementById('dispatch-map');
  const side = document.getElementById('dispatch-side');
  if (!dataElement || !mapElement || !side) return;

  const data = JSON.parse(dataElement.textContent || '{}');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sideBySide = window.matchMedia('(min-width: 64rem)'); // the breakpoint where the panel sits beside the map

  // === Pins ===
  // Two glyphs, copied from the page's #dispatch-pin-icons template: a house on a disc for
  // a Property, a wrench on a rounded square for a Tradie. A Property's disc grows and
  // takes the Urgency's colour (Urgent largest, in Rust; High in Ochre; Routine in Harbour;
  // none small and white), with its number of open Tickets on its shoulder.
  const glyphs = document.getElementById('dispatch-pin-icons');
  const PIN_SIZE = { urgent: 44, high: 38, routine: 32, none: 26, tradie: 28 };
  const GROUP_SIZE = 36;
  const RANK = { urgent: 3, high: 2, routine: 1 };
  const WORST = ['', 'routine', 'high', 'urgent'];

  function glyph(kind) {
    const svg = glyphs?.content.querySelector(`[data-icon="${kind}"] svg`);
    return svg ? svg.cloneNode(true) : document.createElement('span');
  }

  function pin(kind, level, count) {
    const root = document.createElement('span');
    root.className = kind === 'tradie' ? 'map-pin map-pin-tradie' : `map-pin map-pin-property is-${level}`;
    root.append(glyph(kind));
    if (count) {
      const badge = document.createElement('b');
      badge.className = 'map-pin-count';
      badge.textContent = String(count);
      root.append(badge);
    }
    return root;
  }

  // A group of pins that overlap: a disc with how many, ringed in the worst Urgency's colour.
  function groupDisc(count) {
    const element = document.createElement('span');
    element.className = 'map-group';
    const number = document.createElement('b');
    number.textContent = String(count);
    element.append(number);
    return element;
  }

  /** The button a map marker is: it is what takes focus, and what a screen reader reads. */
  function markerButton(inner, size, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'map-pin-icon';
    button.style.width = button.style.height = `${size}px`;
    button.setAttribute('aria-label', label);
    button.append(inner);
    return button;
  }

  // === Picking something ===
  const panels = new Map([...side.querySelectorAll('[data-panel]')].map((panel) => [panel.dataset.panel, panel]));
  const markers = new Map(); // key -> { marker, button, element, lngLat, rank, shown }
  const groups = new Map(); // cluster id -> { marker, button, disc }: the groups on the map now
  let selected = null;
  let trigger = null;
  let map = null; // null until MapLibre has loaded the basemap's style, and again if the map fails
  let maplibregl = null;
  let step = 0; // counts picks and hand moves, so a pick that is overtaken stops moving the map

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
    if (map) showOnMap(key, !(from && from.dataset.pinKey));

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
    step++;
    panels.get(selected)?.classList.remove('is-open');
    side.classList.remove('has-selection');
    if (pinned) {
      pinned.element.classList.remove('is-selected');
      pinned.button.style.zIndex = String((pinned.rank + 1) * 1000);
    }
    for (const row of document.querySelectorAll('[data-row][data-selected]')) delete row.dataset.selected;
    for (const link of document.querySelectorAll('[data-select][aria-current]')) link.removeAttribute('aria-current');
    for (const shown of groups.values()) shown.disc.classList.remove('is-selected');
    setRing(null);
    selected = null;
    if (returnFocus && trigger) {
      // A pin's button is taken off the map when a group forms: focus the one there now, or the map.
      const target = trigger.isConnected ? trigger : trigger.dataset.pinKey ? (pinned?.shown ? pinned.button : map?.getCanvas()) : null;
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
  const PINS = 'dispatch-pins';
  const RING = 'dispatch-ring';

  function note(text) {
    const paragraph = document.createElement('p');
    paragraph.className = 'dispatch-map-fallback';
    paragraph.textContent = text;
    return paragraph;
  }

  /** The map can't run: say so in its place, pointing to the table, which has every pin's facts. */
  function fail() {
    map?.remove();
    map = null;
    for (const entry of markers.values()) entry.shown = false;
    markers.clear();
    groups.clear();
    mapElement.replaceChildren(note('The map could not load. The table below lists the same Properties, each with its Tickets and urgency.'));
    mapElement.setAttribute('aria-label', 'Map (not available)');
  }

  function canUseWebgl() {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  }

  function groupName(count, properties, tradies, worst) {
    const parts = [];
    if (properties) parts.push(properties === 1 ? '1 Property' : `${properties} Properties`);
    if (tradies) parts.push(tradies === 1 ? '1 Tradie' : `${tradies} Tradies`);
    return `Group of ${count} pins: ${parts.join(' and ')}${worst && worst !== 'routine' ? `, worst urgency ${worst}` : ''}. Press Enter to zoom in.`;
  }

  function addPin(key, kind, level, count, label, item, rank) {
    const element = pin(kind, level, count);
    const size = PIN_SIZE[kind === 'tradie' ? 'tradie' : level];
    const button = markerButton(element, size, label);
    button.dataset.pinKey = key;
    button.style.zIndex = String((rank + 1) * 1000);
    button.addEventListener('click', () => select(key, button));
    const lngLat = [item.lng, item.lat];
    const marker = new maplibregl.Marker({ element: button, anchor: 'center' }).setLngLat(lngLat);
    const entry = { marker, button, element, lngLat, rank, shown: false };
    markers.set(key, entry);
    return entry;
  }

  /** Every pin as a GeoJSON point, which is all MapLibre needs to work out the groups. */
  function pinFeatures() {
    return [...markers].map(([key, entry]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: entry.lngLat }, properties: { key, rank: entry.rank } }));
  }

  /** The groups MapLibre has made at this zoom, one feature each (a tile edge can repeat one). */
  function clusterFeatures() {
    const seen = new Map();
    for (const feature of map.querySourceFeatures(PINS, { filter: ['has', 'point_count'] })) seen.set(feature.properties.cluster_id, feature);
    return [...seen.values()];
  }

  /** Puts a button on the map for each pin and group MapLibre has made at this zoom, and takes the rest off. */
  function drawMarkers() {
    if (!map.getSource(PINS) || !map.isSourceLoaded(PINS)) return;
    const standing = new Set();
    const grouped = new Set();
    for (const feature of map.querySourceFeatures(PINS)) {
      const props = feature.properties;
      if (props.cluster) {
        const id = props.cluster_id;
        grouped.add(id);
        if (!groups.has(id)) addGroup(id, feature.geometry.coordinates, props);
      } else {
        standing.add(props.key);
      }
    }
    for (const [key, entry] of markers) {
      if (standing.has(key) === entry.shown) continue;
      if (standing.has(key)) entry.marker.addTo(map);
      else entry.marker.remove();
      entry.shown = standing.has(key);
    }
    for (const [id, shown] of groups) {
      if (grouped.has(id)) continue;
      shown.marker.remove();
      groups.delete(id);
    }
  }

  // A group: a white disc with the number of pins in it, ringed in Rust or Ochre when a
  // Property in it has an Urgent or High Ticket. Enter or a click zooms in to it.
  function addGroup(id, lngLat, props) {
    const count = props.point_count;
    const worst = WORST[Math.max(0, props.rank)];
    const disc = groupDisc(count);
    if (worst === 'urgent' || worst === 'high') disc.classList.add(`is-${worst}`);
    const button = markerButton(disc, GROUP_SIZE, groupName(count, props.properties, props.tradies, worst));
    button.classList.add('map-group-icon');
    button.style.zIndex = '500';
    button.addEventListener('click', () => zoomToGroup(id, lngLat));
    const marker = new maplibregl.Marker({ element: button, anchor: 'center' }).setLngLat(lngLat).addTo(map);
    groups.set(id, { marker, button, disc });
  }

  async function zoomToGroup(id, lngLat) {
    const zoom = await map.getSource(PINS).getClusterExpansionZoom(id);
    map.easeTo({ center: lngLat, zoom: Math.min(zoom, map.getMaxZoom()), animate: !reduceMotion });
    // The group's button goes when it splits: keep the keyboard on the map.
    map.getCanvas().focus({ preventScroll: true });
  }

  /** The group holding this pin at the zoom the map is at, if the pin is in one. */
  async function groupHolding(key) {
    const source = map.getSource(PINS);
    for (const feature of clusterFeatures()) {
      const leaves = await source.getClusterLeaves(feature.properties.cluster_id, feature.properties.point_count, 0);
      if (leaves.some((leaf) => leaf.properties.key === key)) return feature;
    }
    return null;
  }

  /** A group holding the picked pin is marked too, in case the map is zoomed out again. */
  async function markSelectedGroup() {
    const pinned = selected && markers.get(selected);
    const turn = step;
    const holder = pinned && !pinned.shown ? await groupHolding(selected) : null;
    if (turn !== step) return;
    for (const [id, shown] of groups) shown.disc.classList.toggle('is-selected', id === holder?.properties.cluster_id);
  }

  /** Waits for the map to finish moving and drawing (or a moment, if there was nothing to do). */
  function settled() {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      map.once('idle', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  // The picked pin: raised and ringed, with the Tradie search radius drawn quietly around a Property.
  // Picked from the table (`bring`), the map zooms in until the pin stands on its own, and
  // shows it; the map doesn't zoom out to the ring.
  async function showOnMap(key, bring) {
    const pinned = markers.get(key);
    if (!pinned) return;
    const turn = step;
    pinned.element.classList.add('is-selected');
    pinned.button.style.zIndex = '100000';
    if (key.startsWith('property-')) setRing(pinned.lngLat);
    if (bring && (!pinned.shown || !map.getBounds().contains(pinned.lngLat))) {
      map.easeTo({ center: pinned.lngLat, animate: !reduceMotion });
      await settled();
    }
    for (let attempt = 0; attempt < 6 && turn === step; attempt++) {
      const holder = bring ? await groupHolding(key) : null;
      if (!holder || turn !== step) break;
      const zoom = await map.getSource(PINS).getClusterExpansionZoom(holder.properties.cluster_id);
      if (zoom <= map.getZoom() && map.getZoom() >= map.getMaxZoom()) break;
      map.easeTo({ center: pinned.lngLat, zoom: Math.min(Math.max(zoom, map.getZoom() + 0.01), map.getMaxZoom()), animate: !reduceMotion });
      await settled();
    }
    if (turn === step) markSelectedGroup();
  }

  /** A line around `lngLat` at the Tradie search radius, or none. */
  function setRing(lngLat) {
    const source = map?.getSource(RING);
    if (!source) return;
    const coordinates = [];
    if (lngLat) {
      const dLat = data.radiusKm / 111.32;
      const dLng = dLat / Math.cos((lngLat[1] * Math.PI) / 180);
      for (let i = 0; i <= 128; i++) {
        const angle = (i / 128) * 2 * Math.PI;
        coordinates.push([lngLat[0] + dLng * Math.cos(angle), lngLat[1] + dLat * Math.sin(angle)]);
      }
    }
    source.setData({ type: 'FeatureCollection', features: coordinates.length ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} }] : [] });
  }

  async function start() {
    mapElement.replaceChildren(note('Loading the map…'));
    if (!canUseWebgl()) return fail();
    try {
      maplibregl = await import('/assets/maplibre-gl.mjs');
    } catch {
      return fail();
    }

    const propertyPoints = data.properties.map((p) => [p.lng, p.lat]);
    const tradiePoints = data.tradies.map((t) => [t.lng, t.lat]);
    // Open on the Agency's Properties (the Tradies around them may be spread across Sydney).
    const framed = propertyPoints.length ? propertyPoints : tradiePoints;
    const bounds = framed.length ? framed.reduce((box, [lng, lat]) => box.extend([lng, lat]), new maplibregl.LngLatBounds(framed[0], framed[0])) : null;

    mapElement.replaceChildren();
    try {
      map = new maplibregl.Map({
        container: mapElement,
        style: data.style,
        center: [151.2093, -33.8688],
        zoom: 11,
        ...(bounds ? { bounds, fitBoundsOptions: { padding: 32, maxZoom: 15, animate: false } } : {}),
        // Street level is close enough to tell neighbours apart.
        maxZoom: 18,
        // North up and flat: no rotating or tilting with the mouse, touch or keyboard.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
        // The credit OpenFreeMap asks for comes with its style: keep it written out in the corner.
        attributionControl: { compact: false },
      });
    } catch {
      return fail();
    }
    const current = map;
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, showZoom: true, visualizePitch: false }), 'top-left');
    // The page scrolls: the wheel only zooms the map once the map has been clicked or focused.
    map.scrollZoom.disable();
    mapElement.addEventListener('focusin', () => map?.scrollZoom.enable());
    mapElement.addEventListener('focusout', () => map?.scrollZoom.disable());

    let styled = false;
    map.on('error', (event) => {
      // Before its style is in, nothing can be drawn. After, a tile, sprite or font that fails just leaves the basemap plain.
      if (map === current && !styled && !event.sourceId && !event.tile) fail();
    });
    map.once('style.load', () => {
      styled = true;
      const ring = getComputedStyle(mapElement).getPropertyValue('--action').trim() || '#1f5c8b';
      map.addSource(RING, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: RING, type: 'line', source: RING, paint: { 'line-color': ring, 'line-width': 1.5, 'line-opacity': 0.55, 'line-dasharray': [2.7, 4] } });
      for (const p of data.properties) {
        const open = p.openTickets === 1 ? '1 open Ticket' : `${p.openTickets} open Tickets`;
        const worst = p.urgency ? `, worst urgency ${p.urgency}` : '';
        addPin(p.key, 'property', p.urgency || 'none', p.openTickets, `${p.address}, ${open}${worst}`, p, RANK[p.urgency] || 0);
      }
      for (const t of data.tradies) addPin(t.key, 'tradie', 'tradie', 0, `Tradie: ${t.name}, ${t.trades.join(', ').replaceAll('_', ' ')}`, t, -1);
      // MapLibre groups the points that are within 40 px of each other, as the map is zoomed, and says
      // how many Properties and Tradies are in each, and the worst Urgency among them. Its layer draws nothing:
      // the groups and pins are the buttons above.
      map.addSource(PINS, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: pinFeatures() },
        cluster: true,
        clusterRadius: 40,
        clusterMaxZoom: 17,
        clusterProperties: {
          rank: ['max', ['get', 'rank']],
          properties: ['+', ['case', ['>=', ['get', 'rank'], 0], 1, 0]],
          tradies: ['+', ['case', ['<', ['get', 'rank'], 0], 1, 0]],
        },
      });
      map.addLayer({ id: PINS, type: 'circle', source: PINS, paint: { 'circle-radius': 1, 'circle-opacity': 0 } });
      map.on('render', drawMarkers);
      // Moving the map by hand (the mouse, touch, keys, the zoom buttons) ends a pick's own zooming in.
      map.on('movestart', (event) => {
        if (event.originalEvent) step++;
      });
      map.on('moveend', markSelectedGroup);
      // Arrived on a link to a panel before the map was ready: its pin is picked now.
      if (selected) showOnMap(selected, true);
    });
  }

  start();

  // Arriving on a link to a panel (a reload, a shared address) picks it.
  const fromHash = location.hash.startsWith('#panel-') ? location.hash.slice('#panel-'.length) : null;
  if (fromHash && panels.has(fromHash)) select(fromHash, null);
})();
