'use strict';

const APP_VER = 'v1.6.1';

/* ============================================================
   Countries Been 3D — logica applicativa
   ============================================================ */

const URL_NAZIONI = 'https://unpkg.com/world-atlas@2.0.2/countries-50m.json';
const URL_META    = 'https://cdn.jsdelivr.net/npm/world-countries@5/dist/countries-unescaped.json';
const URL_CITTA   = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_populated_places_simple.geojson';
const URL_TEXTURE = 'https://unpkg.com/three-globe/example/img/earth-night.jpg';

const LS_NAZIONI = 'cb3_nazioni';
const LS_CITTA   = 'cb3_citta';
const LS_CACHE   = 'cb3_cache_citta';
const LS_CASA    = 'cb3_casa';

/* palette: colori ben distinti fra loro */
const COL = {
  nazioneBase: 'rgba(88,108,152,0.95)',   // grigio-blu: non visitata
  nazioneVisita: 'rgba(34,197,94,0.95)',  // verde: visitata
  nazioneSelez: 'rgba(34,211,238,0.95)',  // ciano: selezionata
  nazioneCasa: 'rgba(167,139,250,0.95)',  // viola: dove vivo
  nazioneCasaSel: 'rgba(196,181,253,0.98)',
  cittaVista: '#ff6b35',                  // arancione brillante: città visitata
  cittaNo: 'rgba(255,255,255,0.25)',      // bianco quasi invisibile
  cittaCasa: '#c084fc'                    // viola vivo: città dove vivo
};

const stato = {
  features: [],
  featureByKey: new Map(),
  cittaById: new Map(),
  cittaPerNazione: new Map(),
  cacheCitta: {},
  visitateNazioni: new Set(),
  visitateCitta: new Set(),
  casaNazione: null,   // key della nazione di residenza
  casaCitta: null,     // {id,nome,lat,lon} della città di residenza
  selezionata: null,
  query: '',
  pronte: false
};

let indiceAlias = new Map(); // alias normalizzato/codice -> meta nazione
let indiceCcn3 = new Map();  // codice numerico ISO (ccn3) -> meta nazione
let globo = null;

/* ---------------- utilità ---------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formattaPop(p) {
  if (!p) return '';
  if (p >= 1000000) return (p / 1000000).toFixed(1).replace('.', ',') + ' M ab.';
  if (p >= 1000) return Math.round(p / 1000) + 'k ab.';
  return p + ' ab.';
}

function hashId() {
  let h = 5381;
  for (const s of arguments) {
    const str = String(s);
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return 'p' + (h >>> 0).toString(36);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

let toastTimer = null;
function toast(msg, durata = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('vis');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('vis'), durata);
}

/* ---------------- persistenza ---------------- */

function salva() {
  localStorage.setItem(LS_NAZIONI, JSON.stringify([...stato.visitateNazioni]));
  localStorage.setItem(LS_CITTA, JSON.stringify([...stato.visitateCitta]));
}

function salvaCache() {
  try { localStorage.setItem(LS_CACHE, JSON.stringify(stato.cacheCitta)); } catch (e) {}
}

function salvaCasa() {
  localStorage.setItem(LS_CASA, JSON.stringify({ nazione: stato.casaNazione, citta: stato.casaCitta }));
}

function carica() {
  try {
    stato.visitateNazioni = new Set(JSON.parse(localStorage.getItem(LS_NAZIONI) || '[]'));
    stato.visitateCitta = new Set(JSON.parse(localStorage.getItem(LS_CITTA) || '[]'));
    stato.cacheCitta = JSON.parse(localStorage.getItem(LS_CACHE) || '{}');
    const c = JSON.parse(localStorage.getItem(LS_CASA) || 'null');
    if (c) {
      stato.casaNazione = c.nazione || null;
      stato.casaCitta = c.citta || null;
    }
  } catch (e) {}
}

/* ---------------- indici nazioni ---------------- */

function costruisciIndici(metaList) {
  const byCcn = new Map();
  const byA3 = new Map();
  indiceAlias = new Map();
  indiceCcn3 = new Map();

  for (const m of metaList) {
    const key = m.ccn3 ? 'c' + m.ccn3 : 'x:' + norma(m.name.common);
    const meta = {
      key,
      a2: m.cca2,
      a3: m.cca3,
      flag: m.flag || emojiDaA2(m.cca2),
      nomeIt: (m.translations && m.translations.ita && m.translations.ita.common) || m.name.common,
      nomeEn: m.name.common
    };
    if (m.ccn3) {
      byCcn.set(m.ccn3, meta);
      indiceCcn3.set(String(m.ccn3), meta);
    }
    byA3.set(m.cca3, meta);

    const nomi = [m.name.common, m.name.official]
      .concat(m.altSpellings || [])
      .concat(m.translations && m.translations.ita ? [m.translations.ita.common, m.translations.ita.official] : []);
    for (const nome of nomi) for (const v of variantiNome(nome)) if (v && !indiceAlias.has(v)) indiceAlias.set(v, meta);
    indiceAlias.set(m.cca2.toUpperCase(), meta);
    indiceAlias.set(m.cca3.toUpperCase(), meta);
  }

  for (const [alias, a3] of Object.entries(SOPRASCRIPTI)) {
    const meta = byA3.get(a3.toUpperCase());
    if (meta) indiceAlias.set(alias, meta);
  }
}

