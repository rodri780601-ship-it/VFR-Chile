/* VFR Chile — planificador de vuelo VFR para pilotos civiles.
   Datos de aeródromos: IFIS / AIP Chile (DGAC). Meteorología: aviationweather.gov y Open-Meteo.
   Herramienta de apoyo: no reemplaza el AIP vigente, los NOTAM, el briefing oficial ni los instrumentos de la aeronave. */
'use strict';

/* ------------------------------------------------------------------ utilidades */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const AD = (window.AERODROMOS || []).filter(a => a.i);
const ADX = Object.fromEntries(AD.map(a => [a.i, a]));
const EA = window.ESPACIO_AEREO || null; /* zonas P/R/D y cartas del AIP (data/espacio-aereo.js) */
const R_NM = 3440.065, D2R = Math.PI / 180, R2D = 180 / Math.PI;
const TIPO = { C: 'Civil', M: 'Militar', X: 'Mixto', H: 'Helipuerto' };
const REGIONES = ['Arica y Parinacota', 'Tarapacá', 'Antofagasta', 'Atacama', 'Coquimbo', 'Valparaíso', 'Metropolitana', "O'Higgins", 'Maule', 'Ñuble', 'Biobío', 'La Araucanía', 'Los Ríos', 'Los Lagos', 'Aysén', 'Magallanes', 'Heliplataformas (offshore)'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = x => ((x % 360) + 360) % 360;
const hdg = x => { if (x == null || isNaN(x)) return '—'; const v = Math.round(norm(x)); return String(v === 0 ? 360 : v).padStart(3, '0'); };
const num = (x, d = 0) => (x == null || isNaN(x)) ? '—' : Number(x).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
const hmm = h => { if (h == null || !isFinite(h) || h < 0) return '—'; const m = Math.round(h * 60); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); };
const hhmm = d => d ? d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function distNM(a, b) {
  const p1 = a.la * D2R, p2 = b.la * D2R, dp = p2 - p1, dl = (b.lo - a.lo) * D2R;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a, b) {
  const p1 = a.la * D2R, p2 = b.la * D2R, dl = (b.lo - a.lo) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm(Math.atan2(y, x) * R2D);
}
/* distancia perpendicular de p a la ruta a→b (NM, + = a la derecha) y distancia recorrida a lo largo */
function crossTrack(a, b, p) {
  const d13 = distNM(a, p) / R_NM, t13 = bearing(a, p) * D2R, t12 = bearing(a, b) * D2R;
  const xt = Math.asin(Math.sin(d13) * Math.sin(t13 - t12));
  const at = Math.acos(clamp(Math.cos(d13) / Math.cos(xt), -1, 1));
  return { xtk: xt * R_NM, atk: at * R_NM * Math.sign(Math.cos(t13 - t12) || 1) };
}
function interp(a, b, f) { // punto intermedio aproximado (suficiente para tramos VFR)
  return { la: a.la + (b.la - a.la) * f, lo: a.lo + (b.lo - a.lo) * f };
}
/* triángulo de velocidades: viento "desde" wd a ws kt */
function windTriangle(tc, tas, wd, ws) {
  if (!ws) return { wca: 0, gs: tas };
  const ang = (wd - tc) * D2R;
  const s = clamp(ws * Math.sin(ang) / tas, -1, 1);
  const wca = Math.asin(s);
  const gs = tas * Math.cos(wca) - ws * Math.cos(ang);
  return { wca: wca * R2D, gs };
}

/* Orto / ocaso (algoritmo de suncalc, V. Agafonkin, BSD) */
const SUN = (() => {
  const dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = D2R * 23.4397, J0 = 0.0009;
  const toDays = d => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const fromJ = j => new Date((j + 0.5 - J1970) * dayMs);
  const M_ = d => D2R * (357.5291 + 0.98560028 * d);
  const L_ = M => M + D2R * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + D2R * 102.9372 + Math.PI;
  const dec = l => Math.asin(Math.sin(e) * Math.sin(l));
  const transit = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  return function times(date, lat, lng) {
    const lw = D2R * -lng, phi = D2R * lat, d = toDays(date);
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n;
    const M = M_(ds), L = L_(M), dc = dec(L), Jnoon = transit(ds, M, L);
    const at = h => {
      const c = (Math.sin(h * D2R) - Math.sin(phi) * Math.sin(dc)) / (Math.cos(phi) * Math.cos(dc));
      if (c < -1 || c > 1) return [null, null];
      const w = Math.acos(c);
      const Jset = transit(J0 + (w + lw) / (2 * Math.PI) + n, M, L);
      return [fromJ(Jnoon - (Jset - Jnoon)), fromJ(Jset)];
    };
    const [rise, set] = at(-0.833), [dawn, dusk] = at(-6);
    return { rise, set, dawn, dusk, noon: fromJ(Jnoon) };
  };
})();
function localNoon(d) { const x = new Date(d); x.setHours(12, 0, 0, 0); return x; }

/* ------------------------------------------------------------------ estado */
const LS = 'vfrchile.v1';
const DEF = {
  ac: { reg: '', type: '', tas: 100, ff: 30, unit: 'L', fuel: 140, taxi: 4, res: 45, mvar: 0 },
  plan: { dep: null, wps: [], dest: null, alt: null, cruise: 4500, depTime: '', winds: [] },
  saved: [], wxAd: 'SCEL', map: { layer: 'osm', H: true, f: { pub: true, pvt: true, mil: true, mix: true, hel: true }, z: { P: true, R: true, D: true }, view: null }, ok: false
};
let S = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem(LS)); if (s) return deepMerge(structuredClone(DEF), s); } catch (e) { }
  return structuredClone(DEF);
}
function deepMerge(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { } }, 250); }

/* punto de ruta: {i:'SCEL'} o {n:'Nombre', la, lo} */
function resolve(p) {
  if (!p) return null;
  if (p.i) { const a = ADX[p.i]; return a && a.la != null ? { id: a.i, name: a.n, la: a.la, lo: a.lo, e: a.e, ad: a } : null; }
  return { id: p.n, name: p.n, la: p.la, lo: p.lo, custom: true };
}
function routePts() { const P = S.plan; return [P.dep, ...P.wps, P.dest].map(resolve); }
function routeValid() { const r = routePts(); return r.length >= 2 && r.every(Boolean); }

/* ------------------------------------------------------------------ UI básica */
let toastT;
function toast(msg, ms = 2400) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function openModal(title, html) { $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; $('#modal').classList.remove('hidden'); return $('#modal-body'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modal-body').innerHTML = ''; }
$('#modal-close').onclick = closeModal;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

function showView(id) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === id));
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  if (id === 'v-mapa' && MAP.map) setTimeout(() => MAP.map.invalidateSize(), 50);
  if (id === 'v-ad') renderAdList();
  if (id === 'v-vuelo') renderNav();
}
$$('.tabbar button').forEach(b => b.onclick = () => showView(b.dataset.view));

function updateNet() { const p = $('#net-pill'); p.textContent = navigator.onLine ? 'En línea' : 'Sin conexión'; p.classList.toggle('off', !navigator.onLine); }
addEventListener('online', updateNet); addEventListener('offline', updateNet); updateNet();

function adTags(a) {
  let t = '';
  if (a.x) t += '<span class="tag x">CERRADO</span>';
  if (a.t === 'M') t += '<span class="tag mil">MIL</span>'; else if (a.t === 'H') t += '<span class="tag hlp">HLP</span>';
  t += a.p ? '<span class="tag pub">PUB</span>' : '<span class="tag">PVT</span>';
  if (a.m) t += '<span class="tag">METAR</span>';
  return t;
}

/* Selector de aeródromo (modal con búsqueda) */
function pickAerodrome(title, cb, opts = {}) {
  const body = openModal(title, `<div class="search-row"><input id="pk-q" type="search" placeholder="Nombre, OACI o región" autocomplete="off"></div>
    ${opts.allowClear ? '<button id="pk-clear" class="btn small danger" type="button" style="margin-top:8px">Quitar selección</button>' : ''}
    <div id="pk-list" class="list" style="margin-top:10px"></div>`);
  const q = $('#pk-q', body), list = $('#pk-list', body);
  const draw = () => {
    const res = searchAd(q.value, { pos: NAV.pos }).slice(0, 80);
    list.innerHTML = res.map(a => adItem(a)).join('') || '<p class="muted">Sin resultados</p>';
  };
  list.onclick = e => { const it = e.target.closest('[data-icao]'); if (it) { closeModal(); cb({ i: it.dataset.icao }); } };
  if (opts.allowClear) $('#pk-clear', body).onclick = () => { closeModal(); cb(null); };
  q.oninput = draw; draw(); setTimeout(() => q.focus(), 80);
}
function adItem(a, extra = '') {
  const d = NAV.pos && a.la != null ? distNM(NAV.pos, a) : null;
  return `<button class="item" data-icao="${a.i}" type="button"><span class="ic">${a.i}</span>
    <span class="tx"><b>${esc(a.n)}</b><small>${esc(a.r || '')}${a.e != null ? ' · ' + num(a.e) + ' ft' : ''} ${adTags(a)}</small></span>
    <span class="rt">${extra || (d != null ? num(d) + ' NM<br>' + hdg(bearing(NAV.pos, a) - S.ac.mvar) + '°' : '')}</span></button>`;
}
function fold(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
AD.forEach(a => a._s = fold([a.i, a.ia, a.n, a.r, a.ad].join(' ')));
function searchAd(q, o = {}) {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  let r = AD.filter(a => terms.every(t => a._s.includes(t)));
  if (o.type) r = r.filter(a => a.t === o.type);
  if (o.use !== undefined && o.use !== '') r = r.filter(a => String(a.p) === o.use);
  if (o.reg) r = r.filter(a => a.r === o.reg);
  const Q = fold(q).trim();
  if (o.near && o.pos) r.sort((a, b) => (a.la == null) - (b.la == null) || distNM(o.pos, a) - distNM(o.pos, b));
  else r.sort((a, b) => (b.i.toLowerCase() === Q) - (a.i.toLowerCase() === Q) || (a.x || 0) - (b.x || 0) || (a.t === 'H') - (b.t === 'H') || a.n.localeCompare(b.n, 'es'));
  return r;
}

/* Ficha de aeródromo */
function showAd(icao) {
  const a = ADX[icao]; if (!a) return;
  const sun = a.la != null ? SUN(localNoon(new Date()), a.la, a.lo) : null;
  const d = NAV.pos && a.la != null ? distNM(NAV.pos, a) : null;
  const body = openModal(`${a.i} · ${a.n}`, `
    <div>${adTags(a)}</div>
    <div class="kv">
      <span>Tipo</span><b>${TIPO[a.t] || a.t}${a.us ? ' · uso ' + esc(a.us) : ''}</b>
      <span>Región</span><b>${esc(a.r || '—')}</b>
      ${a.ad ? `<span>Administra</span><b>${esc(a.ad)}</b>` : ''}
      <span>Elevación</span><b>${a.e != null ? num(a.e) + ' ft' : '—'}${a.et ? ' <small class="muted">(' + esc(a.et) + ')</small>' : ''}</b>
      <span>Coordenadas</span><b>${a.la != null ? fmtCoord(a.la, 'S', 'N') + ' ' + fmtCoord(a.lo, 'W', 'E') : '—'}</b>
      <span>Horario</span><b>${esc(a.h || '—')}</b>
      ${a.q ? `<span>Frecuencia</span><b>${esc(a.q)}${a.qd ? ' · ' + esc(a.qd) : ''}</b>` : ''}
      ${a.qo ? `<span>Obs. frec.</span><b>${esc(a.qo)}</b>` : ''}
      ${a.so ? `<span>ATS</span><b>${esc(a.so)}</b>` : ''}
      <span>Iluminación</span><b>${a.l ? 'Sí' : 'No'}</b>
      <span>FIR</span><b>${esc(a.f || '—')}</b>
      ${sun && sun.rise ? `<span>Sol hoy</span><b>Orto ${hhmm(sun.rise)} · Ocaso ${hhmm(sun.set)} · Fin crep. ${hhmm(sun.dusk)}</b>` : ''}
      ${d != null ? `<span>Desde mi posición</span><b>${num(d, 1)} NM · ${hdg(bearing(NAV.pos, a) - S.ac.mvar)}° M</b>` : ''}
    </div>
    ${a.o ? `<div class="obs">${esc(a.o)}</div>` : ''}
    <div class="btn-grid" style="margin-top:12px">
      <button class="btn" data-a="dep" type="button">Origen</button>
      <button class="btn primary" data-a="dest" type="button">Destino</button>
      <button class="btn" data-a="wp" type="button">+ Punto de ruta</button>
      <button class="btn" data-a="alt" type="button">Alternativa</button>
      <button class="btn" data-a="map" type="button">Ver en mapa</button>
      ${a.m ? '<button class="btn" data-a="wx" type="button">METAR / TAF</button>' : '<button class="btn" data-a="fc" type="button">Pronóstico</button>'}
      <button class="btn warn" data-a="direct" type="button">Directo a</button>
      ${a.u ? `<a class="btn" href="${esc(a.u)}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;color:inherit">Ficha AIP (PDF)</a>` : ''}
      ${EA && EA.cartas && EA.cartas.vac[a.i] ? `<a class="btn" href="${esc(EA.cartas.vac[a.i])}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;color:inherit">Carta visual VAC (PDF)</a>` : ''}
    </div>
    <p class="note">Datos AIP al ${esc(window.AD_FECHA || '')}. Revisa NOTAM y la publicación vigente antes de operar.</p>`);
  body.onclick = e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const act = b.dataset.a; closeModal();
    if (act === 'map') { showView('v-mapa'); MAP.focus(a); }
    else if (act === 'wx') { showView('v-meteo'); $('#wx-ids').value = a.i; loadMetar([a.i]); }
    else if (act === 'fc') { S.wxAd = a.i; save(); renderPickers(); showView('v-meteo'); loadForecast(); }
    else if (act === 'direct') { directTo({ i: a.i }); }
    else setRoutePoint(act, { i: a.i });
  };
}
function fmtCoord(v, neg, pos) { const h = v < 0 ? neg : pos; v = Math.abs(v); const d = Math.floor(v), m = (v - d) * 60; return `${d}°${m.toFixed(2).padStart(5, '0')}'${h}`; }

