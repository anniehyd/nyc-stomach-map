/* Gentle Stomach Map NYC — app logic
   Data comes from data.js (window.PLACES, window.CHAINS). Everything else is here:
   opening-hours parsing (OSM syntax subset), geolocation, Leaflet map, list, SOS mode. */
(function () {
  'use strict';

  const TZ = 'America/New_York';
  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const DAY_ZH = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const SOON_MIN = 45;            // "closing soon" threshold
  const SOS_RADIUS_M = 1600;      // ~20 min walk
  const WALK_M_PER_MIN = 80;

  /* ---------- time in New York ---------- */
  function nowNY(date) {
    const d = date || new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t).value;
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    const h = parseInt(get('hour'), 10) % 24;
    const m = parseInt(get('minute'), 10);
    return { day: wd, minutes: h * 60 + m, hhmm: pad(h) + ':' + pad(m) };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtMin(min) { min = ((min % 1440) + 1440) % 1440; return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }

  /* ---------- opening_hours (OSM subset) ----------
     Supports: "24/7", "Mo-Fr 08:00-22:00; Sa,Su 09:00-23:00", "Mo-Su 10:00-02:00" (overnight),
     "Mo off", "PH off" (ignored), multiple ranges "08:00-11:00,17:00-22:00".
     Returns per-day list of [start, end] minutes, end may exceed 1440 for overnight. */
  function parseHours(spec) {
    const week = DAYS.map(() => []);
    if (!spec) return { week, unknown: true };
    const s = spec.trim();
    if (/^24\s*\/\s*7$/.test(s)) { week.forEach((d) => d.push([0, 1440])); return { week, always: true }; }
    s.split(';').forEach((rule) => {
      rule = rule.trim();
      if (!rule || /^PH/.test(rule)) return;
      const m = rule.match(/^([A-Za-z,\-\s]*?)\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*,?\s*)+|off|closed)$/);
      if (!m) return;
      const dayPart = m[1].trim();
      const timePart = m[2].trim();
      const days = dayPart ? expandDays(dayPart) : DAYS.map((_, i) => i);
      days.forEach((d) => { week[d] = []; });            // later rule overrides earlier for those days
      if (/^(off|closed)$/.test(timePart)) return;
      timePart.split(',').forEach((rng) => {
        const t = rng.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
        if (!t) return;
        let a = +t[1] * 60 + +t[2], b = +t[3] * 60 + +t[4];
        if (b <= a) b += 1440;                              // overnight
        days.forEach((d) => week[d].push([a, b]));
      });
    });
    return { week };
  }
  function expandDays(str) {
    const out = [];
    str.split(',').forEach((tok) => {
      tok = tok.trim();
      const r = tok.match(/^([A-Za-z]{2})\s*-\s*([A-Za-z]{2})$/);
      if (r) {
        let a = DAYS.indexOf(r[1]), b = DAYS.indexOf(r[2]);
        if (a < 0 || b < 0) return;
        for (let i = a; ; i = (i + 1) % 7) { out.push(i); if (i === b) break; }
      } else {
        const i = DAYS.indexOf(tok);
        if (i >= 0) out.push(i);
      }
    });
    return out;
  }
  /* status: {open, closesIn, opensAt, soon, text} */
  function hoursStatus(parsed, t) {
    if (parsed.unknown) return { open: null, text: 'Hours unknown' };
    if (parsed.always) return { open: true, closesIn: Infinity, text: 'Open 24h' };
    const today = parsed.week[t.day];
    const yday = parsed.week[(t.day + 6) % 7];
    // ranges that spill over from yesterday
    for (const [a, b] of yday) {
      if (b > 1440 && t.minutes < b - 1440) {
        const left = b - 1440 - t.minutes;
        return { open: true, closesIn: left, soon: left <= SOON_MIN, text: 'Open till ' + fmtMin(b) };
      }
    }
    for (const [a, b] of today) {
      if (t.minutes >= a && t.minutes < b) {
        const left = b - t.minutes;
        return { open: true, closesIn: left, soon: left <= SOON_MIN, text: 'Open till ' + fmtMin(b) + (left <= SOON_MIN ? ' (closes in ' + left + ' min)' : '') };
      }
    }
    // next opening today
    const next = today.filter(([a]) => a > t.minutes).sort((x, y) => x[0] - y[0])[0];
    if (next) return { open: false, opensIn: next[0] - t.minutes, text: 'Opens today ' + fmtMin(next[0]) };
    for (let k = 1; k <= 7; k++) {
      const d = (t.day + k) % 7;
      const r = parsed.week[d].slice().sort((x, y) => x[0] - y[0])[0];
      if (r) return { open: false, text: 'Opens ' + (k === 1 ? 'tomorrow' : DAY_ZH[d]) + ' ' + fmtMin(r[0]) };
    }
    return { open: false, text: 'Closed' };
  }
  function hoursHuman(parsed) {
    if (parsed.unknown) return 'Hours unknown';
    if (parsed.always) return 'Open 24 hours, every day';
    // group consecutive days with identical ranges
    const lines = [];
    const order = [1, 2, 3, 4, 5, 6, 0];
    let i = 0;
    while (i < 7) {
      const d = order[i];
      const key = JSON.stringify(parsed.week[d]);
      let j = i;
      while (j + 1 < 7 && JSON.stringify(parsed.week[order[j + 1]]) === key) j++;
      const label = i === j ? DAY_ZH[d] : DAY_ZH[d] + '–' + DAY_ZH[order[j]];
      const val = parsed.week[d].length ? parsed.week[d].map(([a, b]) => (a === 0 && b === 1440 ? 'all day' : fmtMin(a) + '–' + (b === 1440 ? '24:00' : fmtMin(b)))).join(', ') : 'closed';
      lines.push(label + '  ' + val);
      i = j + 1;
    }
    return lines.join('\n');
  }

  /* ---------- geo ---------- */
  function distM(a, b) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function fmtDist(m) {
    if (m == null) return '';
    const min = Math.round(m / WALK_M_PER_MIN);
    const mi = m / 1609.344;
    return (mi < 0.1 ? Math.round(m * 3.28084 / 50) * 50 + ' ft' : mi.toFixed(1) + ' mi') + ' · ' + min + ' min walk';
  }

  /* ---------- state ---------- */
  const places = (window.PLACES || []).map((p, i) => ({ ...p, id: p.id || 'p' + i, parsed: parseHours(p.hours) }));
  const chains = window.CHAINS || [];
  const state = { onlyOpen: true, cat: 'all', sos: false, me: null, meLabel: '', active: null };

  /* ---------- map ---------- */
  const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([40.7306, -73.9866], 13);
  L.control.zoom({ position: 'topright' }).addTo(map);
  // OpenStreetMap's standard tiles: free, no API key. Dark mode is handled in CSS (.leaflet-tile filter).
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  let meMarker = null, meCircle = null;
  const markers = {};

  function pinIcon(cls) { return L.divIcon({ className: '', html: '<div class="pin ' + cls + '"></div>', iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -8] }); }

  /* ---------- rendering ---------- */
  const $ = (s) => document.querySelector(s);
  const cardsEl = $('#cards'), statusEl = $('#status'), tpl = $('#tpl-card');

  function statusClass(p) {
    if (p.st.open === false) return 'closed';
    if (p.st.soon) return 'soon';
    return p.tier === 'safe' ? 'safe' : 'ok';
  }

  function compute() {
    const t = nowNY();
    places.forEach((p) => {
      p.st = hoursStatus(p.parsed, t);
      p.dist = state.me ? distM(state.me, p) : null;
    });
    let list = places.slice();
    if (state.cat !== 'all') list = list.filter((p) => (p.cats || []).includes(state.cat));
    if (state.onlyOpen) list = list.filter((p) => p.st.open !== false);
    if (state.sos) {
      list = list.filter((p) => p.st.open && !(p.st.soon && p.st.closesIn < 15));
      if (state.me) list = list.filter((p) => p.dist <= SOS_RADIUS_M);
    }
    list.sort((a, b) => {
      if (state.me) return a.dist - b.dist;
      // no location: safe tier first, then open, then name
      const ta = a.tier === 'safe' ? 0 : 1, tb = b.tier === 'safe' ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return (b.st.open === true) - (a.st.open === true);
    });
    return { list, t };
  }

  function render() {
    const { list, t } = compute();
    // status line
    const openCount = places.filter((p) => p.st.open).length;
    let msg = 'New York time ' + DAY_ZH[t.day] + ' ' + t.hhmm + ' · ' + openCount + ' of ' + places.length + ' places open now';
    if (state.sos) {
      msg = state.me ? (list.length + ' open now within a 20-min walk' + (state.meLabel ? ' of ' + state.meLabel : '') + ', nearest first')
                     : ('No location yet, so safe spots are listed first; tap “My location” for distances.');
      $('#sos-text').textContent = state.me ? 'Only places within 1 mile, open now, and open for at least 15 more minutes. Sip warm water and walk slowly.'
                                            : 'Allow location to sort by distance. Sip warm water; don’t lie down.';
    } else if (!state.me) {
      msg += ' · tap “My location” or Home / School / Work for distances';
    } else if (state.meLabel) {
      msg += ' · distances from ' + state.meLabel;
    }
    statusEl.textContent = msg;

    // cards
    cardsEl.innerHTML = '';
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'status';
      li.textContent = state.onlyOpen ? 'Nothing open right now with these filters. Turn off “Open now only”, or check the chain cheat sheet below (many CVS / Duane Reade stores run 24h).' : 'No places match these filters.';
      cardsEl.appendChild(li);
    }
    list.forEach((p) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = p.id;
      const cls = statusClass(p);
      node.querySelector('.card-dot').classList.add('dot-' + cls);
      node.querySelector('.card-name').textContent = p.name;
      node.querySelector('.card-name-en').textContent = p.name_local || p.neighborhood || '';
      node.querySelector('.card-dist').textContent = p.dist != null ? fmtDist(p.dist) : (p.neighborhood || '');
      const openEl = node.querySelector('.card-open');
      openEl.textContent = p.st.text;
      openEl.classList.add(p.st.open === false ? 'o-closed' : p.st.soon ? 'o-soon' : 'o-open');
      node.querySelector('.card-addr').textContent = p.address + (p.neighborhood ? ' · ' + p.neighborhood : '');
      const buy = node.querySelector('.card-buy');
      (p.buy || []).forEach((b) => { const li = document.createElement('li'); li.textContent = b; buy.appendChild(li); });
      node.querySelector('.card-avoid').textContent = p.avoid || '—';
      node.querySelector('.card-hours').textContent = hoursHuman(p.parsed) + (p.notes ? '\n' + p.notes : (p.confidence && p.confidence !== 'high' ? '\nHours unverified; call before you go.' : ''));
      node.querySelector('.card-nav').href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(p.name + ', ' + p.address);
      const src = node.querySelector('.card-src');
      if (p.source) src.href = p.source; else src.remove();
      if (p.id === state.active) { node.classList.add('is-active'); node.querySelector('.card-body').hidden = false; }
      node.querySelector('.card-head').addEventListener('click', () => focusPlace(p.id, true));
      cardsEl.appendChild(node);
    });

    // markers
    layer.clearLayers();
    for (const k in markers) delete markers[k];
    const visibleIds = new Set(list.map((p) => p.id));
    places.forEach((p) => {
      if (!visibleIds.has(p.id)) return;
      const cls = statusClass(p);
      const mk = L.marker([p.lat, p.lng], { icon: pinIcon('pin-' + cls), title: p.name });
      mk.bindPopup('<b>' + esc(p.name) + '</b><br>' + esc(p.st.text) + (p.dist != null ? ' · ' + esc(fmtDist(p.dist)) : '') +
        '<br><span style="color:var(--safe)">Order: </span>' + esc((p.buy || [])[0] || ''));
      mk.on('click', () => focusPlace(p.id, false));
      mk.addTo(layer);
      markers[p.id] = mk;
    });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function focusPlace(id, pan) {
    state.active = state.active === id ? null : id;
    cardsEl.querySelectorAll('.card').forEach((c) => {
      const on = c.dataset.id === state.active;
      c.classList.toggle('is-active', on);
      c.querySelector('.card-body').hidden = !on;
    });
    const p = places.find((x) => x.id === id);
    if (state.active && p) {
      if (pan) map.panTo([p.lat, p.lng]);
      if (markers[id]) markers[id].openPopup();
      const card = cardsEl.querySelector('.card[data-id="' + id + '"]');
      if (card && !pan) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /* ---------- chains ---------- */
  (function renderChains() {
    const wrap = $('#chain-list');
    chains.forEach((c) => {
      const d = document.createElement('details');
      d.className = 'chain';
      d.innerHTML = '<summary>' + esc(c.brand) + (c.note ? ' <span class="muted" style="font-weight:400;font-size:12.5px">' + esc(c.note) + '</span>' : '') + '</summary>' +
        '<div class="chain-body"><div><h4 class="h-buy">Buy</h4><ul>' + (c.buy || []).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' +
        '<div><h4 class="h-avoid">Skip</h4><ul>' + (c.avoid || []).map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div></div>';
      wrap.appendChild(d);
    });
  })();

  /* ---------- location ---------- */
  function locate(thenSOS) {
    if (!navigator.geolocation) { statusEl.textContent = 'This browser does not support location.'; return; }
    statusEl.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition((pos) => {
      state.me = { lat: pos.coords.latitude, lng: pos.coords.longitude }; state.meLabel = '';
      document.querySelectorAll('.chip-anchor').forEach((c) => c.classList.remove('is-on'));
      // keep demo users outside NYC usable: don't fly off to another continent
      const inNYC = state.me.lat > 40.45 && state.me.lat < 41.0 && state.me.lng > -74.3 && state.me.lng < -73.6;
      if (!inNYC) { statusEl.textContent = 'You are not near New York; the map stays on NYC and distances are straight-line.'; }
      if (meMarker) { meMarker.setLatLng(state.me); meCircle.setLatLng(state.me); }
      else {
        meMarker = L.marker(state.me, { icon: L.divIcon({ className: '', html: '<div class="pin-me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000 }).addTo(map);
        meCircle = L.circle(state.me, { radius: SOS_RADIUS_M, color: '#2f6fde', weight: 1, fillOpacity: .04, dashArray: '4 4' }).addTo(map);
      }
      if (inNYC) map.setView(state.me, thenSOS ? 15 : 14);
      try { localStorage.setItem('me', JSON.stringify(state.me)); } catch (e) { /* ignore */ }
      render();
    }, (err) => {
      statusEl.textContent = err.code === 1 ? 'Location was denied. Allow it in the browser’s address bar, or use the Home / School / Work buttons.' : 'Could not get your location. Try again in a moment.';
      render();
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  /* ---------- controls ---------- */
  $('#btn-locate').addEventListener('click', () => locate(false));
  $('#f-open').addEventListener('change', (e) => { state.onlyOpen = e.target.checked; render(); });
  $('#anchors').addEventListener('click', (e) => {
    const b = e.target.closest('.chip-anchor'); if (!b) return;
    const on = !b.classList.contains('is-on');
    document.querySelectorAll('.chip-anchor').forEach((c) => c.classList.toggle('is-on', c === b && on));
    if (!on) { state.me = null; state.meLabel = ''; render(); return; }
    state.me = { lat: +b.dataset.lat, lng: +b.dataset.lng };
    state.meLabel = b.textContent.replace(/^\S+\s/, '').split(' · ')[0];
    if (meMarker) { meMarker.setLatLng(state.me); meCircle.setLatLng(state.me); }
    else {
      meMarker = L.marker(state.me, { icon: L.divIcon({ className: '', html: '<div class="pin-me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000 }).addTo(map);
      meCircle = L.circle(state.me, { radius: SOS_RADIUS_M, color: '#2f6fde', weight: 1, fillOpacity: .04, dashArray: '4 4' }).addTo(map);
    }
    map.setView(state.me, 15);
    render();
  });
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    state.cat = b.dataset.cat;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c === b));
    render();
  });
  function setSOS(on) {
    state.sos = on;
    $('#sos-banner').hidden = !on;
    $('#btn-sos').classList.toggle('is-on', on);
    if (on) { state.onlyOpen = true; $('#f-open').checked = true; state.cat = 'all'; document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c.dataset.cat === 'all')); }
    const panel = $('#panel');
    if (on) { panel.classList.remove('is-short'); }
    render();
    if (on && !state.me) locate(true);
  }
  $('#btn-sos').addEventListener('click', () => setSOS(!state.sos));
  $('#btn-sos-off').addEventListener('click', () => setSOS(false));

  /* bottom sheet drag (phones) */
  (function sheet() {
    const panel = $('#panel'), grip = $('#panel-grip');
    let startY = 0, startH = 0;
    const onStart = (y) => { startY = y; startH = panel.getBoundingClientRect().height; panel.style.transition = 'none'; };
    const onMove = (y) => { const h = Math.max(100, Math.min(window.innerHeight * .9, startH + (startY - y))); panel.style.height = h + 'px'; };
    const onEnd = () => {
      panel.style.transition = '';
      const h = panel.getBoundingClientRect().height, vh = window.innerHeight;
      panel.style.height = '';
      panel.classList.remove('is-tall', 'is-short');
      if (h < vh * .3) panel.classList.add('is-short'); else if (h > vh * .65) panel.classList.add('is-tall');
      $('.legend').classList.toggle('is-low', panel.classList.contains('is-short'));
    };
    grip.addEventListener('touchstart', (e) => onStart(e.touches[0].clientY), { passive: true });
    grip.addEventListener('touchmove', (e) => onMove(e.touches[0].clientY), { passive: true });
    grip.addEventListener('touchend', onEnd);
    grip.addEventListener('click', () => { panel.classList.toggle('is-tall'); panel.classList.remove('is-short'); });
  })();

  /* clock + periodic refresh so "open now" stays right while the page sits open */
  function tick() { const t = nowNY(); $('#clock').textContent = 'New York · ' + DAY_ZH[t.day] + ' ' + t.hhmm; }
  tick(); setInterval(tick, 15000); setInterval(render, 60000);

  /* restore last location (per device) so distances show immediately */
  try { const m = JSON.parse(localStorage.getItem('me')); if (m && m.lat) { state.me = m; } } catch (e) { /* ignore */ }

  render();
  if (places.length) {
    const b = L.latLngBounds(places.map((p) => [p.lat, p.lng]));
    if (!state.me) map.fitBounds(b.pad(0.08));
    else map.setView(state.me, 14);
  }
  window.__wy = { parseHours, hoursStatus, hoursHuman, nowNY }; // for tests
})();