function trovaMetaFeature(f) {
  const id = String(f.id || '');
  if (/^\d+$/.test(id)) {
    const m = indiceCcn3.get(id);            // id numerico == ccn3
    if (m) return m;
  }
  return indiceAlias.get(norma(f.properties && f.properties.name)) || null;
}

function trovaKeyCitta(props) {
  if (props.iso_a2 && props.iso_a2 !== '-99') {
    const m = indiceAlias.get(String(props.iso_a2).toUpperCase());
    if (m) return m.key;
  }
  for (const v of variantiNome(props.adm0name)) {
    const m = indiceAlias.get(v);
    if (m) return m.key;
  }
  return null;
}

/* ---------------- globo ---------------- */

function coloreCap(f) {
  if (f.key === stato.casaNazione) {
    return stato.selezionata === f.key ? COL.nazioneCasaSel : COL.nazioneCasa;
  }
  if (stato.selezionata === f.key) return COL.nazioneSelez;
  if (stato.visitateNazioni.has(f.key)) return COL.nazioneVisita;
  return COL.nazioneBase;
}

function altPoligono(f) {
  if (stato.selezionata === f.key) return 0.035;
  if (f.key === stato.casaNazione) return 0.02;
  if (stato.visitateNazioni.has(f.key)) return 0.018;
  return 0.006;
}

function nomeNazione(f) {
  return (f.meta && f.meta.nomeIt) || (f.properties && f.properties.name) || '?';
}

function etichettaNazione(f) {
  const vis = stato.visitateNazioni.has(f.key);
  const casa = f.key === stato.casaNazione ? '🏠 ' : '';
  const flag = f.meta && f.meta.flag ? esc(f.meta.flag) + ' ' : '';
  return `<div style="background:rgba(11,17,34,.92);padding:8px 12px;border-radius:10px;border:1px solid rgba(120,160,255,.35)">
    <b style="font-size:14px">${casa}${flag}${esc(nomeNazione(f))}</b><br>
    <span style="font-size:12px;color:${vis ? '#4ade80' : '#93a4c8'}">${vis ? '✓ Visitata' : 'Non visitata'}</span>
  </div>`;
}

function centroide(f) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const scan = a => {
    if (typeof a[0] === 'number') {
      if (a[0] < minX) minX = a[0];
      if (a[0] > maxX) maxX = a[0];
      if (a[1] < minY) minY = a[1];
      if (a[1] > maxY) maxY = a[1];
    } else a.forEach(scan);
  };
  scan(f.geometry.coordinates);
  return { lat: (minY + maxY) / 2, lng: (minX + maxX) / 2 };
}

function eCasa(id) {
  return !!(stato.casaCitta && stato.casaCitta.id === id);
}

function colorePunto(c) {
  if (eCasa(c.id)) return COL.cittaCasa;
  return stato.visitateCitta.has(c.id) ? COL.cittaVista : COL.cittaNo;
}

function altPunto(c) {
  if (eCasa(c.id)) return 0.04;
  if (stato.visitateCitta.has(c.id)) return 0.025;
  return 0.008;
}

function raggioPunto(c) {
  if (eCasa(c.id)) return 0.5;
  if (stato.visitateCitta.has(c.id)) return 0.32;
  return 0.1;
}

function etichettaCitta(c) {
  const vis = stato.visitateCitta.has(c.id);
  const pref = eCasa(c.id) ? '🏠 ' : '';
  const col = eCasa(c.id) ? '#c084fc' : (vis ? '#ff6b35' : '#93a4c8');
  return `<div style="background:rgba(11,17,34,.92);padding:6px 10px;border-radius:8px;border:1px solid rgba(120,160,255,.35)">
        <b>${pref}${esc(c.nome)}</b>${c.pop ? ` · ${formattaPop(c.pop)}` : ''}<br>
        <span style="font-size:11px;color:${col}">
          ${eCasa(c.id) ? 'La tua città' : vis ? '✓ Visitata' : 'Tocca per segnare'}</span></div>`;
}