function setRoutePoint(role, p) {
  const P = S.plan;
  if (role === 'wp') { P.wps.push(p); toast('Punto agregado a la ruta'); }
  else { P[role] = p; toast({ dep: 'Origen', dest: 'Destino', alt: 'Alternativa' }[role] + ': ' + (p.i || p.n)); }
  planChanged();
}

/* ------------------------------------------------------------------ PLAN */
function pickerHtml(p, ph) {
  const r = resolve(p);
  if (!r) return `<span class="pk-main"><b>${ph}</b></span><span>›</span>`;
  const a = r.ad;
  return `<span class="pk-main"><b>${esc(r.id)}${a ? ' · ' + esc(a.n) : ''}</b><small>${a ? esc(a.r || '') + (a.e != null ? ' · ' + num(a.e) + ' ft' : '') : fmtCoord(r.la, 'S', 'N') + ' ' + fmtCoord(r.lo, 'W', 'E')}</small></span><span>›</span>`;
}
function renderPickers() {
  $$('.picker[data-role]').forEach(b => {
    const role = b.dataset.role;
    const p = role === 'wxad' ? { i: S.wxAd } : S.plan[role];
    b.innerHTML = pickerHtml(p, role === 'alt' ? 'Opcional' : 'Elegir aeródromo');
    b.classList.toggle('empty', !p);
  });
}
$$('.picker[data-role]').forEach(b => b.onclick = () => {
  const role = b.dataset.role;
  const title = { dep: 'Aeródromo de origen', dest: 'Aeródromo de destino', alt: 'Aeródromo alternativo', wxad: 'Pronóstico para…' }[role];
  pickAerodrome(title, p => {
    if (role === 'wxad') { if (p) { S.wxAd = p.i; save(); renderPickers(); loadForecast(); } return; }
    S.plan[role] = p; planChanged();
  }, { allowClear: role === 'alt' });
});

function renderWps() {
  $('#wp-list').innerHTML = S.plan.wps.map((p, i) => `<div class="field"><label>Punto ${i + 1}</label><div class="wp-row">
    <button class="picker" data-wp="${i}" type="button">${pickerHtml(p, 'Elegir')}</button>
    <button class="mini" data-up="${i}" type="button" aria-label="Subir">↑</button>
    <button class="mini" data-del="${i}" type="button" aria-label="Quitar">✕</button></div></div>`).join('');
}
$('#wp-list').onclick = e => {
  const t = e.target.closest('button'); if (!t) return;
  const W = S.plan.wps;
  if (t.dataset.wp) { const i = +t.dataset.wp; if (W[i].i) pickAerodrome('Cambiar punto ' + (i + 1), p => { if (p) { W[i] = p; planChanged(); } }); else toast('Punto creado en el mapa'); }
  else if (t.dataset.up) { const i = +t.dataset.up; if (i > 0) { [W[i - 1], W[i]] = [W[i], W[i - 1]]; planChanged(); } }
  else if (t.dataset.del) { W.splice(+t.dataset.del, 1); planChanged(); }
};
$('#add-wp').onclick = () => pickAerodrome('Agregar punto intermedio', p => { if (p) { S.plan.wps.push(p); planChanged(); } });

const acFields = { 'ac-reg': 'reg', 'ac-type': 'type', 'ac-tas': 'tas', 'ac-ff': 'ff', 'ac-unit': 'unit', 'ac-fuel': 'fuel', 'ac-taxi': 'taxi', 'ac-res': 'res', 'ac-var': 'mvar' };
function fillForm() {
  for (const [id, k] of Object.entries(acFields)) $('#' + id).value = S.ac[k] ?? '';
  $('#p-cruise').value = S.plan.cruise || '';
  if (!S.plan.depTime) S.plan.depTime = defaultDep();
  $('#p-dep').value = S.plan.depTime;
}
function defaultDep() { const d = new Date(Date.now() + 3600e3); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); return toLocalInput(d); }
function toLocalInput(d) { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; }
for (const [id, k] of Object.entries(acFields)) $('#' + id).addEventListener('input', e => {
  const v = e.target.value; S.ac[k] = (e.target.type === 'number') ? (v === '' ? 0 : parseFloat(v)) : v; save(); renderNavlog(); renderNav();
});
$('#p-cruise').oninput = e => { S.plan.cruise = parseFloat(e.target.value) || 0; save(); renderNavlog(); };
$('#p-dep').oninput = e => { S.plan.depTime = e.target.value; save(); renderNavlog(); };

function planChanged() {
  const n = Math.max(0, routePts().length - 1);
  S.plan.winds = Array.from({ length: n }, (_, i) => S.plan.winds[i] || null);
  save(); renderPickers(); renderWps(); renderNavlog(); MAP.drawRoute(); if (NAV.on) NAV.loadRoute(); renderNav();
}

function parseWind(s) {
  const m = String(s || '').trim().match(/^(\d{1,3})\s*[\/ ]\s*(\d{1,3})$/);
  if (!m) return null; return { d: norm(+m[1]), s: +m[2] };
}
function computePlan() {
  if (!routeValid()) return null;
  const pts = routePts(), ac = S.ac, P = S.plan;
  const tas = +ac.tas || 0, ff = +ac.ff || 0;
  const t0 = P.depTime ? new Date(P.depTime) : new Date();
  let cum = 0, cumD = 0, legs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], d = distNM(a, b), tc = bearing(a, b);
    const w = P.winds[i];
    const wt = tas > 0 ? windTriangle(tc, tas, w ? w.d : 0, w ? w.s : 0) : { wca: 0, gs: 0 };
    const gs = wt.gs, ete = gs > 0 ? d / gs : NaN;
    cum += ete; cumD += d;
    legs.push({ a, b, d, tc, w, wca: wt.wca, th: tc + wt.wca, mh: tc + wt.wca - (+ac.mvar || 0), gs, ete, fuel: ete * ff, cumD, eta: new Date(t0.getTime() + cum * 3600e3) });
  }
  const trip = legs.reduce((s, l) => s + l.fuel, 0);
  let altLeg = null;
  const alt = resolve(P.alt);
  if (alt) { const last = pts[pts.length - 1]; const d = distNM(last, alt); const tc = bearing(last, alt); const wt = tas > 0 ? windTriangle(tc, tas, 0, 0) : { gs: 0 }; altLeg = { d, tc, mh: tc - (+ac.mvar || 0), ete: wt.gs > 0 ? d / wt.gs : NaN }; altLeg.fuel = altLeg.ete * ff; }
  const reserve = ff * (+ac.res || 0) / 60, taxi = +ac.taxi || 0;
  const required = trip + taxi + reserve + (altLeg ? altLeg.fuel : 0);
  return { pts, legs, dist: cumD, ete: cum, trip, taxi, reserve, altLeg, required, fuel: +ac.fuel || 0, t0, eta: new Date(t0.getTime() + cum * 3600e3) };
}

