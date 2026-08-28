'use strict';

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

const stato = {
  features: [],
  featureByKey: new Map(),
  cittaById: new Map(),
  cittaPerNazione: new Map(),
  cacheCitta: {},
  visitateNazioni: new Set(),
  visitateCitta: new Set(),
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

function carica() {
  try {
    stato.visitateNazioni = new Set(JSON.parse(localStorage.getItem(LS_NAZIONI) || '[]'));
    stato.visitateCitta = new Set(JSON.parse(localStorage.getItem(LS_CITTA) || '[]'));
    stato.cacheCitta = JSON.parse(localStorage.getItem(LS_CACHE) || '{}');
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
  if (stato.selezionata === f.key) return 'rgba(56,189,248,0.9)';
  if (stato.visitateNazioni.has(f.key)) return 'rgba(34,197,94,0.92)';
  return 'rgba(58,78,128,0.92)';
}

function altPoligono(f) {
  if (stato.selezionata === f.key) return 0.055;
  if (stato.visitateNazioni.has(f.key)) return 0.032;
  return 0.014;
}

function nomeNazione(f) {
  return (f.meta && f.meta.nomeIt) || (f.properties && f.properties.name) || '?';
}

function etichettaNazione(f) {
  const vis = stato.visitateNazioni.has(f.key);
  const flag = f.meta && f.meta.flag ? esc(f.meta.flag) + ' ' : '';
  return `<div style="background:rgba(11,17,34,.92);padding:8px 12px;border-radius:10px;border:1px solid rgba(120,160,255,.35)">
    <b style="font-size:14px">${flag}${esc(nomeNazione(f))}</b><br>
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

function initGlobo(feats) {
  stato.features = feats;
  globo = Globe({ backgroundColor: 'rgba(0,0,0,0)', animateIn: true })(document.getElementById('globeViz'))
    .width(innerWidth)
    .height(innerHeight)
    .showAtmosphere(true)
    .atmosphereColor('#3a86ff')
    .atmosphereAltitude(0.22)
    .polygonsData(feats)
    .polygonCapColor(coloreCap)
    .polygonSideColor(() => 'rgba(110,140,200,0.3)')
    .polygonStrokeColor(() => 'rgba(170,200,255,0.55)')
    .polygonAltitude(altPoligono)
    .polygonLabel(etichettaNazione)
    .onPolygonClick(selezionaNazione)
    .onGlobeClick(() => deseleziona())
    .pointsData([])
    .pointLat(c => c.lat)
    .pointLng(c => c.lon)
    .pointColor(c => (stato.visitateCitta.has(c.id) ? '#fbbf24' : 'rgba(255,255,255,0.45)'))
    .pointAltitude(c => (stato.visitateCitta.has(c.id) ? 0.03 : 0.015))
    .pointRadius(c => (stato.visitateCitta.has(c.id) ? 0.22 : 0.16))
    .pointLabel(c => `<div style="background:rgba(11,17,34,.92);padding:6px 10px;border-radius:8px;border:1px solid rgba(120,160,255,.35)">
        <b>${esc(c.nome)}</b>${c.pop ? ` · ${formattaPop(c.pop)}` : ''}<br>
        <span style="font-size:11px;color:${stato.visitateCitta.has(c.id) ? '#fbbf24' : '#93a4c8'}">
          ${stato.visitateCitta.has(c.id) ? '✓ Visitata' : 'Tocca per segnare'}</span></div>`)
    .onPointClick(c => toggleCitta(c.id));

  globo.pointOfView({ lat: 25, lng: 12, altitude: 2.7 }, 0);

  addEventListener('resize', () => {
    globo.width(innerWidth);
    globo.height(innerHeight);
  });

  // Texture della Terra: applicata solo se riesce a scaricarla,
  // altrimenti restano i continenti colorati (sempre visibili)
  const img = new Image();
  img.onload = () => globo.globeImageUrl(URL_TEXTURE);
  img.onerror = () => console.warn('Texture Terra non disponibile, uso i soli continenti');
  img.src = URL_TEXTURE;
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
    const gj = await fetchJson(URL_CITTA);
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
  } catch (e) {
    toast('⚠️ Impossibile scaricare le città (serve internet la prima volta)', 4000);
  }
}

function puntiVisibili() {
  const mappa = new Map();
  const push = (c) => { if (c && !mappa.has(c.id)) mappa.set(c.id, { ...c }); };
  if (stato.selezionata) (stato.cittaPerNazione.get(stato.selezionata) || []).forEach(push);
  for (const id of stato.visitateCitta) {
    push(stato.cittaById.get(id) || stato.cacheCitta[id]);
  }
  return Array.from(mappa.values());
}

function aggiornaPunti() {
  if (globo) globo.pointsData(puntiVisibili());
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

const MAX_RIGHE = 300;

function renderListaCitta() {
  const el = document.getElementById('p-lista');
  if (!el || !stato.selezionata) return;
  const { filtrata, totale } = listaFiltrata();

  if (!stato.pronte) {
    el.innerHTML = '<div class="vuoto">⏳ Elenco città in caricamento…</div>';
    return;
  }
  if (!filtrata.length) {
    el.innerHTML = `<div class="vuoto">${totale ? 'Nessuna città trovata' : 'Nessuna città in elenco per questa nazione'}</div>`;
    return;
  }
  let html = '';
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
  el.innerHTML = html;
  el.querySelectorAll('.riga-citta').forEach(r =>
    r.addEventListener('click', () => toggleCitta(r.dataset.id)));
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

/* ---------------- backup ---------------- */

function esporta() {
  const dati = {
    app: 'countries-been-3d',
    versione: 1,
    esportato: new Date().toISOString(),
    nazioni: [...stato.visitateNazioni],
    citta: [...stato.visitateCitta],
    cacheCitta: stato.cacheCitta
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
      salva();
      salvaCache();
      aggiornaStatistiche();
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

async function avvia() {
  if (location.protocol === 'file:') {
    document.querySelector('.spinner').style.display = 'none';
    mostraCaricamento('⚠️ Hai aperto il file direttamente (file://).\nIl browser blocca il caricamento dei dati in questo modo.\n\n➡️ Fai doppio clic su "avvia.bat" nella cartella dell\'app:\nsi aprirà da sola su http://localhost:8080');
    return;
  }
  carica();
  try {
    mostraCaricamento('Caricamento pianeta…');
    const [topo, metaRaw] = await Promise.all([fetchJson(URL_NAZIONI), fetchJson(URL_META)]);
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

    document.getElementById('caricamento').classList.add('nascosto');
    setTimeout(() => document.getElementById('caricamento').remove(), 600);

    toast('Tocca una nazione per iniziare 👆', 3200);
    caricaCitta();
  } catch (e) {
    mostraCaricamento('⚠️ Errore di caricamento (' + (e && e.message ? e.message : 'rete') + ').\nControlla la connessione e ricarica la pagina.\nLa prima apertura richiede internet per scaricare i dati.');
  }
}

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

/* service worker + aggiornamento automatico */
if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!sessionStorage.getItem('cb3_ricaricata')) {
        sessionStorage.setItem('cb3_ricaricata', '1');
        location.reload();
      }
    });
  });
}

avvia();