function initGlobo(feats) {
  stato.features = feats;

  /* prestazioni: niente antialiasing, niente animazione iniziale,
     risoluzione dei poligoni ridotta -> gira fluido anche su PC lenti */
  globo = Globe({
    backgroundColor: 'rgba(0,0,0,0)',
    animateIn: false,
    rendererConfig: { antialias: false, alpha: true },
    controlType: 'orbit'
  })(document.getElementById('globeViz'))
    .width(innerWidth)
    .height(innerHeight)
    .showAtmosphere(true)
    .atmosphereColor('#3a86ff')
    .atmosphereAltitude(0.22)
    .polygonsData(feats)
    .polygonCapColor(coloreCap)
    .polygonCapCurvatureResolution(8)
    .polygonSideColor(() => 'rgba(120,145,200,0.18)')
    .polygonStrokeColor(() => 'rgba(195,215,255,0.55)')
    .polygonAltitude(altPoligono)
    .onPolygonClick(selezionaNazione)
    .onGlobeClick(() => deseleziona())
    .pointsData([])
    .pointLat(c => c.lat)
    .pointLng(c => c.lon)
    .pointColor(colorePunto)
    .pointAltitude(altPunto)
    .pointRadius(raggioPunto)
    .pointLabel(c => etichettaCitta(c))
    .onPointClick(c => toggleCitta(c.id))
    /* etichette con il nome sempre visibili accanto alle città visitate/casa */
    .labelsData([])
    .labelLat(d => d.lat)
    .labelLng(d => d.lon)
    .labelText(d => d.nome)
    .labelSize(() => 0.75)
    .labelDotRadius(() => 0.22)
    .labelColor(d => d.casa ? '#c084fc' : '#ff6b35')
    .labelAltitude(d => d.alt)
    .labelResolution(2);

  globo.pointOfView({ lat: 25, lng: 12, altitude: 2.7 }, 0);

  addEventListener('resize', () => {
    globo.width(innerWidth);
    globo.height(innerHeight);
  });
}

function aggiornaPoligoni() {
  globo.polygonsData(stato.features.slice());
}

/* ---------------- selezione nazione ---------------- */

function selezionaNazione(f) {
  stato.tsClick = Date.now();
  stato.selezionata = f.key;
  stato.query = '';
  aggiornaPoligoni();
  renderPannello();
  const c = centroide(f);
  globo.controls().autoRotate = false;
  globo.pointOfView({ lat: c.lat, lng: c.lng, altitude: 1.7 }, 900);
}

function deseleziona() {
  if (!stato.selezionata) return;
  if (Date.now() - (stato.tsClick || 0) < 400) return; // ignora il click del globo subito dopo la selezione
  stato.selezionata = null;
  aggiornaPoligoni();
  renderPannello();
}

function toggleNazione() {
  const key = stato.selezionata;
  if (!key) return;
  if (stato.visitateNazioni.has(key)) {
    stato.visitateNazioni.delete(key);
    toast('Rimossa dalle nazioni visitate');
  } else {
    stato.visitateNazioni.add(key);
    toast('✓ Aggiunta alle nazioni visitate!');
  }
  salva();
  aggiornaPoligoni();
  aggiornaStatistiche();
  aggiornaPulsanteVisita();
}

/* ---------------- città ---------------- */

async function caricaCitta() {
  try {
    /* 1) prova la cache locale (svelta, offline) */
    const cache = await caches.open('cb-dati');
    let gj = null;
    try {
      const ris = await cache.match(URL_CITTA);
      if (ris) gj = await ris.json();
    } catch (e) {}

    /* 2) altrimenti scarica e mette in cache per la prossima volta */
    if (!gj) {
      gj = await fetchJson(URL_CITTA);
      try { cache.put(URL_CITTA, new Response(JSON.stringify(gj), { headers: { 'Content-Type': 'application/json' } })); } catch (e) {}
    }
    costruisciCittaDa(gj);
  } catch (e) {
    if (!stato.pronte) toast('⚠️ Impossibile scaricare le città (serve internet la prima volta)', 4000);
  }
}

function costruisciCittaDa(gj) {
  for (const ft of gj.features) {
    const p = ft.properties;
    const id = hashId(p.name, p.latitude, p.longitude);
    if (stato.cittaById.has(id)) continue;
    const key = trovaKeyCitta(p);
    if (!key) continue;
    const c = {
      id,
      nome: p.name || p.nameascii || '?',
      lat: Number(p.latitude),
      lon: Number(p.longitude),
      pop: Number(p.pop_max) || 0,
      key
    };
    stato.cittaById.set(id, c);
    if (!stato.cittaPerNazione.has(key)) stato.cittaPerNazione.set(key, []);
    stato.cittaPerNazione.get(key).push(c);
  }
  stato.pronte = true;
  if (stato.selezionata) renderPannello();
  else aggiornaPunti();
}