function renderNavlog() {
  const c = computePlan(), u = S.ac.unit;
  const sum = $('#route-sum');
  if (!c) { $('#navlog').innerHTML = '<p class="muted">Elige origen y destino para calcular el navlog.</p>'; $('#totals').innerHTML = ''; $('#warnings').innerHTML = ''; sum.textContent = ''; renderTerr(null); return; }
  sum.textContent = `${num(c.dist)} NM · ${hmm(c.ete)}`;
  $('#navlog').innerHTML = `<div class="tbl-wrap"><table class="navlog"><thead><tr>
    <th>Tramo</th><th>TC</th><th>Dist</th><th>Viento °/kt</th><th>WCA</th><th>MH</th><th>GS</th><th>ETE</th><th>ETA</th><th>Comb.</th></tr></thead><tbody>
    ${c.legs.map((l, i) => `<tr><td><b>${esc(l.a.id)}</b> → <b>${esc(l.b.id)}</b></td><td>${hdg(l.tc)}</td><td>${num(l.d, 1)}</td>
      <td><input class="wind" data-leg="${i}" inputmode="numeric" placeholder="DDD/VV" value="${l.w ? String(Math.round(l.w.d)).padStart(3, '0') + '/' + Math.round(l.w.s) : ''}"></td>
      <td>${l.wca ? (l.wca > 0 ? '+' : '') + num(l.wca) + '°' : '0°'}</td><td class="hdg">${hdg(l.mh)}</td><td>${num(l.gs)}</td><td>${hmm(l.ete)}</td><td>${hhmm(l.eta)}</td><td>${num(l.fuel, 1)}</td></tr>`).join('')}
    ${c.altLeg ? `<tr><td class="muted">Alt. → <b>${esc(resolve(S.plan.alt).id)}</b></td><td>${hdg(c.altLeg.tc)}</td><td>${num(c.altLeg.d, 1)}</td><td class="muted">s/viento</td><td></td><td class="hdg">${hdg(c.altLeg.mh)}</td><td>${num(S.ac.tas)}</td><td>${hmm(c.altLeg.ete)}</td><td></td><td>${num(c.altLeg.fuel, 1)}</td></tr>` : ''}
    </tbody></table></div>
    <p class="note">TC rumbo verdadero · WCA corrección por viento · MH rumbo magnético a volar · GS velocidad sobre tierra (kt) · viento en formato "desde/velocidad", ej. 230/15.</p>`;
  $$('#navlog input.wind').forEach(inp => inp.onchange = () => {
    const i = +inp.dataset.leg, w = inp.value.trim() ? parseWind(inp.value) : null;
    if (inp.value.trim() && !w) { toast('Formato de viento: 230/15'); return; }
    S.plan.winds[i] = w; save(); renderNavlog();
  });
  const marg = c.fuel - c.required, endur = S.ac.ff > 0 ? (c.fuel - c.taxi) / S.ac.ff : NaN;
  $('#totals').innerHTML = `<div class="totals">
    <div class="stat"><span>Distancia</span><b>${num(c.dist)} NM</b></div>
    <div class="stat"><span>Tiempo en ruta</span><b>${hmm(c.ete)}</b></div>
    <div class="stat"><span>ETA destino</span><b>${hhmm(c.eta)}</b></div>
    <div class="stat"><span>Comb. ruta</span><b>${num(c.trip, 1)} ${u}</b></div>
    <div class="stat"><span>Requerido*</span><b>${num(c.required, 1)} ${u}</b></div>
    <div class="stat"><span>Autonomía</span><b>${hmm(endur)}</b></div></div>
    <p class="note">*Requerido = ruta + rodaje (${num(c.taxi, 1)}) + ${c.altLeg ? 'alternativa (' + num(c.altLeg.fuel, 1) + ') + ' : ''}reserva ${S.ac.res} min (${num(c.reserve, 1)} ${u}).</p>`;
  const W = [];
  if (c.legs.some(l => !(l.gs > 0))) W.push(['bad', 'La velocidad sobre tierra es nula o negativa en algún tramo: revisa TAS y viento.']);
  if (marg < 0) W.push(['bad', `Combustible insuficiente: faltan ${num(-marg, 1)} ${u}.`]);
  else W.push(['ok', `Margen de combustible sobre lo requerido: ${num(marg, 1)} ${u}.`]);
  const dest = c.pts[c.pts.length - 1];
  const sun = SUN(localNoon(c.eta), dest.la, dest.lo);
  const sun0 = SUN(localNoon(c.t0), c.pts[0].la, c.pts[0].lo);
  if (sun0.rise && (c.t0 < sun0.rise || c.t0 > sun0.set)) W.push(['bad', `La salida (${hhmm(c.t0)}) es de noche en ${c.pts[0].id}: orto ${hhmm(sun0.rise)}, ocaso ${hhmm(sun0.set)}.`]);
  if (sun.set) {
    const left = (sun.set - c.eta) / 60000;
    if (c.eta < sun.rise) W.push(['bad', `ETA ${hhmm(c.eta)} es anterior al orto en ${dest.id} (${hhmm(sun.rise)}).`]);
    else if (left < 0) W.push(['bad', `ETA ${hhmm(c.eta)} es posterior al ocaso en ${dest.id} (${hhmm(sun.set)}). Verifica si el aeródromo y tu habilitación permiten operación nocturna.`]);
    else if (left < 30) W.push(['warn', `Llegas ${Math.round(left)} min antes del ocaso en ${dest.id} (${hhmm(sun.set)}).`]);
    else W.push(['ok', `Ocaso en ${dest.id}: ${hhmm(sun.set)} (fin crepúsculo civil ${hhmm(sun.dusk)}).`]);
  }
  c.pts.forEach(p => { if (p.ad && p.ad.x) W.push(['bad', `${p.id} figura como CERRADO en el AIP.`]); if (p.ad && !p.ad.p) W.push(['warn', `${p.id} es de uso privado: requiere autorización del administrador${p.ad.ad ? ' (' + p.ad.ad + ')' : ''}.`]); });
  const cr = +S.plan.cruise || 0, maxE = Math.max(...c.pts.map(p => p.e || 0));
  if (cr && cr < maxE + 1000) W.push(['warn', `La altitud de crucero (${num(cr)} ft) es baja respecto de la elevación de los aeródromos de la ruta (${num(maxE)} ft). Revisa el terreno en la carta.`]);
  zoneWarnings(c.pts, cr).forEach(w => W.push(w));
  $('#warnings').innerHTML = W.map(([k, t]) => `<div class="alert ${k}">${esc(t)}</div>`).join('');
  renderTerr(c);
}

/* viento pronosticado en altura (Open-Meteo) para el punto medio de cada tramo */
const LEVELS = [[1000, 360], [975, 1000], [950, 1800], [925, 2500], [900, 3300], [850, 4800], [800, 6400], [700, 9900], [600, 13800], [500, 18300]];
function levelFor(ft) { return LEVELS.reduce((b, l) => Math.abs(l[1] - ft) < Math.abs(b[1] - ft) ? l : b)[0]; }
$('#wind-fc').onclick = async () => {
  const c = computePlan(); if (!c) return toast('Primero define la ruta');
  const lv = levelFor(+S.plan.cruise || 4500), btn = $('#wind-fc');
  btn.disabled = true; btn.textContent = 'Consultando…';
  try {
    const res = await Promise.all(c.legs.map(async l => {
      const m = interp(l.a, l.b, .5);
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${m.la.toFixed(3)}&longitude=${m.lo.toFixed(3)}&hourly=wind_speed_${lv}hPa,wind_direction_${lv}hPa&wind_speed_unit=kn&timeformat=unixtime&timezone=GMT&forecast_days=3`;
      const j = await fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
      const tMid = (l.eta.getTime() - l.ete * 1800e3) / 1000;
      const T = j.hourly.time; let k = 0;
      T.forEach((t, i) => { if (Math.abs(t - tMid) < Math.abs(T[k] - tMid)) k = i; });
      return { d: Math.round(j.hourly[`wind_direction_${lv}hPa`][k]), s: Math.round(j.hourly[`wind_speed_${lv}hPa`][k]) };
    }));
    S.plan.winds = res; save(); renderNavlog();
    toast(`Viento a ${lv} hPa (≈${num(LEVELS.find(l => l[0] === lv)[1])} ft) cargado`);
  } catch (e) { toast('No se pudo obtener el viento pronosticado'); }
  btn.disabled = false; btn.textContent = 'Viento pronosticado';
};

/* terreno y altitud mínima de seguridad (relieve DEM de Open-Meteo, el mismo SRTM que muestra el mapa topográfico) */
const TERR = {
  half: 5, // semiancho del corredor (NM)
  key(pts) { return pts.map(p => p.la.toFixed(3) + ',' + p.lo.toFixed(3)).join('|'); },
  clearance(h) { return h > 5000 ? 2000 : 1000; }, // margen sobre el punto más alto: 1000 ft, 2000 ft en terreno montañoso
  msa(h) { return Math.ceil((h + this.clearance(h)) / 500) * 500; },
  get(pts) { const t = S.terr; return t && pts && pts.length > 1 && t.key === this.key(pts) ? t : null; },
  async compute(c) {
    const sp = Math.max(4, c.dist / 150), pts = [];
    c.legs.forEach((l, i) => {
      const n = Math.max(1, Math.ceil(l.d / sp)), br = (l.tc + 90) * Math.PI / 180;
      for (let k = 0; k <= n; k++) {
        const m = interp(l.a, l.b, k / n), cl = Math.max(.2, Math.cos(m.la * Math.PI / 180));
        for (const off of [0, -this.half, this.half]) pts.push({ leg: i, la: m.la + off * Math.cos(br) / 60, lo: m.lo + off * Math.sin(br) / 60 / cl });
      }
    });
    const el = [];
    for (let i = 0; i < pts.length; i += 100) {
      const ch = pts.slice(i, i + 100);
      el.push(fetchJSON(`https://api.open-meteo.com/v1/elevation?latitude=${ch.map(p => p.la.toFixed(4)).join(',')}&longitude=${ch.map(p => p.lo.toFixed(4)).join(',')}`).then(j => j.elevation));
    }
    const E = (await Promise.all(el)).flat();
    const legs = c.legs.map(() => ({ max: -Infinity, la: 0, lo: 0 }));
    pts.forEach((p, i) => { const h = E[i] * 3.28084; if (isFinite(h) && h > legs[p.leg].max) legs[p.leg] = { max: h, la: p.la, lo: p.lo }; });
    if (legs.some(l => !isFinite(l.max))) throw new Error('sin datos');
    legs.forEach(l => { l.max = Math.round(l.max); l.msa = this.msa(l.max); });
    const top = legs.reduce((b, l) => l.max > b.max ? l : b);
    return S.terr = { key: this.key(c.pts), legs, max: top.max, msa: this.msa(top.max), la: top.la, lo: top.lo };
  },
  async run(btn) {
    const c = computePlan(); if (!c) return toast('Primero define la ruta');
    if (btn) { btn.disabled = true; btn.textContent = 'Consultando relieve…'; }
    try { await this.compute(c); save(); renderNavlog(); renderNav(); }
    catch (e) { toast('No se pudo obtener el relieve (requiere conexión)'); if (btn) { btn.disabled = false; btn.textContent = 'Calcular altura mínima'; } }
  }
};
function renderTerr(c) {
  const el = $('#terr'); if (!el) return;
  if (!c) { el.innerHTML = ''; return; }
  const t = TERR.get(c.pts), cr = +S.plan.cruise || 0;
  if (!t) { el.innerHTML = `<div class="card-head"><h3>Altitud mínima de seguridad</h3><button id="terr-go" class="btn small primary" type="button">Calcular altura mínima</button></div><p class="note">Analiza el relieve de la ruta (corredor ±${TERR.half} NM) y recomienda una altitud mínima.</p>`; $('#terr-go').onclick = e => TERR.run(e.target); return; }
  const cl = TERR.clearance(t.max);
  el.innerHTML = `<div class="card-head"><h3>Altitud mínima de seguridad</h3><button id="terr-go" class="btn small" type="button">Recalcular</button></div>
    <div class="alert ${cr && cr < t.msa ? 'bad' : 'ok'}">Altitud mínima recomendada: <b>${num(t.msa)} ft</b> (terreno más alto ${num(t.max)} ft + ${num(cl)} ft de margen). ${cr ? (cr < t.msa ? `Tu crucero de ${num(cr)} ft es INSUFICIENTE.` : `Tu crucero de ${num(cr)} ft cumple.`) : ''}</div>
    ${cr && cr < t.msa ? `<button id="terr-apply" class="btn small" type="button" style="margin-top:8px">Usar ${num(t.msa)} ft como crucero</button>` : ''}
    <div class="tbl-wrap"><table class="navlog"><thead><tr><th>Tramo</th><th>Terreno máx (ft)</th><th>Mínima (ft)</th></tr></thead><tbody>
    ${c.legs.map((l, i) => `<tr><td><b>${esc(l.a.id)}</b> → <b>${esc(l.b.id)}</b></td><td>${num(t.legs[i].max)}</td><td><b>${num(t.legs[i].msa)}</b></td></tr>`).join('')}</tbody></table></div>
    <p class="note">Altitud sobre el nivel del mar (MSL). Margen: 1000 ft sobre el punto más alto del corredor, 2000 ft si supera 5000 ft; redondeo a 500 ft. El relieve (modelo digital de ~90 m) no incluye torres, antenas ni cables, y puede subestimar picos agudos. Contrasta siempre con las cartas oficiales y considera nubes, viento y turbulencia de montaña.</p>`;
  $('#terr-go').onclick = e => TERR.run(e.target);
  const ap = $('#terr-apply'); if (ap) ap.onclick = () => { S.plan.cruise = t.msa; $('#p-cruise').value = t.msa; save(); renderNavlog(); };
}

/* acciones */
$('#act-fly').onclick = () => { if (!routeValid()) return toast('Define origen y destino'); NAV.loadRoute(); showView('v-vuelo'); if (!NAV.on) NAV.start(); if (!TERR.get(NAV.route)) TERR.run(); };
$('#act-map').onclick = () => { showView('v-mapa'); MAP.fitRoute(); };
$('#act-wx').onclick = () => { const ids = routeAdIds(); if (!ids.length) return toast('Sin aeródromos en la ruta'); showView('v-meteo'); $('#wx-ids').value = ids.join(' '); loadMetar(ids); };
$('#act-reverse').onclick = () => { const P = S.plan; [P.dep, P.dest] = [P.dest, P.dep]; P.wps.reverse(); P.winds = []; planChanged(); toast('Ruta invertida'); };
$('#act-new').onclick = () => { if (!confirm('¿Borrar la ruta actual?')) return; S.plan = structuredClone(DEF.plan); S.plan.depTime = defaultDep(); fillForm(); planChanged(); };
$('#act-save').onclick = () => {
  const c = computePlan(); if (!c) return toast('Define origen y destino');
  const name = prompt('Nombre del plan', `${c.pts[0].id}-${c.pts[c.pts.length - 1].id}`); if (!name) return;
  S.saved = S.saved.filter(s => s.name !== name); S.saved.unshift({ name, plan: structuredClone(S.plan), at: Date.now() }); save(); renderSaved(); toast('Plan guardado');
};
function renderSaved() {
  $('#saved-list').innerHTML = S.saved.length ? S.saved.map((s, i) => `<div class="item" data-i="${i}"><span class="tx"><b>${esc(s.name)}</b><small>${new Date(s.at).toLocaleDateString('es-CL')} · ${[s.plan.dep, ...s.plan.wps, s.plan.dest].filter(Boolean).map(p => p.i || p.n).join(' → ')}</small></span><button class="mini" data-del="${i}" type="button" aria-label="Eliminar">✕</button></div>`).join('') : '<p class="muted">Aún no hay planes guardados.</p>';
}
$('#saved-list').onclick = e => {
  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); if (confirm('¿Eliminar este plan guardado?')) { S.saved.splice(+del.dataset.del, 1); save(); renderSaved(); } return; }
  const it = e.target.closest('[data-i]'); if (!it) return;
  S.plan = deepMerge(structuredClone(DEF.plan), structuredClone(S.saved[+it.dataset.i].plan)); S.plan.depTime = defaultDep(); fillForm(); planChanged(); toast('Plan cargado (hora de salida actualizada)');
};
/* planes de ejemplo: se cargan con un toque y se recorren con "Simular" (10×) */
const EJEMPLOS = [
  { name: 'Santiago → Viña del Mar', desc: 'Cruce de la Cordillera de la Costa · terreno alto, ideal para ver la altitud mínima', cruise: 7500, dep: 'SCTB', dest: 'SCVM', alt: 'SCSN', winds: ['270/10'] },
  { name: 'Santiago → Rancagua', desc: 'Vuelo corto por el Valle Central (~50 NM) · prueba rápida', cruise: 5500, dep: 'SCTB', dest: 'SCRG', alt: null, winds: [] },
  { name: 'Santiago → Chillán vía Rancagua', desc: 'Ruta larga con un punto intermedio y alternativa en Concepción', cruise: 6500, dep: 'SCTB', wps: ['SCRG'], dest: 'SCCH', alt: 'SCIE', winds: ['180/8', '200/12'] }
];
function renderExamples() {
  $('#examples').innerHTML = EJEMPLOS.map((x, i) => `<div class="item" data-ex="${i}"><span class="tx"><b>${esc(x.name)}</b><small>${esc(x.desc)}</small></span><button class="mini" data-sim="${i}" type="button" aria-label="Cargar y simular" title="Cargar y simular">▶</button></div>`).join('');
}
$('#examples').onclick = e => {
  const it = e.target.closest('[data-ex]'); if (!it) return;
  const x = EJEMPLOS[+it.dataset.ex], sim = !!e.target.closest('[data-sim]'), ref = i => i ? { i } : null;
  if (NAV.on) NAV.stop();
  S.plan = deepMerge(structuredClone(DEF.plan), { dep: ref(x.dep), wps: (x.wps || []).map(ref), dest: ref(x.dest), alt: ref(x.alt), cruise: x.cruise, winds: x.winds.map(parseWind) });
  S.plan.depTime = defaultDep(); fillForm(); planChanged(); toast('Ejemplo cargado: ' + x.name);
  if (sim) { NAV.simulate(); if (!TERR.get(NAV.route)) TERR.run(); }
};
function routeAdIds() { return [...new Set([S.plan.dep, ...S.plan.wps, S.plan.dest, S.plan.alt].filter(p => p && p.i).map(p => p.i))]; }