function puntiVisibili() {
  const mappa = new Map();
  const push = (c) => { if (c && !mappa.has(c.id)) mappa.set(c.id, Object.assign({}, c)); };
  /* città visitate (sempre visibili) */
  for (const id of stato.visitateCitta) {
    push(stato.cittaById.get(id) || stato.cacheCitta[id]);
  }
  /* città della nazione selezionata (solo grandi, per non appesantire il globo) */
  if (stato.selezionata) {
    (stato.cittaPerNazione.get(stato.selezionata) || [])
      .filter(c => c.pop >= 100000)
      .forEach(c => push(c));
  }
  /* città dove vivo (sempre visibile) */
  if (stato.casaCitta) {
    const c = stato.cittaById.get(stato.casaCitta.id) ||
              stato.cacheCitta[stato.casaCitta.id] ||
              { id: stato.casaCitta.id, nome: stato.casaCitta.nome, lat: stato.casaCitta.lat, lon: stato.casaCitta.lon };
    push(c);
  }
  return Array.from(mappa.values());
}

/* nomi delle città da mostrare sempre scritti accanto al punto */
function etichetteVisibili() {
  const elenco = [];
  const visite = [...stato.visitateCitta].map(id =>
    stato.cittaById.get(id) || stato.cacheCitta[id]).filter(Boolean);
  for (const c of visite) {
    elenco.push({ id: c.id, nome: c.nome, lat: c.lat, lon: c.lon, alt: altPunto(c) + 0.01, casa: eCasa(c.id) });
  }
  if (stato.casaCitta && !stato.visitateCitta.has(stato.casaCitta.id)) {
    const c = stato.cittaById.get(stato.casaCitta.id) || stato.cacheCitta[stato.casaCitta.id];
    if (c) elenco.push({ id: c.id, nome: c.nome, lat: c.lat, lon: c.lon, alt: altPunto(c) + 0.01, casa: true });
  }
  return elenco;
}

function aggiornaPunti() {
  if (!globo) return;
  globo.pointsData(puntiVisibili());
  globo.labelsData(etichetteVisibili());
}

function toggleCitta(id) {
  if (stato.visitateCitta.has(id)) {
    stato.visitateCitta.delete(id);
  } else {
    stato.visitateCitta.add(id);
    const c = stato.cittaById.get(id);
    if (c) {
      stato.cacheCitta[id] = { id, nome: c.nome, lat: c.lat, lon: c.lon, pop: c.pop };
      salvaCache();
    }
  }
  salva();
  aggiornaStatistiche();
  aggiornaPunti();
  aggiornaRigaCitta(id);
  aggiornaContatoreCitta();
}

/* ---------------- pannello ---------------- */

function renderPannello() {
  const p = document.getElementById('pannello');
  if (!stato.selezionata) {
    p.classList.remove('aperta');
    aggiornaPunti();
    return;
  }
  const f = stato.featureByKey.get(stato.selezionata);
  if (!f) { deseleziona(); return; }

  const visitata = stato.visitateNazioni.has(f.key);
  const flag = f.meta && f.meta.flag ? `<span class="flag">${esc(f.meta.flag)}</span>` : '';

  p.innerHTML = `
    <div class="p-head">
      ${flag}
      <h2>${esc(nomeNazione(f))}</h2>
      <button class="btn" id="p-chiudi">✕</button>
    </div>
    <button class="btn-visita ${visitata ? 'attiva' : ''}" id="p-toggle"></button>
    <input class="p-ricerca" id="p-ricerca" placeholder="Cerca città…" autocomplete="off" value="${esc(stato.query)}">
    <div class="p-sub"><span>Città visitate</span><b id="p-count">—</b></div>
    <div class="p-lista" id="p-lista"></div>`;

  document.getElementById('p-chiudi').addEventListener('click', deseleziona);
  document.getElementById('p-toggle').addEventListener('click', toggleNazione);
  document.getElementById('p-ricerca').addEventListener('input', e => {
    stato.query = e.target.value;
    renderListaCitta();
  });

  aggiornaPulsanteVisita();
  renderListaCitta();
  aggiornaContatoreCitta();
  p.classList.add('aperta');
  aggiornaPunti();
}

function aggiornaPulsanteVisita() {
  const b = document.getElementById('p-toggle');
  if (!b || !stato.selezionata) return;
  const vis = stato.visitateNazioni.has(stato.selezionata);
  b.classList.toggle('attiva', vis);
  b.textContent = vis ? '✓ Visitata — tocca per annullare' : 'Segna come visitata ✓';
}

function listaFiltrata() {
  const tutte = (stato.cittaPerNazione.get(stato.selezionata) || [])
    .slice().sort((a, b) => b.pop - a.pop);
  const q = norma(stato.query);
  const filtrata = q ? tutte.filter(c => norma(c.nome).includes(q)) : tutte;
  return { filtrata, totale: tutte.length };
}

const MAX_RIGHE = 600;

function aggiungiCittaManuale(nome, lat, lon, ottieniNomeNazione) {
  if (!stato.selezionata) return;
  nome = (nome || '').trim();
  if (!nome) return;
  const lonOk = (!Number.isNaN(lon) && lon >= -180 && lon <= 180) ? lon : null;
  const latOk = (!Number.isNaN(lat) && lat >= -90 && lat <= 90) ? lat : null;
  let cLat = latOk, cLon = lonOk;
  if (cLat == null || cLon == null) {
    const f = stato.featureByKey.get(stato.selezionata);
    const c = f ? centroide(f) : { lat: 0, lng: 0 };
    cLat = (cLat != null) ? cLat : c.lat;
    cLon = (cLon != null) ? cLon : c.lng;
  }
  const id = hashId(stato.selezionata, nome, cLat, cLon);
  if (stato.cittaById.has(id)) { toast('Città già presente'); return; }
  const c = {
    id,
    nome,
    lat: cLat,
    lon: cLon,
    pop: 0,
    key: stato.selezionata,
    manuale: true
  };
  stato.cittaById.set(id, c);
  if (!stato.cittaPerNazione.has(stato.selezionata)) stato.cittaPerNazione.set(stato.selezionata, []);
  stato.cittaPerNazione.get(stato.selezionata).push(c);
  stato.visitateCitta.add(id);
  stato.cacheCitta[id] = { id, nome: c.nome, lat: c.lat, lon: c.lon, pop: 0 };
  salva();
  salvaCache();
  aggiornaStatistiche();
  aggiornaPunti();
  toast(`➕ "${nome}" aggiunta e segnata come visitata`);
  renderListaCitta();
  aggiornaContatoreCitta();
  /* se non abbiamo coordinate reali, proviamo a trovarle (geocodifica) */
  if (latOk == null || lonOk == null) {
    geoCercaCitta(nome, id);
  }
}

/* trova le coordinate reali di una città (gratis, via GeoNames) e sposta il punto */
async function geoCercaCitta(nome, id) {
  try {
    const f = stato.featureByKey.get(stato.selezionata);
    const nazione = (f && f.meta && f.meta.nomeEn) || '';
    const countryCode = (f && f.meta && f.meta.a2) || '';
    const q = encodeURIComponent(nome);
    let url = `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=1&language=it&format=json`;
    if (countryCode) url += `&countryCode=${countryCode}`;
    const ris = await fetch(url);
    if (!ris.ok) throw new Error('http');
    const dati = await ris.json();
    const trov = dati && dati.results && dati.results[0];
    if (!trov) { return; }
    const c = stato.cittaById.get(id);
    if (!c) return;
    c.lat = trov.latitude;
    c.lon = trov.longitude;
    if (trov.name && trov.name.toLowerCase() !== c.nome.toLowerCase()) c.nome = trov.name;
    stato.cacheCitta[id] = { id, nome: c.nome, lat: c.lat, lon: c.lon, pop: c.pop };
    salva();
    salvaCache();
    aggiornaPunti();
  } catch (e) {}
}

function renderListaCitta() {
  const el = document.getElementById('p-lista');
  if (!el || !stato.selezionata) return;
  const { filtrata, totale } = listaFiltrata();

  if (!stato.pronte) {
    el.innerHTML = '<div class="vuoto">⏳ Elenco città in caricamento…</div>';
    return;
  }

  let html = '';
  if (!filtrata.length) {
    html += `<div class="vuoto">${totale ? 'Nessuna città trovata' : 'Nessuna città in elenco per questa nazione'}</div>`;
  } else {
    filtrata.slice(0, MAX_RIGHE).forEach(c => {
      const vis = stato.visitateCitta.has(c.id);
      html += `<div class="riga-citta ${vis ? 'visitata' : ''}" data-id="${c.id}">
        <span class="pallino"></span>
        <span class="info"><span class="nome">${esc(c.nome)}</span></span>
        <span class="pop">${formattaPop(c.pop)}</span>
      </div>`;
    });
    if (filtrata.length > MAX_RIGHE) {
      html += `<div class="vuoto">…altre ${filtrata.length - MAX_RIGHE} città: usa la ricerca</div>`;
    }
  }

  /* riga per aggiungere una città non presente nel database */
  const q = (stato.query || '').trim();
  html += `<div class="riga-citta" id="aggiungi-citta" style="border:1px dashed rgba(120,160,255,.4);margin-top:6px">
    <span style="color:#38bdf8;font-size:15px">➕</span>
    <span class="info"><span class="nome" style="color:#38bdf8">${esc(q || 'Aggiungi una città non in elenco')}</span></span>
  </div>`;

  el.innerHTML = html;
  el.querySelectorAll('.riga-citta[data-id]').forEach(r =>
    r.addEventListener('click', () => toggleCitta(r.dataset.id)));

  el.querySelector('#aggiungi-citta').addEventListener('click', () => {
    const nome = prompt('Nome della città:', q || '');
    if (!nome) return;
    const coord = prompt('Coordinate (opzionale), formato: latitudine,longitudine\nEsempio: 41.89,12.49  —  oppure lascia vuoto per usare il centro della nazione:', '');
    let lat = null, lon = null;
    if (coord && /-?\d+(\.\d+)?\s*[,;]\s*-?\d+(\.\d+)?/.test(coord.trim())) {
      const [a, b] = coord.split(/[,;]/);
      lat = parseFloat(a);
      lon = parseFloat(b);
    }
    aggiungiCittaManuale(nome, lat, lon);
  });
}