function briefingText() {
  const c = computePlan(); if (!c) return '';
  const u = S.ac.unit, L = [];
  L.push(`PLAN VFR ${S.ac.reg || ''} ${S.ac.type || ''}`.trim());
  L.push(`Salida ${c.t0.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })} · Crucero ${num(S.plan.cruise)} ft · TAS ${S.ac.tas} kt`);
  L.push(`Ruta: ${c.pts.map(p => p.id).join(' - ')}${S.plan.alt ? ' (ALT ' + S.plan.alt.i + ')' : ''}`);
  L.push('');
  c.legs.forEach(l => L.push(`${l.a.id}>${l.b.id}  TC${hdg(l.tc)} MH${hdg(l.mh)}  ${num(l.d, 1)}NM  GS${num(l.gs)}  ETE ${hmm(l.ete)}  ETA ${hhmm(l.eta)}${l.w ? '  W' + hdg(l.w.d) + '/' + l.w.s : ''}`));
  L.push('');
  L.push(`Total ${num(c.dist)} NM · ${hmm(c.ete)} · ETA ${hhmm(c.eta)}`);
  L.push(`Combustible: ruta ${num(c.trip, 1)} · requerido ${num(c.required, 1)} · a bordo ${num(c.fuel, 1)} ${u}`);
  c.pts.forEach(p => { if (p.ad && p.ad.q) L.push(`${p.id} ${p.ad.q} ${p.ad.qd || ''}`.trim()); });
  L.push('', 'Generado con VFR Chile. Verificar AIP, NOTAM y meteorología oficial.');
  return L.join('\n');
}
$('#act-share').onclick = async () => {
  const t = briefingText(); if (!t) return toast('Define origen y destino');
  if (navigator.share) { try { await navigator.share({ title: 'Plan de vuelo VFR', text: t }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(t); toast('Briefing copiado al portapapeles'); } catch (e) { openModal('Briefing', `<pre class="raw">${esc(t)}</pre>`); }
};
function download(name, text, type) {
  const blob = new Blob([text], { type }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function gpxRoute() {
  const pts = routePts(); const nm = pts.map(p => p.id).join('-');
  const wpt = pts.map(p => `  <rtept lat="${p.la}" lon="${p.lo}"><name>${esc(p.id)}</name>${p.e != null ? `<ele>${(p.e / 3.28084).toFixed(0)}</ele>` : ''}<desc>${esc(p.name)}</desc></rtept>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="VFR Chile" xmlns="http://www.topografix.com/GPX/1/1">\n <rte><name>${esc(nm)}</name>\n${wpt}\n </rte>\n</gpx>\n`;
}
$('#act-gpx').onclick = () => { if (!routeValid()) return toast('Define origen y destino'); download(routePts().map(p => p.id).join('-') + '.gpx', gpxRoute(), 'application/gpx+xml'); };

/* ------------------------------------------------------------------ METEOROLOGÍA */
const AWC = 'https://aviationweather.gov/api/data';
function visKm(v) {
  if (v == null || v === '') return null;
  const s = String(v); const plus = s.includes('+'); const n = parseFloat(s);
  if (isNaN(n)) return null; return { km: n * 1.609, plus };
}
function ceilingFt(clouds) {
  let c = null; (clouds || []).forEach(k => { if (/BKN|OVC|OVX|VV/.test(k.cover) && k.base != null) c = c == null ? k.base : Math.min(c, k.base); }); return c;
}
function flightCat(m) {
  const v = visKm(m.visib), sm = v ? v.km / 1.609 : 10, ce = ceilingFt(m.clouds) ?? 99999;
  if (ce < 500 || sm < 1) return 'LIFR'; if (ce < 1000 || sm < 3) return 'IFR'; if (ce <= 3000 || sm <= 5) return 'MVFR'; return 'VFR';
}
async function fetchJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); const t = await r.text(); return t ? JSON.parse(t) : []; }
async function getMetars(ids) {
  const j = await fetchJSON(`${AWC}/metar?ids=${ids.join(',')}&format=json&hours=3`);
  const by = {}; (j || []).forEach(m => { const t = m.obsTime || 0; if (!by[m.icaoId] || (by[m.icaoId].obsTime || 0) < t) by[m.icaoId] = m; }); return by;
}
async function loadMetar(ids) {
  ids = [...new Set(ids.map(s => s.toUpperCase()).filter(s => /^[A-Z0-9]{4}$/.test(s)))];
  const out = $('#wx-results'); if (!ids.length) { out.innerHTML = '<p class="muted">Ingresa códigos OACI (ej. SCEL SCTB).</p>'; return; }
  out.innerHTML = '<p class="muted">Consultando…</p>';
  let metars = {}, tafs = {}, err = null;
  try {
    const [m, t] = await Promise.all([getMetars(ids), fetchJSON(`${AWC}/taf?ids=${ids.join(',')}&format=json`).catch(() => [])]);
    metars = m; (t || []).forEach(x => { if (!tafs[x.icaoId]) tafs[x.icaoId] = x; });
    try { localStorage.setItem('vfrchile.wx', JSON.stringify({ at: Date.now(), metars, tafs })); } catch (e) { }
  } catch (e) {
    err = e; try { const c = JSON.parse(localStorage.getItem('vfrchile.wx')); if (c) { metars = c.metars; tafs = c.tafs; } } catch (e2) { }
  }
  $('#wx-time').textContent = 'Actualizado ' + hhmm(new Date());
  out.innerHTML = (err ? `<div class="alert warn">No se pudo consultar en línea${Object.keys(metars).length ? '; se muestran los últimos datos guardados' : ''}.</div>` : '') +
    ids.map(id => wxCard(id, metars[id], tafs[id])).join('');
}
function wxCard(id, m, t) {
  const a = ADX[id];
  if (!m && !t) return `<div class="wx"><div class="wx-head"><b>${id}</b><span class="muted">${esc(a ? a.n : '')}</span></div><p class="muted">Sin METAR/TAF disponible${a && !a.m ? ' (este aeródromo no tiene estación METAR)' : ''}.</p>${a && a.la != null ? `<button class="btn small" data-fc="${id}" type="button">Ver pronóstico de modelo</button>` : ''}</div>`;
  let html = `<div class="wx"><div class="wx-head"><b>${id} <small class="muted">${esc(a ? a.n : (m && m.name) || '')}</small></b>`;
  if (m) {
    const cat = flightCat(m), age = m.obsTime ? Math.round((Date.now() / 1000 - m.obsTime) / 60) : null;
    const v = visKm(m.visib), ce = ceilingFt(m.clouds);
    const wind = m.wspd === 0 ? 'Calma' : `${m.wdir === 'VRB' ? 'Variable' : hdg(m.wdir) + '°'} ${m.wspd ?? '—'} kt${m.wgst ? ' ráf. ' + m.wgst : ''}`;
    html += `<span><span class="tag ${cat}">${cat}</span>${age != null ? ` <small class="muted">hace ${age} min</small>` : ''}</span></div>
      <div class="wx-grid"><div><span>Viento</span><br><b>${wind}</b></div>
      <div><span>Visibilidad</span><br><b>${v ? (v.plus || v.km >= 9.9 ? '≥ 10 km' : num(v.km, 1) + ' km') : '—'}</b></div>
      <div><span>Techo</span><br><b>${ce != null ? num(ce) + ' ft' : 'Sin techo'}</b></div>
      <div><span>Nubes</span><br><b>${(m.clouds || []).map(c => c.cover + (c.base != null ? String(Math.round(c.base / 100)).padStart(3, '0') : '')).join(' ') || 'NSC'}</b></div>
      <div><span>Temp / Rocío</span><br><b>${m.temp ?? '—'}° / ${m.dewp ?? '—'}°</b></div>
      <div><span>QNH</span><br><b>${m.altim ? Math.round(m.altim) + ' hPa' : '—'}</b></div>
      ${m.wxString ? `<div><span>Fenómenos</span><br><b>${esc(m.wxString)}</b></div>` : ''}</div>
      <pre class="raw">${esc(m.rawOb || '')}</pre>`;
  } else html += '</div>';
  if (t) html += `<pre class="raw">${esc(t.rawTAF || '')}</pre>`;
  return html + '</div>';
}
$('#wx-form').onsubmit = e => { e.preventDefault(); loadMetar($('#wx-ids').value.split(/[\s,;]+/)); };
$('#wx-results').onclick = e => { const b = e.target.closest('[data-fc]'); if (b) { S.wxAd = b.dataset.fc; save(); renderPickers(); loadForecast(); $('#fc-results').scrollIntoView({ behavior: 'smooth' }); } };
function renderWxChips() {
  const ids = routeAdIds();
  const near = NAV.pos ? AD.filter(a => a.m && a.la != null).sort((a, b) => distNM(NAV.pos, a) - distNM(NAV.pos, b)).slice(0, 3).map(a => a.i) : [];
  const chips = [...(ids.length ? [['Ruta', ids]] : []), ...(near.length ? [['Cercanos', near]] : []), ['Santiago', ['SCEL', 'SCTB', 'SCSN']], ['Sur', ['SCTE', 'SCQP', 'SCVD']], ['Norte', ['SCFA', 'SCDA', 'SCAR']], ['Austral', ['SCCI', 'SCBA', 'SCNT']]];
  $('#wx-chips').innerHTML = chips.map(([n, l]) => `<button class="chip" data-ids="${l.join(' ')}" type="button">${n}: ${l.join(' ')}</button>`).join('');
}
$('#wx-chips').onclick = e => { const b = e.target.closest('[data-ids]'); if (b) { $('#wx-ids').value = b.dataset.ids; loadMetar(b.dataset.ids.split(' ')); } };

const WMO = { 0: 'Despejado', 1: 'Mayorm. despejado', 2: 'Parcial', 3: 'Cubierto', 45: 'Niebla', 48: 'Niebla escarcha', 51: 'Llovizna débil', 53: 'Llovizna', 55: 'Llovizna fuerte', 61: 'Lluvia débil', 63: 'Lluvia', 65: 'Lluvia fuerte', 66: 'Lluvia engelante', 67: 'Lluvia engelante', 71: 'Nieve débil', 73: 'Nieve', 75: 'Nieve fuerte', 77: 'Granizo fino', 80: 'Chubascos', 81: 'Chubascos', 82: 'Chubascos fuertes', 85: 'Chub. nieve', 86: 'Chub. nieve', 95: 'Tormenta', 96: 'Tormenta granizo', 99: 'Tormenta granizo' };
async function loadForecast() {
  const a = ADX[S.wxAd]; const out = $('#fc-results'), sunEl = $('#fc-sun');
  if (!a || a.la == null) { out.innerHTML = ''; sunEl.innerHTML = ''; return; }
  const s = SUN(localNoon(new Date()), a.la, a.lo);
  sunEl.innerHTML = `<div class="sun"><div class="stat"><span>Orto</span><b>${hhmm(s.rise)}</b></div><div class="stat"><span>Ocaso</span><b>${hhmm(s.set)}</b></div><div class="stat"><span>Fin crep. civil</span><b>${hhmm(s.dusk)}</b></div></div>`;
  out.innerHTML = '<p class="muted">Consultando pronóstico…</p>';
  const lv = levelFor(+S.plan.cruise || 4500);
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${a.la}&longitude=${a.lo}&hourly=temperature_2m,dew_point_2m,pressure_msl,cloud_cover,cloud_cover_low,visibility,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_${lv}hPa,wind_direction_${lv}hPa&wind_speed_unit=kn&timezone=auto&forecast_hours=15`;
    const j = await fetchJSON(url), H = j.hourly;
    const rows = H.time.map((t, i) => `<tr><td>${t.slice(11, 16)}</td><td>${hdg(H.wind_direction_10m[i])}/${Math.round(H.wind_speed_10m[i])}${H.wind_gusts_10m[i] > H.wind_speed_10m[i] + 8 ? 'G' + Math.round(H.wind_gusts_10m[i]) : ''}</td>
      <td>${hdg(H[`wind_direction_${lv}hPa`][i])}/${Math.round(H[`wind_speed_${lv}hPa`][i])}</td><td>${H.cloud_cover_low[i]}% / ${H.cloud_cover[i]}%</td>
      <td>${H.visibility[i] != null ? (H.visibility[i] >= 10000 ? '≥10' : num(H.visibility[i] / 1000, 1)) : '—'}</td><td>${num(H.precipitation[i], 1)}</td>
      <td>${Math.round(H.temperature_2m[i])}/${Math.round(H.dew_point_2m[i])}</td><td>${Math.round(H.pressure_msl[i])}</td><td style="text-align:left">${WMO[H.weather_code[i]] || ''}</td></tr>`).join('');
    out.innerHTML = `<div class="tbl-wrap"><table class="fc"><thead><tr><th>Hora</th><th>Viento sup.</th><th>Viento ${lv} hPa</th><th>Nub. baja/total</th><th>Vis km</th><th>Pp mm</th><th>T/Td °C</th><th>QNH</th><th>Tiempo</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">Hora local del aeródromo. Viento en kt. ${lv} hPa ≈ ${num(LEVELS.find(l => l[0] === lv)[1])} ft (según tu altitud de crucero).</p>`;
  } catch (e) { out.innerHTML = '<div class="alert warn">No se pudo obtener el pronóstico. Revisa tu conexión.</div>'; }
}

/* ------------------------------------------------------------------ ESPACIO AÉREO (AIP ENR 5.1) */
/* data/espacio-aereo.js lo genera tools/update_airspace.py (GitHub Actions) cada vez que la DGAC publica cambios */
const ZNOM = { P: 'Prohibida', R: 'Restringida', D: 'Peligrosa' };
const ZCOL = { P: '#ef4444', R: '#f97316', D: '#eab308' };
const ZN = ((EA && EA.zonas) || []).map(z => {
  if (z.g) { const r = z.g[0]; z.bb = [Math.min(...r.map(p => p[0])), Math.min(...r.map(p => p[1])), Math.max(...r.map(p => p[0])), Math.max(...r.map(p => p[1]))]; }
  return z;
});
function inPoly(la, lo, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((xi > lo) !== (xj > lo) && la < (yj - yi) * (lo - xi) / (xj - xi) + yi) c = !c;
  }
  return c;
}
function zonesAt(p) { return ZN.filter(z => z.g && p.la >= z.bb[0] && p.la <= z.bb[2] && p.lo >= z.bb[1] && p.lo <= z.bb[3] && inPoly(p.la, p.lo, z.g[0])); }
function zLimits(z) {
  if (!z.lim || !z.lim.length) return 'ver AIP';
  return z.multi ? 'varios sectores: ' + z.lim.join(' / ') : `${z.lim[0]} (sup.) · ${z.lim[1] || 'GND'} (inf.)`;
}
/* ¿está la altitud (ft MSL) dentro de los límites verticales de la zona? null = no se puede saber (AGL o sin datos) */
function zVert(z, ft) {
  if (!z.lim || z.lo == null || z.hi == null) return null;
  if (z.agl) return null;
  return ft >= z.lo && ft <= z.hi;
}
function zonesOnRoute(pts) {
  const hit = new Map();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], n = Math.min(4000, Math.max(1, Math.ceil(distNM(a, b) / 0.1)));
    for (let k = 0; k <= n; k++) zonesAt(interp(a, b, k / n)).forEach(z => hit.has(z.id) || hit.set(z.id, z));
  }
  return [...hit.values()];
}
function zoneWarnings(pts, cr) {
  const W = [];
  zonesOnRoute(pts).forEach(z => {
    const inside = cr ? zVert(z, cr) : null, tipo = `${z.id} (${ZNOM[z.k]}${z.n ? ' · ' + z.n : ''})`;
    const lim = zLimits(z);
    if (inside === false) W.push(['ok', `La ruta pasa por ${tipo}, pero tu crucero (${num(cr)} ft) queda fuera de sus límites verticales: ${lim}. Confirma horario y NOTAM.`]);
    else W.push([z.k === 'P' ? 'bad' : 'warn', `La ruta cruza ${tipo}. Límites: ${lim}.${inside ? ` Tu crucero (${num(cr)} ft) está DENTRO de la zona.` : ' Los límites dependen del terreno (AGL) o no se pudieron determinar: revisa el AIP.'} ${z.k === 'P' ? 'Vuelo prohibido sin autorización.' : 'Requiere autorización/coordinación según el AIP.'}`]);
  });
  /* zonas que no se pudieron interpretar (arcos, radiales, coordenadas con errores) en las FIR de la ruta */
  const FIR = { ANTOFAGASTA: 'SCFZ', SANTIAGO: 'SCEZ', 'PUERTO MONTT': 'SCTZ', 'PUNTA ARENAS': 'SCCZ' };
  const firs = new Set(pts.map(p => p.ad && p.ad.f).filter(Boolean));
  const sin = ZN.filter(z => !z.g && (!FIR[z.fir] || firs.has(FIR[z.fir]))).map(z => z.id);
  if (sin.length) W.push(['warn', `No se pudo dibujar ni verificar contra la ruta: ${sin.join(', ')} (geometría no interpretable automáticamente). Revisa el ENR 5.1 del AIP.`]);
  return W;
}