function aggiornaRigaCitta(id) {
  const r = document.querySelector(`.riga-citta[data-id="${CSS.escape(id)}"]`);
  if (r) r.classList.toggle('visitata', stato.visitateCitta.has(id));
}

function aggiornaContatoreCitta() {
  const el = document.getElementById('p-count');
  if (!el || !stato.selezionata) return;
  const tutte = stato.cittaPerNazione.get(stato.selezionata) || [];
  const vis = tutte.filter(c => stato.visitateCitta.has(c.id)).length;
  el.textContent = stato.pronte ? `${vis}/${tutte.length}` : '…';
}

/* ---------------- statistiche ---------------- */

function aggiornaStatistiche() {
  const n = stato.visitateNazioni.size;
  const pct = Math.min(100, (n / TOT_NAZIONI) * 100);
  const pctTxt = (Math.round(pct * 10) / 10).toString().replace('.', ',');
  document.getElementById('st-nazioni').textContent = `${n}/${TOT_NAZIONI}`;
  document.getElementById('st-barra').style.width = pct + '%';
  document.getElementById('st-percento').textContent = `${pctTxt}% del mondo`;
  document.getElementById('st-citta').textContent = stato.visitateCitta.size;
}

function aggiornaRigaCasa() {
  const el = document.getElementById('st-casa');
  if (!el) return;
  if (!stato.casaNazione) { el.textContent = 'tocca qui'; return; }
  const f = stato.featureByKey.get(stato.casaNazione);
  let txt = f ? nomeNazione(f) : '?';
  if (stato.casaCitta && stato.casaCitta.nome) txt += ' · ' + stato.casaCitta.nome;
  el.textContent = txt;
}

/* ---------------- dove vivo ---------------- */

let casaStep = 'nazione';
let casaQuery = '';

function apriCasa() {
  casaStep = 'nazione';
  document.getElementById('modale-casa').classList.add('aperta');
  renderCasa();
}

function chiudiCasa() {
  document.getElementById('modale-casa').classList.remove('aperta');
}

function renderCasa() {
  const tit = document.getElementById('casa-titolo');
  const inp = document.getElementById('casa-ricerca');
  const lst = document.getElementById('casa-lista');
  const btSolo = document.getElementById('casa-solo-nazione');

  if (casaStep === 'nazione') {
    tit.textContent = '🏠 Scegli la tua nazione';
    btSolo.style.display = 'none';
  } else {
    const f = stato.featureByKey.get(stato.casaNazione);
    tit.textContent = '🏠 Scegli la tua città' + (f ? ' — ' + nomeNazione(f) : '');
    btSolo.style.display = 'block';
  }
  inp.value = casaQuery;

  const q = norma(casaQuery);
  let html = '';
  if (!stato.pronte && casaStep === 'citta') {
    html = '<div class="vuoto">⏳ Elenco città in caricamento… riprova tra poco</div>';
  } else if (casaStep === 'nazione') {
    const feats = stato.features.slice()
      .sort((a, b) => nomeNazione(a).localeCompare(nomeNazione(b), 'it'));
    const filtrate = q ? feats.filter(f =>
      norma(nomeNazione(f)).includes(q) ||
      (f.meta && norma(f.meta.nomeEn).includes(q))) : feats;
    filtrate.slice(0, MAX_RIGHE).forEach(f => {
      html += `<div class="riga-citta" data-nazione="${f.key}">
        <span class="pallino" style="background:#a78bfa"></span>
        <span class="info"><span class="nome">${esc(nomeNazione(f))}</span></span>
      </div>`;
    });
    if (!filtrate.length) html += '<div class="vuoto">Nessuna nazione trovata</div>';
  } else {
    const tutte = (stato.cittaPerNazione.get(stato.casaNazione) || [])
      .slice().sort((a, b) => b.pop - a.pop);
    const filtrate = q ? tutte.filter(c => norma(c.nome).includes(q)) : tutte;
    filtrate.slice(0, MAX_RIGHE).forEach(c => {
      html += `<div class="riga-citta" data-citta="${c.id}">
        <span class="pallino"></span>
        <span class="info"><span class="nome">${esc(c.nome)}</span></span>
        <span class="pop">${formattaPop(c.pop)}</span>
      </div>`;
    });
    if (!filtrate.length) html += '<div class="vuoto">Nessuna città trovata</div>';
  }
  lst.innerHTML = html;
}

/* ---------------- backup ---------------- */

function esporta() {
  const dati = {
    app: 'countries-been-3d',
    versione: 1,
    esportato: new Date().toISOString(),
    nazioni: [...stato.visitateNazioni],
    citta: [...stato.visitateCitta],
    cacheCitta: stato.cacheCitta,
    casa: { nazione: stato.casaNazione, citta: stato.casaCitta }
  };
  const blob = new Blob([JSON.stringify(dati, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'countries-been-backup.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('⬇ Backup esportato');
}

function importa(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!Array.isArray(d.nazioni) || !Array.isArray(d.citta)) throw new Error('formato');
      stato.visitateNazioni = new Set(d.nazioni);
      stato.visitateCitta = new Set(d.citta);
      stato.cacheCitta = d.cacheCitta && typeof d.cacheCitta === 'object' ? d.cacheCitta : {};
      if (d.casa && typeof d.casa === 'object') {
        stato.casaNazione = d.casa.nazione || null;
        stato.casaCitta = d.casa.citta || null;
      }
      salva();
      salvaCache();
      salvaCasa();
      aggiornaStatistiche();
      aggiornaRigaCasa();
      aggiornaPunti();
      aggiornaPoligoni();
      renderPannello();
      toast('✓ Backup importato');
    } catch (e) {
      toast('⚠️ File di backup non valido', 3500);
    }
  };
  reader.readAsText(file);
}

/* ---------------- avvio ---------------- */

function mostraCaricamento(txt) {
  document.getElementById('car-testo').textContent = txt;
}

function daCacheOscarica(url, chiaveCache) {
  return (async () => {
    try {
      const cache = await caches.open('cb-dati');
      const hit = await cache.match(url);
      if (hit) return await hit.json();
    } catch (e) {}
    const d = await fetchJson(url);
    try {
      const cache = await caches.open('cb-dati');
      cache.put(url, new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } }));
    } catch (e) {}
    return d;
  })();
}

async function avvia() {
  if (location.protocol === 'file:') {
    document.querySelector('.spinner').style.display = 'none';
    mostraCaricamento('⚠️ Hai aperto il file direttamente (file://).\nIl browser blocca il caricamento dei dati in questo modo.\n\n➡️ Fai doppio clic su "avvia.bat" nella cartella dell\'app:\nsi aprirà da sola su http://localhost:8080');
    return;
  }
  carica();
  try {
    mostraCaricamento('Caricamento pianeta…');
    const [topo, metaRaw] = await Promise.all([
      daCacheOscarica(URL_NAZIONI),
      daCacheOscarica(URL_META)
    ]);
    mostraCaricamento('Costruzione mappa…');

    costruisciIndici(metaRaw);

    const feats = topojson.feature(topo, topo.objects.countries).features;

    // chiavi univoche: alcuni id ("-99") sono duplicati nel dataset -> uso il nome
    const conteggioId = {};
    feats.forEach(f => { const k = String(f.id); conteggioId[k] = (conteggioId[k] || 0) + 1; });
    const duplicati = new Set(Object.keys(conteggioId).filter(k => conteggioId[k] > 1));

    feats.forEach(f => {
      const id = String(f.id || '');
      f.key = (/^\d+$/.test(id) && !duplicati.has(id)) ? 'c' + id : 'x:' + norma(f.properties.name);
      f.meta = trovaMetaFeature(f);
      stato.featureByKey.set(f.key, f);
    });

    initGlobo(feats);
    aggiornaStatistiche();
    aggiornaRigaCasa();

    mostraCaricamento('Caricamento città…');
    await caricaCitta();

    document.getElementById('caricamento').classList.add('nascosto');
    setTimeout(() => document.getElementById('caricamento').remove(), 600);
    toast('Tocca una nazione per iniziare 👆', 3200);

    /* verifica dopo 4 secondi che il canvas esista */
    setTimeout(() => {
      const canvas = document.querySelector('#globeViz canvas');
      if (!canvas || canvas.width < 10 || canvas.height < 10) {
        mostraDiagnostico(
          '⚠️ Il globo3D non è stato creato.\n' +
          'Possibile problema WebGL. Prova ad aggiornare il browser.'
        );
      }
    }, 4000);
  } catch (e) {
    mostraCaricamento('⚠️ Errore di caricamento (' + (e && e.message ? e.message : 'rete') + ').\nControlla la connessione e ricarica la pagina.\nLa prima apertura richiede internet per scaricare i dati.');
  }
}

/* ---------------- eventi interfaccia ---------------- */