/* ------------------------------------------------------------------ MAPA */
const MAP = {
  map: null, zoneLayer: null, adLayer: null, routeLayer: null, metarLayer: null, own: null, trail: null, base: {},
  init() {
    if (!window.L) { $('#map').innerHTML = '<p class="muted" style="padding:20px">No se pudo cargar el mapa (sin conexión la primera vez). Las demás funciones siguen disponibles.</p>'; return; }
    const v = S.map.view || { c: [-33.45, -70.66], z: 7 };
    const m = this.map = L.map('map', { preferCanvas: true, zoomControl: false, attributionControl: true }).setView(v.c, v.z);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    this.base = {
      osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true, attribution: '© OpenStreetMap' }),
      topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, crossOrigin: true, attribution: '© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA)' }),
      sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, crossOrigin: true, attribution: 'Imágenes © Esri' })
    };
    (this.base[S.map.layer] || this.base.osm).addTo(m);
    this.zoneLayer = L.layerGroup().addTo(m);
    this.adLayer = L.layerGroup().addTo(m); this.routeLayer = L.layerGroup().addTo(m); this.metarLayer = L.layerGroup().addTo(m);
    this.trail = L.polyline([], { color: '#5fd3ff', weight: 3, opacity: .8 }).addTo(m);
    this.drawZones(); this.drawAds(); this.drawRoute();
    m.on('moveend', () => { S.map.view = { c: [m.getCenter().lat, m.getCenter().lng], z: m.getZoom() }; save(); });
    m.on('contextmenu', e => this.customPoint(e.latlng));
    m.on('popupopen', e => {
      const el = e.popup.getElement(); el.onclick = ev => {
        const b = ev.target.closest('[data-pa]'); if (!b) return;
        const p = JSON.parse(b.dataset.p), act = b.dataset.pa; m.closePopup();
        if (act === 'info') showAd(p.i); else if (act === 'direct') directTo(p); else setRoutePoint(act, p);
      };
    });
    setTimeout(() => { const h = $('.map-hint'); if (h) h.style.opacity = 0; }, 6000);
  },
  color(a) { return a.x ? '#000' : a.t === 'H' ? '#a78bfa' : a.t === 'M' ? '#ef4444' : a.p ? '#22c55e' : '#94a3b8'; },
  cat(a) { return a.t === 'H' ? 'hel' : a.t === 'M' ? 'mil' : a.t === 'X' ? 'mix' : a.p ? 'pub' : 'pvt'; },
  drawAds() {
    if (!this.map) return; this.adLayer.clearLayers();
    AD.forEach(a => {
      if (a.la == null || !S.map.f[this.cat(a)]) return;
      const mk = L.circleMarker([a.la, a.lo], { radius: a.t === 'H' ? 4.5 : (a.p ? 7 : 5.5), color: a.x ? '#ff6b6b' : '#0b1320', weight: a.x ? 2 : 1.2, fillColor: this.color(a), fillOpacity: .95 });
      mk.bindTooltip(a.i, { direction: 'top', offset: [0, -6] });
      mk.bindPopup(() => this.popup(a), { maxWidth: 280 });
      mk.addTo(this.adLayer);
    });
  },
  drawZones() {
    if (!this.map) return; this.zoneLayer.clearLayers();
    ZN.forEach(z => {
      if (!z.g || !S.map.z[z.k]) return;
      const c = ZCOL[z.k];
      L.polygon(z.g[0], { color: c, weight: 1.8, fillColor: c, fillOpacity: .16, dashArray: z.k === 'D' ? '6 4' : null })
        .bindTooltip(z.id, { sticky: true }).bindPopup(() => this.zonePopup(z), { maxWidth: 300 }).addTo(this.zoneLayer);
    });
  },
  zonePopup(z) {
    return `<div class="pop"><h4><i class="sq z-${z.k}"></i>${esc(z.id)} · ${ZNOM[z.k]}</h4>
      <div class="muted">${z.n ? esc(z.n) + '<br>' : ''}FIR ${esc(z.fir || '—')}<br><b>Límites:</b> ${esc(zLimits(z))}${z.agl ? ' <i>(AGL: depende del terreno)</i>' : ''}
      ${z.obs ? '<br><b>Observaciones:</b> ' + esc(z.obs) : ''}</div>
      <div class="muted" style="margin-top:6px">Fuente: AIP Chile ENR 5.1, AMDT ${esc(EA.amdt)} (${esc(EA.fecha)}). Verifica horarios y NOTAM.</div>
      <div class="pbtns"><a href="${esc(EA.fuente)}" target="_blank" rel="noopener">Abrir ENR 5.1 (PDF)</a></div></div>`;
  },
  popup(a) {
    const p = esc(JSON.stringify({ i: a.i }));
    return `<div class="pop"><h4>${a.i} · ${esc(a.n)}</h4><div class="muted">${TIPO[a.t]}${a.e != null ? ' · ' + num(a.e) + ' ft' : ''}${a.q ? ' · ' + esc(a.q) : ''}<br>${adTags(a)}</div>
      <div class="pbtns"><button data-pa="dep" data-p="${p}">Origen</button><button class="primary" data-pa="dest" data-p="${p}">Destino</button>
      <button data-pa="wp" data-p="${p}">+ Punto</button><button data-pa="info" data-p="${p}">Ficha</button>
      <button data-pa="alt" data-p="${p}">Alternativa</button><button data-pa="direct" data-p="${p}">Directo a</button></div></div>`;
  },
  customPoint(ll) {
    const p = esc(JSON.stringify({ n: 'WP' + (S.plan.wps.filter(w => !w.i).length + 1), la: +ll.lat.toFixed(5), lo: +ll.lng.toFixed(5) }));
    L.popup().setLatLng(ll).setContent(`<div class="pop"><h4>Punto personalizado</h4><div class="muted">${fmtCoord(ll.lat, 'S', 'N')} ${fmtCoord(ll.lng, 'W', 'E')}</div>
      <div class="pbtns"><button class="primary" data-pa="wp" data-p="${p}">+ Punto de ruta</button><button data-pa="direct" data-p="${p}">Directo a</button></div></div>`).openOn(this.map);
  },
  drawRoute() {
    if (!this.map) return; this.routeLayer.clearLayers();
    const pts = routePts().filter(Boolean); if (pts.length < 1) return;
    const ll = pts.map(p => [p.la, p.lo]);
    if (pts.length > 1) {
      L.polyline(ll, { color: '#000', weight: 7, opacity: .35 }).addTo(this.routeLayer);
      L.polyline(ll, { color: '#f5b301', weight: 4 }).addTo(this.routeLayer);
      const c = computePlan();
      if (c) c.legs.forEach(l => { const m = interp(l.a, l.b, .5); L.marker([m.la, m.lo], { interactive: false, icon: L.divIcon({ className: '', html: `<span class="wp-label">${hdg(l.mh)}° ${num(l.d)}NM</span>`, iconSize: null }) }).addTo(this.routeLayer); });
    }
    pts.forEach((p, i) => L.marker([p.la, p.lo], { interactive: false, icon: L.divIcon({ className: '', html: `<span class="wp-label">${i + 1} ${esc(p.id)}</span>`, iconSize: null, iconAnchor: [-8, 22] }) }).addTo(this.routeLayer));
    const alt = resolve(S.plan.alt), last = pts[pts.length - 1];
    if (alt && last) L.polyline([[last.la, last.lo], [alt.la, alt.lo]], { color: '#f5b301', weight: 2.5, dashArray: '6 8' }).addTo(this.routeLayer);
  },
  fitRoute() { if (!this.map) return; const pts = routePts().filter(Boolean); if (pts.length) this.map.fitBounds(pts.map(p => [p.la, p.lo]), { padding: [50, 50], maxZoom: 11 }); },
  focus(a) { if (this.map && a.la != null) { setTimeout(() => { this.map.invalidateSize(); this.map.setView([a.la, a.lo], 12); }, 80); } },
  updateOwn(pos, trk) {
    if (!this.map || !pos) return;
    const html = `<div class="ownship" style="transform:rotate(${trk || 0}deg)"><svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="#5fd3ff" fill-opacity=".14" stroke="#5fd3ff" stroke-opacity=".5" stroke-width="1"/>
      <path d="M3.5 21.5 24 18.5 44.5 21.5V26L24 24.6 3.5 26Z" fill="#f5b301" stroke="#1a1a1a" stroke-width="1" stroke-linejoin="round"/>
      <path d="M3.5 21.5v4.5M44.5 21.5v4.5" stroke="#d93025" stroke-width="2.2"/>
      <path d="M15 40.5 24 39l9 1.5V44l-9-.9-9 .9Z" fill="#f5b301" stroke="#1a1a1a" stroke-width="1" stroke-linejoin="round"/>
      <path d="M24 4.5c2.6 0 3.4 3.4 3.4 7.5l-.9 24.5-1.3 8h-2.4l-1.3-8L20.6 12c0-4.1.8-7.5 3.4-7.5Z" fill="#fff" stroke="#1a1a1a" stroke-width="1" stroke-linejoin="round"/>
      <path d="M24 38v6" stroke="#9aa5b1" stroke-width="1"/>
      <path d="M22 14.2c.5-1.6 1.2-2.2 2-2.2s1.5.6 2 2.2l-.5 5.3h-3Z" fill="#3b82c4" stroke="#1a1a1a" stroke-width=".7" stroke-linejoin="round"/>
      <path d="M12 22.5l8-3.6M36 22.5l-8-3.6" stroke="#1a1a1a" stroke-width=".8" opacity=".7"/>
      <ellipse cx="24" cy="4.2" rx="10.5" ry="1.1" fill="#1a1a1a" fill-opacity=".45"/>
      <circle cx="24" cy="5" r="1.4" fill="#d93025" stroke="#1a1a1a" stroke-width=".6"/>
    </svg></div>`;
    const icon = L.divIcon({ className: '', html, iconSize: [48, 48], iconAnchor: [24, 24] });
    if (!this.own) this.own = L.marker([pos.la, pos.lo], { icon, interactive: false, zIndexOffset: 1000 }).addTo(this.map);
    else { this.own.setLatLng([pos.la, pos.lo]); this.own.setIcon(icon); }
    if (this.follow) this.map.panTo([pos.la, pos.lo], { animate: false });
  },
  async metarArea() {
    if (!this.map) return; const b = this.map.getBounds(), btn = $('#map-metar');
    if (this.metarLayer.getLayers().length) { this.metarLayer.clearLayers(); btn.classList.remove('on'); return; }
    btn.classList.add('on'); toast('Consultando METAR del área…');
    try {
      const j = await fetchJSON(`${AWC}/metar?bbox=${b.getSouth().toFixed(2)},${b.getWest().toFixed(2)},${b.getNorth().toFixed(2)},${b.getEast().toFixed(2)}&format=json`);
      const by = {}; (j || []).forEach(m => { if (!by[m.icaoId] || (by[m.icaoId].obsTime || 0) < (m.obsTime || 0)) by[m.icaoId] = m; });
      const col = { VFR: '#16a34a', MVFR: '#2563eb', IFR: '#dc2626', LIFR: '#c026d3' };
      Object.values(by).forEach(m => {
        if (m.lat == null) return; const cat = flightCat(m);
        L.marker([m.lat, m.lon], { icon: L.divIcon({ className: '', html: `<span class="metar-label" style="background:${col[cat]}">${m.icaoId} ${cat} ${m.wdir === 'VRB' ? 'VRB' : hdg(m.wdir)}/${m.wspd ?? '-'}</span>`, iconSize: null, iconAnchor: [-6, 30] }) })
          .bindPopup(`<div class="pop"><h4>${m.icaoId}</h4><pre class="raw">${esc(m.rawOb)}</pre></div>`).addTo(this.metarLayer);
      });
      toast(Object.keys(by).length ? `${Object.keys(by).length} METAR en el área` : 'No hay METAR en el área visible');
    } catch (e) { btn.classList.remove('on'); toast('No se pudo consultar METAR'); }
  }
};
$('#map-gps').onclick = () => {
  if (!NAV.pos) { NAV.start(); toast('Buscando posición GPS…'); MAP.follow = true; return; }
  MAP.follow = !MAP.follow; $('#map-gps').classList.toggle('on', MAP.follow);
  if (MAP.follow && MAP.map) MAP.map.setView([NAV.pos.la, NAV.pos.lo], Math.max(MAP.map.getZoom(), 10));
};
$('#map-route').onclick = () => { if (!routeValid()) return toast('Aún no hay ruta'); MAP.fitRoute(); };
$('#map-metar').onclick = () => MAP.metarArea();
$('#map-layers').onclick = () => {
  const body = openModal('Mapa', `<div class="field"><label>Mapa base</label><select id="ly-base">
      <option value="osm">OpenStreetMap</option><option value="topo">Topográfico (OpenTopoMap)</option><option value="sat">Satélite (Esri)</option></select></div>
    <div class="field"><label>Tipo de aeródromo a mostrar</label>
      <label class="chk"><input data-f="pub" type="checkbox"> Públicos</label>
      <label class="chk"><input data-f="pvt" type="checkbox"> Privados</label>
      <label class="chk"><input data-f="mil" type="checkbox"> Militares</label>
      <label class="chk"><input data-f="mix" type="checkbox"> Mixtos</label>
      <label class="chk"><input data-f="hel" type="checkbox"> Helipuertos</label></div>
    <div class="field"><label>Zonas del espacio aéreo (AIP ENR 5.1)</label>
      <label class="chk"><input data-z="P" type="checkbox"> <i class="sq z-P"></i> Prohibidas (P)</label>
      <label class="chk"><input data-z="R" type="checkbox"> <i class="sq z-R"></i> Restringidas (R)</label>
      <label class="chk"><input data-z="D" type="checkbox"> <i class="sq z-D"></i> Peligrosas / instrucción (D)</label>
      ${EA ? `<p class="note">AIP Chile · AMDT ${esc(EA.amdt)} · ${esc(EA.fecha)} · ${ZN.filter(z => z.g).length} de ${ZN.length} zonas dibujadas. Se actualiza automáticamente cuando la DGAC publica cambios.</p>
      <button id="ly-zlist" class="btn small" type="button">Lista de zonas y cartas del AIP</button>` : '<p class="note">Datos de espacio aéreo no disponibles.</p>'}</div>
    <p class="note">Las teselas que ves quedan guardadas en el teléfono y siguen disponibles sin conexión. No son cartas aeronáuticas: no muestran espacios aéreos ni zonas restringidas.</p>`);
  $('#ly-base', body).value = S.map.layer;
  body.querySelectorAll('[data-z]').forEach(cb => { cb.checked = S.map.z[cb.dataset.z] !== false; cb.onchange = () => { S.map.z[cb.dataset.z] = cb.checked; save(); MAP.drawZones(); }; });
  const zl = $('#ly-zlist', body); if (zl) zl.onclick = showZoneList;
  body.querySelectorAll('[data-f]').forEach(cb => { cb.checked = S.map.f[cb.dataset.f] !== false; cb.onchange = () => { S.map.f[cb.dataset.f] = cb.checked; save(); MAP.drawAds(); }; });
  $('#ly-base', body).onchange = e => { Object.values(MAP.base).forEach(l => MAP.map.removeLayer(l)); S.map.layer = e.target.value; MAP.base[S.map.layer].addTo(MAP.map); save(); };
};

function showZoneList() {
  const lnk = (n, u) => `<a class="item" href="${esc(u)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><span class="tx"><b>${esc(n)}</b></span><span class="rt">PDF</span></a>`;
  const C = EA.cartas || { rutas: [], enr: [] }, O = EA.otras || {};
  const vacio = k => O[k] && O[k].vacio;
  const body = openModal('Espacio aéreo y cartas del AIP', `
    <p class="note">AIP Chile (DGAC) · ENR 5.1 · AMDT ${esc(EA.amdt)} · ${esc(EA.fecha)}. Datos interpretados automáticamente del PDF oficial: <b>contrástalos siempre con el AIP vigente y los NOTAM</b>.</p>
    <h3>Cartas</h3><div class="list">${C.rutas.map(r => lnk(r.n, r.u)).join('')}${C.enr.map(r => lnk(r.n, r.u)).join('')}${lnk('ENR 5.1 Zonas P, R, D', EA.fuente)}</div>
    <p class="note">Cartas de aproximación visual (VAC): botón "Carta visual VAC" en la ficha de cada aeródromo que la tiene publicada (${Object.keys((EA.cartas || {}).vac || {}).length} aeródromos).</p>
    <h3>Zonas (${ZN.length})</h3>
    <div class="list">${ZN.map((z, i) => `<div class="item" data-zi="${i}"><span class="ic" style="background:${ZCOL[z.k]};color:#000">${z.k}</span><span class="tx"><b>${esc(z.id)}</b><small>${esc(z.n || z.fir)} · ${esc(zLimits(z))}${z.g ? '' : ' · <b>sin dibujar: ver AIP</b>'}</small></span></div>`).join('')}</div>
    <h3>Obstáculos y áreas de instrucción</h3>
    <p class="note">${vacio('enr54') ? 'ENR 5.4 (obstáculos en ruta): el AIP vigente indica «No aplicable»; no hay obstáculos publicados para dibujar. ' : ''}${vacio('enr52') ? 'ENR 5.2 (áreas de maniobras e instrucción militar): «No aplicable»; las áreas de instrucción aparecen como zonas R o D de ENR 5.1 (ej. SC-R27, SC-D11). ' : ''}Los obstáculos de cada aeródromo figuran en su ficha/carta AIP y no están en esta capa.</p>`);
  body.onclick = e => {
    const it = e.target.closest('[data-zi]'); if (!it) return;
    const z = ZN[+it.dataset.zi]; if (!z.g) { window.open(EA.fuente, '_blank', 'noopener'); return; }
    closeModal(); showView('v-mapa');
    setTimeout(() => { MAP.map.invalidateSize(); MAP.map.fitBounds([[z.bb[0], z.bb[1]], [z.bb[2], z.bb[3]]], { maxZoom: 11, padding: [40, 40] }); }, 80);
  };
}