/* ---------------- diagnostica visibile (utile se il PC non disegna il globo) ---------------- */

function mostraDiagnostico(testo) {
  const d = document.getElementById('diag');
  if (!d) return;
  d.innerHTML = '<span style="cursor:pointer;float:right;font-size:18px;margin-left:8px" onclick="this.parentElement.style.display=\'none\'">✕</span>' + testo.replace(/\n/g, '<br>');
  d.style.display = 'block';
}

window.addEventListener('error', e => {
  if (e.message && !e.message.includes('ResizeObserver'))
    mostraDiagnostico('Errore: ' + e.message + ' (' + (e.filename || '?') + ')' );
});

(function verificaWebGL() {
  let ok = false;
  try {
    const c = document.createElement('canvas');
    ok = !!(window.WebGLRenderingContext &&
      (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (err) { ok = false; }
  if (!ok) {
    mostraDiagnostico(
      "WebGL non disponibile: il mappamondo non può essere disegnato.\n" +
      "Su Vivaldi / Chrome: Impostazioni → Sistema → attiva 'Usa l'accelerazione hardware quando disponibile' e riavvia il browser.");
  }
})();

/* ---------------- eventi interfaccia ---------------- */

document.getElementById('bt-export').addEventListener('click', esporta);
document.getElementById('bt-import').addEventListener('click', () =>
  document.getElementById('file-input').click());
document.getElementById('file-input').addEventListener('change', e => {
  if (e.target.files && e.target.files[0]) importa(e.target.files[0]);
  e.target.value = '';
});
document.getElementById('bt-help').addEventListener('click', () =>
  document.getElementById('modale-help').classList.add('aperta'));
document.getElementById('help-chiudi').addEventListener('click', () =>
  document.getElementById('modale-help').classList.remove('aperta'));
document.getElementById('modale-help').addEventListener('click', e => {
  if (e.target.id === 'modale-help') e.target.classList.remove('aperta');
});

/* — dove vivo — */
document.getElementById('bt-casa').addEventListener('click', apriCasa);
document.getElementById('riga-casa').addEventListener('click', apriCasa);

document.getElementById('casa-ricerca').addEventListener('input', e => {
  casaQuery = e.target.value;
  renderCasa();
});

document.getElementById('casa-lista').addEventListener('click', e => {
  const rigaN = e.target.closest('[data-nazione]');
  if (rigaN) {
    stato.casaNazione = rigaN.dataset.nazione;
    stato.casaCitta = null;
    salvaCasa();
    aggiornaPoligoni();
    aggiornaRigaCasa();
    casaQuery = '';
    casaStep = 'citta';
    renderCasa();
    return;
  }
  const rigaC = e.target.closest('[data-citta]');
  if (rigaC) {
    const c = stato.cittaById.get(rigaC.dataset.citta);
    stato.casaCitta = c
      ? { id: c.id, nome: c.nome, lat: c.lat, lon: c.lon }
      : null;
    salvaCasa();
    aggiornaPunti();
    aggiornaRigaCasa();
    toast('🏠 Casa impostata!');
    chiudiCasa();
  }
});

document.getElementById('casa-solo-nazione').addEventListener('click', () => {
  toast('🏠 Nazione di residenza salvata');
  chiudiCasa();
});

document.getElementById('casa-togli').addEventListener('click', () => {
  stato.casaNazione = null;
  stato.casaCitta = null;
  salvaCasa();
  aggiornaPoligoni();
  aggiornaPunti();
  aggiornaRigaCasa();
  renderCasa();
  toast('🏠 Casa rimossa');
});

document.getElementById('casa-chiudi').addEventListener('click', chiudiCasa);

document.getElementById('modale-casa').addEventListener('click', e => {
  if (e.target.id === 'modale-casa') chiudiCasa();
});

/* service worker (registrazione + skip-waiting gestiti in index.html inline) */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistration().then(r => {
    if (r && r.waiting) r.waiting.postMessage({ type: 'skip-waiting' });
  });
}

/* bootstrap */
carica();
avvia();
aggiornaRigaCasa();
document.getElementById('st-ver').textContent = APP_VER;

/* pulsante forza-aggiornamento: sempre visibile, risolve ogni problema di cache */
async function forzaAggiornamento() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) {}
  location.reload(true);
}

const btAgg = document.createElement('button');
btAgg.id = 'bt-agg';
btAgg.title = 'Aggiorna app (risolve problemi di cache)';
btAgg.textContent = '🔄';
btAgg.style.cssText = 'position:fixed;bottom:calc(env(safe-area-inset-bottom,0px)+12px);right:12px;z-index:50;width:48px;height:48px;border-radius:50%;border:1px solid #f59e0b;background:#1e1b00;color:#fbbf24;font-size:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.5)';
btAgg.addEventListener('click', forzaAggiornamento);
document.body.appendChild(btAgg);