/* ------------------------------------------------------------------ AERÓDROMOS */
$('#ad-reg').innerHTML += REGIONES.map(r => `<option>${esc(r)}</option>`).join('');
['ad-q', 'ad-type', 'ad-use', 'ad-reg', 'ad-near'].forEach(id => $('#' + id).addEventListener('input', () => { if (id === 'ad-near' && $('#ad-near').checked && !NAV.pos) { NAV.start(); toast('Activando GPS…'); } renderAdList(); }));
function renderAdList() {
  const r = searchAd($('#ad-q').value, { type: $('#ad-type').value, use: $('#ad-use').value, reg: $('#ad-reg').value, near: $('#ad-near').checked, pos: NAV.pos });
  $('#ad-count').textContent = `${r.length} de ${AD.length} aeródromos y helipuertos · AIP al ${window.AD_FECHA || ''}`;
  $('#ad-list').innerHTML = r.slice(0, 200).map(a => adItem(a)).join('') + (r.length > 200 ? '<p class="muted">Refina la búsqueda para ver más.</p>' : '');
}
$('#ad-list').onclick = e => { const it = e.target.closest('[data-icao]'); if (it) showAd(it.dataset.icao); };

/* ------------------------------------------------------------------ NAVEGACIÓN / GPS */
const NAV = {
  on: false, sim: false, watch: null, pos: null, prev: null, gs: null, trk: null, alt: null, vs: 0, acc: null,
  route: [], idx: 1, direct: null, directFrom: null, track: [], tAir: null, lastLog: 0, wake: null, simT: null,
  loadRoute() { this.route = routePts().filter(Boolean); this.idx = 1; this.direct = null; },
  target() { return this.direct || this.route[this.idx] || null; },
  legFrom() { return this.direct ? this.directFrom : this.route[this.idx - 1]; },
  start() {
    if (this.on) return;
    if (!('geolocation' in navigator)) return toast('Este dispositivo no tiene GPS disponible');
    this.on = true; setGps('wait');
    if (!this.route.length) this.loadRoute();
    this.watch = navigator.geolocation.watchPosition(p => this.onFix({
      la: p.coords.latitude, lo: p.coords.longitude, alt: p.coords.altitude, spd: p.coords.speed, hdg: p.coords.heading, acc: p.coords.accuracy, t: p.timestamp
    }), err => { setGps('off'); toast(err.code === 1 ? 'Permiso de ubicación denegado' : 'Sin señal GPS'); }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    this.keepAwake(); renderNav();
  },
  stop() {
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    clearInterval(this.simT); this.watch = null; this.on = false; this.sim = false; setGps('off');
    if (this.wake) { this.wake.release().catch(() => { }); this.wake = null; } renderNav();
  },
  async keepAwake() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') this.wake = await navigator.wakeLock.request('screen'); } catch (e) { } },
  onFix(f) {
    setGps('on');
    const prev = this.pos; this.pos = { la: f.la, lo: f.lo }; this.acc = f.acc;
    let gs = f.spd != null && !isNaN(f.spd) ? f.spd * 1.94384 : null, trk = f.hdg != null && !isNaN(f.hdg) ? f.hdg : null;
    if (prev && this.prevT && f.t > this.prevT) {
      const dt = (f.t - this.prevT) / 3600e3, d = distNM(prev, this.pos);
      if (gs == null) gs = d / dt;
      if (trk == null && d > 0.005) trk = bearing(prev, this.pos);
      if (f.alt != null && this.altM != null) { const vs = (f.alt - this.altM) * 3.28084 / ((f.t - this.prevT) / 60000); this.vs = this.vs * 0.6 + vs * 0.4; }
    }
    this.prevT = f.t; this.altM = f.alt;
    this.gs = gs; if (trk != null && (gs == null || gs > 3)) this.trk = trk;
    this.alt = f.alt != null ? f.alt * 3.28084 : null;
    if (gs > 40 && !this.tAir) { this.tAir = Date.now(); toast('Despegue detectado: cronómetro iniciado'); }
    if (Date.now() - this.lastLog > 5000) { this.track.push([+f.la.toFixed(6), +f.lo.toFixed(6), this.alt != null ? Math.round(this.alt) : null, f.t]); this.lastLog = Date.now(); if (MAP.trail) MAP.trail.addLatLng([f.la, f.lo]); }
    this.sequence();
    MAP.updateOwn(this.pos, this.trk);
    if ($('#v-vuelo').classList.contains('active')) renderNav();
  },
  sequence() {
    if (this.direct || !this.route.length) return;
    const tgt = this.target(), from = this.legFrom(); if (!tgt || !from || this.idx >= this.route.length - 1) return;
    const d = distNM(this.pos, tgt), legD = distNM(from, tgt), x = crossTrack(from, tgt, this.pos);
    if (d < 1 || (x.atk > legD && d < 5)) { this.idx++; toast('Siguiente punto: ' + this.route[this.idx].id); if (navigator.vibrate) navigator.vibrate(200); }
  },
  simulate() {
    if (this.sim) { this.stop(); return; }
    if (!routeValid()) return toast('Define una ruta para simular');
    if (this.on) this.stop();
    this.loadRoute(); this.on = true; this.sim = true; this.track = []; this.tAir = null; if (MAP.trail) MAP.trail.setLatLngs([]);
    const r = this.route; let leg = 0, f = 0, t = Date.now(); const spd = +S.ac.tas || 100, crz = (+S.plan.cruise || 4500) / 3.28084;
    const e0 = (r[0].e || 0) / 3.28084;
    this.simT = setInterval(() => {
      t += 1000 * 10; // 10x
      const a = r[leg], b = r[leg + 1]; if (!b) { this.stop(); toast('Simulación terminada'); return; }
      const L = distNM(a, b); f += (spd * 10 / 3600) / L;
      if (f >= 1) { f = 0; leg++; if (!r[leg + 1]) { this.stop(); toast('Simulación terminada'); return; } }
      const p = interp(r[leg], r[leg + 1], f), total = this.track.length;
      const alt = Math.min(crz, e0 + total * 50);
      this.onFix({ la: p.la, lo: p.lo, alt, spd: spd / 1.94384, hdg: bearing(r[leg], r[leg + 1]), acc: 5, t });
    }, 1000);
    setGps('on'); toast('Simulación a 10× sobre la ruta'); showView('v-vuelo');
  }
};
function setGps(s) { const p = $('#gps-pill'); p.className = 'pill' + (s === 'on' ? '' : s === 'wait' ? ' wait' : ' off'); p.textContent = s === 'on' ? (NAV.sim ? 'SIM' : 'GPS') : s === 'wait' ? 'GPS…' : 'GPS'; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && NAV.on && !NAV.wake) NAV.keepAwake(); });

function directTo(p) {
  const r = resolve(p); if (!r) return;
  if (!NAV.pos) { NAV.start(); toast('Esperando GPS para el directo…'); const iv = setInterval(() => { if (NAV.pos) { clearInterval(iv); directTo(p); } }, 1000); setTimeout(() => clearInterval(iv), 30000); return; }
  NAV.direct = r; NAV.directFrom = { ...NAV.pos, id: 'POS', name: 'Posición' }; showView('v-vuelo'); toast('Directo a ' + r.id); renderNav();
}
$('#nav-toggle').onclick = () => NAV.on ? NAV.stop() : NAV.start();
$('#nav-sim').onclick = () => NAV.simulate();
$('#nav-direct').onclick = () => pickAerodrome('Directo a…', p => p && directTo(p));
$('#nav-nearest').onclick = () => {
  if (!NAV.pos) { NAV.start(); return toast('Esperando posición GPS…'); }
  const list = AD.filter(a => a.la != null && !a.x && a.t !== 'H').map(a => ({ a, d: distNM(NAV.pos, a) })).sort((x, y) => x.d - y.d).slice(0, 8);
  const gs = NAV.gs > 30 ? NAV.gs : +S.ac.tas;
  const body = openModal('Aeródromos más cercanos', `<div class="list">${list.map(({ a, d }) => adItem(a, `${num(d, 1)} NM<br>${hdg(bearing(NAV.pos, a) - S.ac.mvar)}°M · ${hmm(d / gs)}`)).join('')}</div>
    <p class="note">Toca uno para navegar directo. Excluye helipuertos y aeródromos cerrados. Verifica si son de uso privado.</p>`);
  $('.list', body).onclick = e => { const it = e.target.closest('[data-icao]'); if (it) { closeModal(); directTo({ i: it.dataset.icao }); } };
};
$('#nav-gpx').onclick = () => {
  if (!NAV.track.length) return toast('Aún no hay traza registrada');
  const seg = NAV.track.map(([la, lo, alt, t]) => `   <trkpt lat="${la}" lon="${lo}">${alt != null ? `<ele>${(alt / 3.28084).toFixed(0)}</ele>` : ''}<time>${new Date(t).toISOString()}</time></trkpt>`).join('\n');
  download(`traza-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.gpx`, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="VFR Chile" xmlns="http://www.topografix.com/GPX/1/1">\n <trk><name>Vuelo ${new Date().toLocaleDateString('es-CL')}</name><trkseg>\n${seg}\n </trkseg></trk>\n</gpx>\n`, 'application/gpx+xml');
};

function setT(id, v) { const el = $('#' + id); if (el && el.textContent !== String(v)) el.textContent = v; }
function renderNav() {
  const mv = +S.ac.mvar || 0;
  $('#nav-toggle').textContent = NAV.on && !NAV.sim ? 'Detener GPS' : 'Iniciar GPS';
  $('#nav-toggle').classList.toggle('on', NAV.on && !NAV.sim);
  $('#nav-sim').textContent = NAV.sim ? 'Detener sim.' : 'Simular';
  $('#nav-sim').classList.toggle('on', NAV.sim);
  $('#t-fuel-u').textContent = S.ac.unit;
  const pos = NAV.pos, tgt = NAV.target(), from = NAV.legFrom();
  setT('t-gs', NAV.gs != null ? num(NAV.gs) : '—');
  setT('t-alt', NAV.alt != null ? num(Math.round(NAV.alt / 10) * 10) : '—');
  const tt = TERR.get(NAV.route), lm = tt && !NAV.direct ? tt.legs[NAV.idx - 1] : null;
  const zk = pos0 => {
    if (!pos0) return '';
    return zonesAt(pos0).map(z => { const v = NAV.alt != null ? zVert(z, NAV.alt) : null; return `${z.id}|${v}`; }).join(',');
  };
  const zkey = zk(NAV.pos);
  if (zkey !== MAP.zkey) {
    MAP.zkey = zkey;
    $('#nav-zone').innerHTML = zkey ? zonesAt(NAV.pos).map(z => {
      const v = NAV.alt != null ? zVert(z, NAV.alt) : null;
      return `<div class="alert ${v === false ? 'ok' : z.k === 'P' ? 'bad' : 'warn'}">Dentro de ${esc(z.id)} (${ZNOM[z.k]}${z.n ? ' · ' + esc(z.n) : ''}) · ${esc(zLimits(z))}${v === false ? ' · tu altitud está fuera de los límites' : ''}</div>`;
    }).join('') : '';
  }
  setT('t-msa', lm ? num(lm.msa) : '—');
  $('#t-msa').parentElement.classList.toggle('low', !!(lm && NAV.alt != null && NAV.alt < lm.msa));
  setT('t-trk', NAV.trk != null ? hdg(NAV.trk - mv) : '—');
  setT('t-vs', NAV.alt != null && NAV.prevT ? (Math.abs(NAV.vs) < 50 ? '0' : (NAV.vs > 0 ? '+' : '') + num(Math.round(NAV.vs / 10) * 10)) : '—');
  setT('t-acc', NAV.acc != null ? num(NAV.acc) : '—');
  let brgT = null, dtkT = null;
  if (pos && tgt) {
    const d = distNM(pos, tgt); brgT = bearing(pos, tgt);
    setT('t-dwp', num(d, d < 10 ? 1 : 0)); setT('t-bwp', hdg(brgT - mv));
    const gs = NAV.gs > 20 ? NAV.gs : null; setT('t-ewp', gs ? hmm(d / gs) : '—');
    if (from) { dtkT = bearing(from, tgt); const x = crossTrack(from, tgt, pos); setT('t-dtk', hdg(dtkT - mv)); setT('t-xtk', Math.abs(x.xtk) < 0.05 ? '0.0' : num(Math.abs(x.xtk), 1) + (x.xtk > 0 ? ' D' : ' I')); }
    let rem = d; if (!NAV.direct) for (let i = NAV.idx; i < NAV.route.length - 1; i++) rem += distNM(NAV.route[i], NAV.route[i + 1]);
    setT('t-dds', num(rem)); setT('t-eta', gs ? hhmm(new Date(Date.now() + rem / gs * 3600e3)) : '—');
    $('#nav-target').textContent = `${NAV.direct ? 'DIRECTO → ' : '→ '}${tgt.id}${tgt.name && tgt.name !== tgt.id ? ' · ' + tgt.name : ''}`;
  } else {
    ['t-dwp', 't-bwp', 't-ewp', 't-dtk', 't-xtk', 't-dds', 't-eta'].forEach(i => setT(i, '—'));
    $('#nav-target').textContent = tgt ? `→ ${tgt.id} (esperando GPS)` : 'Sin destino activo · define una ruta en Plan o usa "Directo a"';
  }
  const ff = +S.ac.ff || 0;
  if (NAV.tAir) {
    const h = (Date.now() - NAV.tAir) / 3600e3, rem = (+S.ac.fuel || 0) - (+S.ac.taxi || 0) - ff * h;
    setT('t-time', hmm(h)); setT('t-fuel', num(rem, 0)); setT('t-end', ff ? hmm(rem / ff) : '—');
  } else { setT('t-time', '—'); setT('t-fuel', num(+S.ac.fuel || 0)); setT('t-end', ff ? hmm(((+S.ac.fuel || 0) - (+S.ac.taxi || 0)) / ff) : '—'); }
  drawHsi(NAV.trk, brgT, dtkT);
  const legs = NAV.route.length ? NAV.route : routePts().filter(Boolean);
  $('#nav-legs').innerHTML = legs.length ? legs.map((p, i) => {
    const cls = !NAV.direct && i === NAV.idx ? 'active' : (!NAV.direct && i < NAV.idx && NAV.on ? 'done' : '');
    const d = pos ? distNM(pos, p) : null;
    return `<div class="item ${cls}" data-leg="${i}"><span class="ic">${i + 1}</span><span class="tx"><b>${esc(p.id)}</b><small>${esc(p.ad ? p.ad.n : p.name)}${p.ad && p.ad.q ? ' · ' + esc(p.ad.q) : ''}</small></span><span class="rt">${d != null ? num(d, 1) + ' NM' : ''}</span></div>`;
  }).join('') : '<p class="muted">Sin ruta.</p>';
}
$('#nav-legs').onclick = e => { const it = e.target.closest('[data-leg]'); if (!it || !NAV.route.length) return; const i = +it.dataset.leg; if (i === 0) return; NAV.direct = null; NAV.idx = i; toast('Navegando hacia ' + NAV.route[i].id); renderNav(); };

/* HSI simplificado: rosa de rumbos girando con el track; aguja amarilla al waypoint; línea de DTK */
let hsiBuilt = false;
function drawHsi(trk, brgT, dtkT) {
  const svg = $('#hsi'); const mv = +S.ac.mvar || 0;
  if (!hsiBuilt) {
    let ticks = '';
    for (let a = 0; a < 360; a += 5) {
      const long = a % 30 === 0, r1 = long ? 78 : (a % 10 === 0 ? 84 : 88);
      ticks += `<line x1="0" y1="${-r1}" x2="0" y2="-94" transform="rotate(${a})" stroke="#9fb3cf" stroke-width="${long ? 2 : 1}"/>`;
      if (long) { const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] || String(a / 10); ticks += `<text x="0" y="-62" transform="rotate(${a})" text-anchor="middle" font-size="${'NESW'.includes(lbl) ? 15 : 12}" font-weight="700" fill="${lbl === 'N' ? '#f5b301' : '#e8eef7'}">${lbl}</text>`; }
    }
    svg.innerHTML = `<circle r="104" fill="#0a1220" stroke="#24344d" stroke-width="2"/>
      <g id="hsi-rose">${ticks}<g id="hsi-dtk"><line x1="0" y1="-56" x2="0" y2="56" stroke="#d946ef" stroke-width="3" stroke-dasharray="6 5"/></g>
        <g id="hsi-brg"><path d="M0 -96 L7 -80 L2 -80 L2 60 L-2 60 L-2 -80 L-7 -80 Z" fill="#f5b301"/></g></g>
      <path d="M0 -104 L-7 -114 L7 -114 Z" fill="#fff"/>
      <path d="M0 -18 L3 -4 L16 3 L16 6 L3 3 L2 13 L6 16 L6 18 L0 17 L-6 18 L-6 16 L-2 13 L-3 3 L-16 6 L-16 3 L-3 -4 Z" fill="#fff"/>
      <rect x="-30" y="24" width="60" height="38" rx="8" fill="#0a1220" fill-opacity=".9" stroke="#24344d"/>
      <text id="hsi-trk" x="0" y="48" text-anchor="middle" font-size="22" font-weight="800" fill="#5fd3ff">---</text>
      <text x="0" y="58" text-anchor="middle" font-size="8.5" fill="#8a9bb4">TRK °M</text>`;
    hsiBuilt = true;
  }
  const t = trk != null ? trk - mv : 0; // rosa en grados magnéticos
  $('#hsi-rose').setAttribute('transform', `rotate(${-t})`);
  $('#hsi-trk').textContent = trk != null ? hdg(trk - mv) : '---';
  const b = $('#hsi-brg'), k = $('#hsi-dtk');
  if (brgT != null) { b.style.display = ''; b.setAttribute('transform', `rotate(${brgT - mv})`); } else b.style.display = 'none';
  if (dtkT != null) { k.style.display = ''; k.setAttribute('transform', `rotate(${dtkT - mv})`); } else k.style.display = 'none';
}

/* ------------------------------------------------------------------ información, instalación, SW */
$('#btn-info').onclick = () => {
  openModal('Acerca de VFR Chile', `<p>Herramienta de apoyo para planificar vuelos VFR en Chile.</p>
    <div class="kv"><span>Aeródromos</span><b>${AD.length} registros del IFIS / AIP Chile (DGAC), extraídos el ${esc(window.AD_FECHA || '')}</b>
    <span>METAR / TAF</span><b>aviationweather.gov (NOAA)</b><span>Pronóstico</span><b>Open-Meteo</b><span>Mapas</span><b>OpenStreetMap, OpenTopoMap, Esri</b></div>
    <div class="alert warn">No es una fuente oficial ni reemplaza el AIP vigente, los NOTAM, el briefing meteorológico de la DGAC, las cartas aeronáuticas ni los instrumentos de la aeronave. El piloto al mando es responsable de verificar toda la información antes y durante el vuelo.</div>
    <h3>Consejos</h3><ul class="muted"><li>Abre el mapa de tu zona con conexión antes de volar para que quede disponible sin internet.</li><li>Mantén presionado el mapa para crear puntos de ruta propios.</li><li>"Simular" recorre tu ruta a 10× para practicar sin moverte.</li></ul>
    <button id="reset-all" class="btn danger small" type="button">Borrar todos los datos guardados</button>`);
  $('#reset-all').onclick = () => { if (confirm('Se borrarán planes, aeronave y preferencias.')) { localStorage.removeItem(LS); localStorage.removeItem('vfrchile.wx'); location.reload(); } };
};
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#btn-install').classList.remove('hidden'); });
$('#btn-install').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#btn-install').classList.add('hidden'); };
if ('serviceWorker' in navigator && location.protocol !== 'file:') addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));

function firstRun() {
  if (S.ok) return;
  const body = openModal('Antes de comenzar', `<p>VFR Chile es una ayuda de planificación para pilotos civiles. La información del AIP puede cambiar y la ubicación del teléfono puede ser imprecisa.</p>
    <div class="alert warn">No uses esta app como medio primario de navegación. Verifica siempre AIP, NOTAM y meteorología oficial de la DGAC.</div>
    <button id="ok-go" class="btn primary" type="button" style="width:100%;margin-top:14px">Entiendo</button>`);
  $('#ok-go', body).onclick = () => { S.ok = true; save(); closeModal(); };
}

/* ------------------------------------------------------------------ inicio */
fillForm(); renderPickers(); renderWps(); renderNavlog(); renderSaved(); renderExamples(); renderWxChips(); renderAdList();
MAP.init(); renderNav(); firstRun();
{ const v = { '#plan': 'v-plan', '#meteo': 'v-meteo', '#vuelo': 'v-vuelo', '#aerodromos': 'v-ad' }[location.hash]; if (v) showView(v); }
setInterval(() => { renderWxChips(); if (NAV.on && $('#v-vuelo').classList.contains('active')) renderNav(); }, 30000);
