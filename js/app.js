'use strict';

const APP_VER = 'v1.22.0';

/* ============================================================
   Countries Been 3D — logica applicativa
   ============================================================ */

const URL_NAZIONI = 'https://unpkg.com/world-atlas@2.0.2/countries-50m.json';
const URL_META    = 'https://cdn.jsdelivr.net/npm/world-countries@5/dist/countries-unescaped.json';
const URL_CITTA   = 'data/citta.geojson';
const URL_TEXTURE = 'https://unpkg.com/three-globe/example/img/earth-night.jpg';

const LS_NAZIONI = 'cb3_nazioni';
const LS_CITTA   = 'cb3_citta';
const LS_CACHE   = 'cb3_cache_citta';
const LS_CASA    = 'cb3_casa';
const LS_ORDINE  = 'cb3_visite_ordine';   // percorso: id in ordine di inserimento
const LS_DATA    = 'cb3_visite_data';     // percorso: id -> 'YYYY-MM-DD'
const LS_PERCORSO = 'cb3_percorso';       // vista Percorsi: tappe del viaggio

/* palette: colori ben distinti fra loro */
const COL = {
  nazioneBase: 'rgba(88,108,152,0.95)',   // grigio-blu: non visitata
  nazioneVisita: 'rgba(34,197,94,0.95)',  // verde: visitata
  nazioneSelez: 'rgba(34,211,238,0.95)',  // ciano: selezionata
  nazioneCasa: 'rgba(167,139,250,0.95)',  // viola: dove vivo
  nazioneCasaSel: 'rgba(196,181,253,0.98)',
  cittaVista: '#ff2d2d',                  // rosso vivo: città visitata
  cittaNo: '#000000',                     // nero: città non ancora visitata
  cittaCap: '#ffd166',                  // oro: capitale
  cittaCasa: '#c084fc',                   // viola vivo: città dove vivo
  cittaPercorso: '#f97316'                // arancio vivo: tappa del percorso itinerante
};

const stato = {
  features: [],
  featureByKey: new Map(),
  cittaById: new Map(),
  cittaPerNazione: new Map(),
  cacheCitta: {},
  visitateNazioni: new Set(),
  visitateCitta: new Set(),
  visiteOrdine: [],
  visiteData: {},
  percorsoTappe: [],   // vista Percorsi: tappe del viaggio {id,nome,lat,lon,key} in ordine
  casaNazione: null,   // key della nazione di residenza
  casaCitta: null,     // {id,nome,lat,lon} della città di residenza
  selezionata: null,
  modalita: 'mappa',   // 'mappa' | 'percorsi' (percorso itinerante)
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

/* data di oggi in formato locale YYYY-MM-DD (solo data, senza orario):
   usata per il timestamp delle visite nel percorso. */
function oggi() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
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
  try { localStorage.setItem(LS_ORDINE, JSON.stringify(stato.visiteOrdine)); } catch (e) {}
  try { localStorage.setItem(LS_DATA, JSON.stringify(stato.visiteData)); } catch (e) {}
  try { localStorage.setItem(LS_PERCORSO, JSON.stringify(stato.percorsoTappe)); } catch (e) {}
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
    stato.visiteOrdine = JSON.parse(localStorage.getItem(LS_ORDINE) || '[]');
    stato.visiteData = JSON.parse(localStorage.getItem(LS_DATA) || '{}');
    stato.percorsoTappe = JSON.parse(localStorage.getItem(LS_PERCORSO) || '[]');
    if (!Array.isArray(stato.percorsoTappe)) stato.percorsoTappe = [];
    /* per gli utenti che hanno già visitato città prima dell'introduzione del
       percorso: ricostruiamo l'ordine dal Set delle città visitate (senza data),
       così il percorso funziona anche per le visite passate. */
    if (!stato.visiteOrdine.length && stato.visitateCitta.size) {
      stato.visiteOrdine = [...stato.visitateCitta];
      try { localStorage.setItem(LS_ORDINE, JSON.stringify(stato.visiteOrdine)); } catch (e) {}
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

/* -
   microstati e nazioni molto piccole (Monaco, Vaticano, San Marino, Cipro...):
   area sferica minima -> quando tocchi diamo la priorita alla NAZIONE (per
   marcarla come visitata) invece che alla citta che la copre */
function eMicrostato(f) {
  try { return d3.geoArea(f) < 0.001; } catch (e) { return false; }
}

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

/* la città è una tappa del percorso attivo (vista Percorsi)? */
function eTappaPercorso(id) {
  if (stato.modalita !== 'percorsi') return false;
  for (const t of stato.percorsoTappe) if (t && t.id === id) return true;
  return false;
}

/* "accesa" = va evidenziata come visitata/tappa nella vista corrente */
function cittaAccesa(c) {
  if (stato.modalita === 'percorsi') return eTappaPercorso(c.id);
  return stato.visitateCitta.has(c.id);
}

function colorePunto(c) {
  if (eCasa(c.id)) return COL.cittaCasa;
  if (c.cap) return COL.cittaCap;
  if (stato.modalita === 'percorsi') return eTappaPercorso(c.id) ? COL.cittaPercorso : COL.cittaNo;
  return stato.visitateCitta.has(c.id) ? COL.cittaVista : COL.cittaNo;
}

function altPunto(c) {
  if (eCasa(c.id)) return 0.04;
  if (stato.modalita === 'percorsi') return eTappaPercorso(c.id) ? 0.035 : 0.008;
  if (stato.visitateCitta.has(c.id)) return 0.025;
  return 0.008;
}

function raggioPunto(c) {
  if (eCasa(c.id)) return 0.5;
  if (stato.modalita === 'percorsi') return eTappaPercorso(c.id) ? 0.3 : 0.07;
  if (stato.visitateCitta.has(c.id)) return 0.22;
  return 0.07;
}

function etichettaCitta(c) {
  const vis = cittaAccesa(c);
  const pref = eCasa(c.id) ? '🏠 ' : '';
  const col = eCasa(c.id) ? '#c084fc' : (vis ? (stato.modalita === 'percorsi' ? '#fdba74' : '#ff2d2d') : '#93a4c8');
  const statoTesto = stato.modalita === 'percorsi'
    ? (vis ? '✓ Tappa del percorso' : 'Tocca per aggiungere al percorso')
    : (vis ? '✓ Visitata' : 'Tocca per segnare');
  return `<div style="background:rgba(11,17,34,.92);padding:6px 10px;border-radius:8px;border:1px solid rgba(120,160,255,.35)">
        <b>${pref}${esc(c.nome)}</b>${c.pop ? ` · ${formattaPop(c.pop)}` : ''}<br>
        <span style="font-size:11px;color:${col}">
          ${eCasa(c.id) ? 'La tua città' : statoTesto}</span></div>`;
}

function initGlobo(feats) {
  stato.features = feats;

  /* ============ mappamondo 2D su canvas (velocissimo, niente WebGL)
     Stessa sensazione del 3D: trascina per ruotare, inerzia, zoom,
     click sulle nazioni e sulle città. Ma si apre in un attimo.
     (Niente rotazione automatica: si muove solo se lo muovi tu.)
     ============ */
  const el = document.getElementById('globeViz');
  el.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;touch-action:none;width:100%;height:100%';
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let W = innerWidth, H = innerHeight;
  /* su schermi grandi (PC ad alta risoluzione) riduciamo la risoluzione interna
     del canvas: il globo resta nitido ma gira molto più fluido */
  const dpr = Math.max(1,
    W * H > 3000000 ? 1.25 :
    W * H > 1200000 ? 1.5 :
    Math.min(window.devicePixelRatio || 1, 2));
  function ridimensiona() {
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }
  ridimensiona();
  addEventListener('resize', ridimensiona);

  /* Stato di vista: lon/lat del centro + fattore di zoom */
  const vista = { lon: 12, lat: 25, alt: 2.2 };
  lastAggLon = vista.lon; lastAggLat = vista.lat;
  const controlli = {
    autoRotate: false,           // il globo si muove SOLO se lo muovi tu
    autoRotateSpeed: 0,
    enableDamping: true,
    dampingFactor: 0.3,
    rotateSpeed: 0.72,
    zoomSpeed: 0.6
  };

  let poligoni = feats.slice();
  let punti = [];
  let etichette = [];

  /* projection ortografica (2D): ruota il "globo" piatto come quello 3D */
  const proj = d3.geoOrthographic();
  proj.clipAngle(90);
  /* IMPORTANTE: passare il contesto canvas, altrimenti geoPath genera una
     stringa SVG invece di disegnare sul canvas */
  const path = d3.geoPath(proj, ctx);

  function scalaAttuale() {
    const base = Math.min(W, H) / 2;
    return base * (2.2 / vista.alt);
  }

  function aggiornaProiezione() {
    proj.scale(scalaAttuale());
    proj.translate([W / 2, H / 2]);
    proj.rotate([-vista.lon, -vista.lat]);
  }

  /* ---------------- rendering ---------------- */
  const OCEANO = '#0e2a52';
  const OCEANO_IND = '#153a6b';

  function disegna() {
    aggiornaProiezione();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, scalaAttuale() * 1.18);
    grad.addColorStop(0, '#173a6b');
    grad.addColorStop(1, '#0a1b38');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    /* cerchio del globo (oceano) con leggero bordo luminoso */
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, scalaAttuale(), 0, Math.PI * 2);
    ctx.fillStyle = OCEANO;
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,160,255,0.6)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    /* graticolo sottile (solo da lontano: da vicino dà fastidio e pesa) */
    if (vista.alt > 0.6) {
      ctx.beginPath();
      path(d3.geoGraticule10());
      ctx.strokeStyle = 'rgba(130,170,255,0.08)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    /* paesi */
    for (const f of poligoni) {
      ctx.beginPath();
      path(f);
      ctx.fillStyle = coloreCap(f);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,220,255,0.45)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    /* città */
    disegnaPercorso();
    disegnaPunti();
    disegnaNomi();
  }

  function puntoSchermo(c) {
    /* nasconde i punti sul lato nascosto del globo (oltre il bordo a 90°):
       con la proiezione ortografica proj([lon,lat]) restituirebbe la posizione
       "attraverso" il globo, quindi qui controlliamo la distanza angolare dal
       centro della vista e scartiamo ciò che sta sul lato opposto */
    const dLon = (c.lon - vista.lon) * Math.PI / 180;
    const la = c.lat * Math.PI / 180;
    const lb = vista.lat * Math.PI / 180;
    const cosTheta = Math.sin(la) * Math.sin(lb) + Math.cos(la) * Math.cos(lb) * Math.cos(dLon);
    if (cosTheta < 0.02) return null;
    const p = proj([c.lon, c.lat]);
    if (!p) return null;
    return p;
  }

  function disegnaPunti() {
    /* MERGE visivo: quando tante piccole città cadono troppo vicine a schermo
       (tipico degli stati molto popolati), ne disegniamo solo la più importante,
       evitando un ammasso di pallini sovrapposti. Adatto la soglia allo zoom:
       da lontano fondiamo di più (pallini sparsi), vicino fondiamo meno. */
    const sogliaMerge = Math.max(10, Math.min(24, 16 * vista.alt));
    const passo = Math.max(3, sogliaMerge * 0.6);
    const grid = new Map();
    const key = (i, j) => i * 10000 + j;
    for (const c of punti) {
      const p = puntoSchermo(c);
      if (!p) continue;
      const cellaX = Math.floor(p[0] / passo), cellaY = Math.floor(p[1] / passo);
      let migliore = null, migliorePeso = -1;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const lista = grid.get(key(cellaX + i, cellaY + j));
          if (!lista) continue;
          for (const o of lista) {
            const d = Math.hypot(o.p[0] - p[0], o.p[1] - p[1]);
            if (d < sogliaMerge && o.peso > migliorePeso) { migliore = o; migliorePeso = o.peso; }
          }
        }
      }
      const casa = eCasa(c.id);
      const acc = cittaAccesa(c);
      const cap = !casa && !!c.cap;
      const peso = casa ? 4 : (cap ? 3 : (acc ? 2 : 1));
      if (migliore && migliore.peso >= peso) continue;   // un altro più importante lo copre
      if (migliore) grid.delete(key(Math.floor(migliore.p[0] / passo), Math.floor(migliore.p[1] / passo)));
      if (!grid.has(key(cellaX, cellaY))) grid.set(key(cellaX, cellaY), []);
      grid.get(key(cellaX, cellaY)).push({ p, peso });
      const r = casa ? 2.6 : (cap ? 2.0 : (acc ? 1.5 : 1.2));
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = colorePunto(c);
      ctx.fill();
      ctx.strokeStyle = cap ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = (acc || casa || cap) ? 1.1 : 0.8;
      ctx.stroke();
    }
  }

  function disegnaNomi() {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    /* Con nazione selezionata: disegno il nome di OGNI città (senza anti-accavallamento,
       l'utente le vuole vedere tutte). Vista globale: anti-accavallamento SEMPRE,
       così i nomi delle città piccole in stati popolati non si sovrappongono. */
    const usaCollision = !stato.selezionata;
    const occupati = [];
    const collida = (r) => occupati.some(o => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]);
    for (const e of etichette) {
      const p = puntoSchermo(e);
      if (!p) continue;
      const cap = e.cap && !e.casa;
      const fz = cap ? Math.round(scaleFont) + 2 : Math.round(scaleFont);
      ctx.font = '600 ' + fz + 'px system-ui';
      const larg = ctx.measureText(e.nome).width;
      const x0 = p[0] + 4, y0 = p[1] - 8, x1 = x0 + larg + 8, y1 = y0 + (cap ? 18 : 16);
      if (usaCollision && collida([x0, y0, x1, y1])) continue;
      occupati.push([x0, y0, x1, y1]);
      ctx.fillStyle = 'rgba(8,14,32,0.82)';
      roundRect(x0, y0, x1 - x0, y1 - y0, 3);
      ctx.fill();
      const accE = cittaAccesa(e);
      ctx.fillStyle = e.casa ? '#c084fc' : (cap ? '#ffd166' : (accE ? (stato.modalita === 'percorsi' ? '#fdba74' : '#ff6b6b') : '#5eead4'));
      ctx.fillText(e.nome, p[0] + 8, p[1]);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.closePath();
  }

  /* ---------------- percorso itinerante ---------------- */

  const SOGLIA_PERCORSO = 0.16;   /* vicinanza minima per far vedere il percorso (regione per regione) */

  function disegnaPercorso() {
    /* il percorso (linee dei viaggi) si vede SOLO nella vista Percorsi,
       e solo da vicino (regione per regione) */
    if (stato.modalita !== 'percorsi') return;
    if (vista.alt > SOGLIA_PERCORSO) return;
    const tappe = stato.percorsoTappe || [];
    if (tappe.length < 2) return;
    /* linea di percorso da tappa a tappa (nell'ordine in cui le segni),
       visibile e marcata, con frecce di direzione a metà di ogni segmento */
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(251,146,60,0.55)';
    ctx.lineWidth = 4;
    for (let i = 0; i < tappe.length - 1; i++) {
      const a = puntoSchermo(tappe[i]);
      const b = puntoSchermo(tappe[i + 1]);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    /* frecce di direzione a metà di ogni segmento (ben visibili) */
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.4;
    for (let i = 0; i < tappe.length - 1; i++) {
      const a = puntoSchermo(tappe[i]);
      const b = puntoSchermo(tappe[i + 1]);
      if (!a || !b) continue;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 10) continue;
      const ux = dx / len, uy = dy / len;
      const px = -uy, py = ux;
      ctx.beginPath();
      ctx.moveTo(mx + ux * 9, my + uy * 9);
      ctx.lineTo(mx + (-ux * 3 + px * 5), my + (-uy * 3 + py * 5));
      ctx.moveTo(mx + ux * 9, my + uy * 9);
      ctx.lineTo(mx + (-ux * 3 - px * 5), my + (-uy * 3 - py * 5));
      ctx.stroke();
    }
  }

  /* ---------------- interazione ---------------- */
  let trascinando = false;
  let ultimoX = 0, ultimoY = 0;
  let velX = 0, velY = 0;
  let lastTime = 0;
  let dita = new Map(); // touch: pointerId -> {x,y}
  let distanzaDita = 0;
  let altStartZoom = vista.alt;

  function proiettaInversa(x, y) {
    return proj.invert([x, y]);
  }

  function nazioneSotto(x, y) {
    const g = proiettaInversa(x, y);
    if (!g || isNaN(g[0]) || isNaN(g[1])) return null;
    for (const f of poligoni) {
      if (d3.geoContains(f, g)) return f;
    }
    return null;
  }

  function cittaSotto(x, y) {
    let miglior = null, miglioreD = 24;
    for (const c of punti) {
      const p = puntoSchermo(c);
      if (!p) continue;
      const dx = p[0] - x, dy = p[1] - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < miglioreD) { miglioreD = d; miglior = c; }
    }
    if (miglior) return miglior;
    /* toccando il NOME (disegnato accanto al pallino) si deve selezionare
       la città come tocchi il pallino: il box del nome è reso più "generoso"
       così è facile colpirli col dito (soprattutto a zoom profondo) */
    ctx.font = '500 ' + Math.round(scaleFont) + 'px system-ui';
    for (const e of etichette) {
      const p = puntoSchermo(e);
      if (!p) continue;
      const larg = ctx.measureText(e.nome).width;
      const x0 = p[0] + 2, y0 = p[1] - 12, largB = larg + 12, altB = e.cap ? 24 : 22;
      if (x >= x0 && x <= x0 + largB && y >= y0 && y <= y0 + altB) {
        const c = stato.cittaById.get(e.id);
        if (c) return c;
      }
    }
    return null;
  }

  function pointerGiù(e) {
    dita.set(e.pointerId, { x: e.clientX, y: e.clientY });
    velX = 0; velY = 0;
    if (dita.size === 1) {
      trascinando = true;
      ultimoX = e.clientX; ultimoY = e.clientY;
      velX = 0; velY = 0; lastTime = performance.now();
    } else if (dita.size === 2) {
      trascinando = false;
      const [a, b] = [...dita.values()];
      distanzaDita = Math.hypot(a.x - b.x, a.y - b.y);
      altStartZoom = vista.alt;
    }
    canvas.setPointerCapture(e.pointerId);
  }

  function pointerMovi(e) {
    if (dita.has(e.pointerId)) dita.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (dita.size === 1 && trascinando) {
      /* se il tocco era PARTITO su un pallino/nome e il dito non ha ancora
         superato la soglia di "trascinamento", NON ruotiamo il globo:
         un micro-movimento durante il tap non deve spostare la vista
         (altrimenti il globo sembra "riallontanarsi" da solo). */
      if (toccoSuBersaglio && !spostato) return;
      const dx = e.clientX - ultimoX;
      const dy = e.clientY - ultimoY;
      /* velocità angolare: un pixel = altrettanti gradi del globo (scala) */
      const gradiPerPx = 360 / (scalaAttuale() * Math.PI * 2);
      /* a zoom molto profondo la scala è enorme: attenua un po' la rotazione
         ma senza renderla troppo lenta (il tap su bersaglio già non ruota) */
      const attenuazione = Math.max(0.65, Math.min(1, Math.sqrt(vista.alt / 0.8)));
      const rot = gradiPerPx * controlli.rotateSpeed * attenuazione;
      vista.lon -= dx * rot;
      vista.lat = Math.max(-89.99, Math.min(89.99, vista.lat + dy * rot));
      /* normalizza lon */
      vista.lon = ((vista.lon % 360) + 360) % 360;
      /* inerzia */
      const ora = performance.now();
      const dt = Math.max(1, ora - lastTime);
      velX = dx * rot * (dt / 16);
      velY = dy * rot * (dt / 16);
      lastTime = ora;
      ultimoX = e.clientX; ultimoY = e.clientY;
    } else if (dita.size === 2) {
      const [a, b] = [...dita.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (distanzaDita > 0 && d > 0) {
        const f = d / distanzaDita;
        /* zoom proporzionale ma non troppo sensibile: entra in modo controllato */
        vista.alt = Math.max(MIN_ALT, Math.min(MAX_ALT, altStartZoom / Math.pow(f, 1.2)));
      }
    }
  }

  function pointerSu(e) {
    dita.delete(e.pointerId);
    if (dita.size === 0) {
      trascinando = false;
      controlli.autoRotate = false;
      /* il globo si FERMA subito quando tolgo il dito: niente inerzia
         residua che continua a ruotare da sola */
      velX = 0; velY = 0;
    }
  }

  function tap() {
    const click = ultimoEventoClick;
    if (!click) return;
    const c = cittaSotto(click.x, click.y);
    if (c) {
      if (stato.modalita === 'percorsi') toggleTappa(c);
      else toggleCitta(c.id);
      ultimoEventoClick = null;
      return;
    }
    const f = nazioneSotto(click.x, click.y);
    if (f) selezionaNazione(f);
    else deseleziona();
    ultimoEventoClick = null;
  }

  let downX = 0, downY = 0, downTime = 0, spostato = false, toccoSuBersaglio = false;

  canvas.addEventListener('pointerdown', e => {
    downX = e.clientX; downY = e.clientY; downTime = Date.now(); spostato = false;
    /* se il tocco parte SU un pallino o un nome, lo trattiamo come "selezione":
       NIENTE rotazione/pan per piccoli movimenti (altrimenti si schizza via) */
    toccoSuBersaglio = dita.size === 0 && !!cittaSotto(e.clientX, e.clientY);
    pointerGiù(e);
  });
  canvas.addEventListener('pointermove', e => {
    /* soglia di trascinamento: più alta quando il tocco era su un bersaglio,
       così un tocco non perfettamente fermo non ruota il globo */
    const soglia = toccoSuBersaglio ? 26 : 12;
    if (dita.has(e.pointerId) && Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > soglia) spostato = true;
    pointerMovi(e);
  });
  canvas.addEventListener('pointerup', e => {
    const eraTap = !spostato && dita.size <= 1 && (Date.now() - downTime) < 400;
    pointerSu(e);
    if (eraTap && dita.size === 0) {
      /* solo se tocco dentro il "disco" del globo */
      const raggio = scalaAttuale();
      const dx = e.clientX - W / 2, dy = e.clientY - H / 2;
      if (Math.hypot(dx, dy) <= raggio) {
        const f0 = nazioneSotto(e.clientX, e.clientY);
        /* microstato: il tocco apre la NAZIONE (per marcarla), non la citta */
        if (f0 && eMicrostato(f0)) { selezionaNazione(f0); return; }
        const c = cittaSotto(e.clientX, e.clientY);
        if (c) {
          try {
            if (stato.modalita === 'percorsi') toggleTappa(c);
            else toggleCitta(c.id);
          } catch (err) {
            toast('⚠️ ERRORE: ' + err.message + ' | stack: ' + (err.stack || '').split('\n')[0], 6000);
          }
          return;
        }
        if (f0) selezionaNazione(f0);
        else deseleziona();
      }
    }
  });
  canvas.addEventListener('pointercancel', pointerSu);
  addEventListener('wheel', e => {
    if (e.target !== canvas) return;
    e.preventDefault();
    /* normalizza il delta in base alla modalità (pixel / righe / pagine):
       molti mouse Windows riportano "righe" (deltaMode=1) con delta piccoli,
       che senza questa correzione rendevano lo zoom quasi nullo */
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;      // linee -> ~pixel
    else if (e.deltaMode === 2) delta *= 120; // pagine -> grande
    /* zoom "governabile": ogni notch della rotella fa un passo moderato e il
       delta viene capato, così i mouse velocissimi non saltano tutto */
    const passo = Math.max(-120, Math.min(120, (delta || 0)));
    const f = Math.pow(0.9985, passo);
    vista.alt = Math.max(MIN_ALT, Math.min(MAX_ALT, vista.alt * f));
    daRidisegnare = true;
  }, { passive: false });

  const MIN_ALT = 0.004;
  const MAX_ALT = 2.7;
  const SOGLIA_NOMI = 0.55;
  const scaleFont = Math.max(9, Math.min(13, scalaAttuale() * 0.018));

  /* ---------------- ciclo di rendering (rotazione + inerzia) ---------------- */
  let ultimoFrame = performance.now();
  let inMovimento = false;
  let daRidisegnare = false;
  function ciclo(ora) {
    const dt = Math.min(50, ora - ultimoFrame);
    ultimoFrame = ora;
    inMovimento = false;
    /* inerzia dopo il trascinamento: si ferma da solo */
    if (controlli.enableDamping && !trascinando && dita.size === 0 && (Math.abs(velX) > 0.001 || Math.abs(velY) > 0.001)) {
      vista.lon = ((vista.lon - velX) % 360 + 360) % 360;
      vista.lat = Math.max(-89.99, Math.min(89.99, vista.lat + velY));
      velX *= 1 - controlli.dampingFactor;
      velY *= 1 - controlli.dampingFactor;
      inMovimento = true;
    }
    aggiornaEtichetteZoometta();
    /* Quando il globo NON sta trascinando (o è in inerzia) e il centro si è
       spostato in una nuova zona, ricalcoliamo i punti per quel centro:
       così le città seguono la zona guardata e non restano zone vuote
       finché non si rifà lo zoom. */
    if (!trascinando && dita.size === 0 &&
        (Math.abs(vista.lon - lastAggLon) + Math.abs(vista.lat - lastAggLat)) > 1.5) {
      lastAggLon = vista.lon; lastAggLat = vista.lat;
      aggiornaPunti();
    }
    /* disegniamo solo se serve (evita consumo inutile quando il globo è fermo) */
    if (inMovimento || trascinando || dita.size > 0 || daRidisegnare) {
      disegna();
      daRidisegnare = false;
    }
    requestAnimationFrame(ciclo);
  }
  requestAnimationFrame(ciclo);
  disegna();   // disegna subito il mappamondo all'avvio

  /* ---------------- API pubbliche (compatibili con il vecchio globo) ---------------- */
  return {
    pointOfView(pov, ms) {
      if (!pov) return Object.assign({}, vista);
      const tgt = Object.assign({}, pov);
      if (ms && ms > 0) {
        const from = Object.assign({}, vista);
        const t0 = performance.now();
        const passo = (ora) => {
          const t = Math.min(1, (ora - t0) / ms);
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          vista.lon = from.lon + (tgt.lng - from.lon) * ease;
          vista.lat = from.lat + (tgt.lat - from.lat) * ease;
          vista.alt = from.alt + (tgt.altitude - from.alt) * ease;
          daRidisegnare = true;
          if (t < 1) requestAnimationFrame(passo);
        };
        requestAnimationFrame(passo);
      } else {
        vista.lon = tgt.lng != null ? tgt.lng : vista.lon;
        vista.lat = tgt.lat != null ? tgt.lat : vista.lat;
        vista.alt = tgt.altitude != null ? tgt.altitude : vista.alt;
      }
      setTimeout(() => disegna(), 0);
      return this;
    },
    controls() {
      return {
        get autoRotate() { return controlli.autoRotate; },
        set autoRotate(v) { controlli.autoRotate = v; },
        enableDamping: true,
        dampingFactor: controlli.dampingFactor,
        rotateSpeed: controlli.rotateSpeed,
        zoomSpeed: controlli.zoomSpeed,
        minDistance: MIN_ALT,
        maxDistance: MAX_ALT,
        addEventListener: () => {},
        on: () => this
      };
    },
    polygonsData(d) { poligoni = d || []; disegna(); return this; },
    pointsData(d) { punti = d || []; disegna(); return this; },
    labelsData(d) { etichette = d || []; disegna(); return this; },
    width(w) { if (w) { W = w; ridimensiona(); } return W; },
    height(h) { if (h) { H = h; ridimensiona(); } return H; },
    debugCounts() { return { punti: punti.length, etichette: etichette.length }; },
    currentPoints() { return punti.slice(); },
    aggiorna() { daRidisegnare = true; disegna(); },
    /* città più vicine al centro della vista corrente, a prescindere dalla
       nazione: così anche una nazione grande (es. Russia) con centro fuori
       schermo NON risulta vuota — le sue città entrano comunque nel pool.
       Il pool viene dalle ~15000 città più popolose (mondoCitta), ordinate
       per vicinanza, senza riscanare le ~79k città ad ogni frame. */
    cittaPerZoom() {
      const pov = this.pointOfView();
      const cLon = pov ? pov.lon : 0;
      const cLat = pov ? pov.lat : 0;
      const alt = pov && pov.altitude != null ? pov.altitude : 2.2;
      /* cache: riutilizza il risultato finché non ci si sposta o si cambia
         reggime di zoom, evitando di riordinare 55k città ad ogni movimento */
      if (this._cittaCache &&
          Math.abs(this._cittaCache.lon - cLon) < 1.5 &&
          Math.abs(this._cittaCache.lat - cLat) < 1.5 &&
          this._cittaCache.alt === (alt > 0.4)) {
        return this._cittaCache.lista;
      }
      const out = [];
      for (const c of mondoCitta) {
        const dLon = Math.min(Math.abs(c.lon - cLon), 360 - Math.abs(c.lon - cLon));
        const dLat = c.lat - cLat;
        out.push({ c, d: dLat * dLat + dLon * dLon, pop: c.pop || 0 });
      }
      /* Da lontano e a vista continentale/regionale: ordino per popolazione -> le
         città più grandi di TUTTO il globo, così nessuna regione/periferia resta
         vuota (ogni continente ha le sue grandi). Da molto vicino: ordino per
         vicinanza al centro -> la zona guardata si riempie fino alle piccole. */
      if (alt > 0.4) out.sort((a, b) => b.pop - a.pop);
      else out.sort((a, b) => a.d - b.d);
      const lista = out.map(o => o.c).slice(0, 6000);
      this._cittaCache = { lon: cLon, lat: cLat, alt: alt > 0.4, lista };
      return lista;
    }
  };
}

let globo2d = null;
let ultimaSogliaZoom = null;
let ultimaSogliaCitta = null;
/* per ricalcolare i punti quando il globo si ferma su una nuova zona */
let lastAggLon = null, lastAggLat = null;
/* pool mondiale di città (limitato alle più popolose) per la ricerca veloce
   nelle vicinanze della vista corrente, senza riscanare tutte le 79k città */
let mondoCitta = [];

function liveAltitudine() {
  if (!globo2d) return null;
  const pov = globo2d.pointOfView();
  return pov ? pov.alt : null;
}

/* distanza (alt) oltre la quale NON compaiono le città da selezionare:
   "zoom molto vicino": le città della vista globale appaiono solo quando
   ti avvicini abbastanza, così niente caos da lontano. L'utente regola. */
const GATE_CITTA = 0.6;

/* le città visitate + la casa compaiono SOLO molto vicini (zoom profondo):
   sotto questa altitudine (0.10). Prima non si vedono. L'utente l'ha scelto. */
const GATE_VISITATE = 0.10;

/* soglia di popolazione per la comparsa progressiva delle città:
   FONZIONE CONTINUA (niente scaglioni): piu ci si avvicina (alt bassa),
   piu la soglia scende e emergono sempre piu città, in modo graduale,
   senza "salti" a blocchi. La soglia viene stampata su una curva logaritmica
   cosi le piccole città emergono vicino e le grandi da lontano. */
function sogliaPopDaAlt(alt) {
  if (alt == null) return 900000;
  const al = Math.max(0.004, Math.min(2.7, alt));
  /* transizione GRADUALE su tutta la scala di zoom: da lontano (alt alta)
     solo le metropoli (soglia alta), avvicinandosi scende e emergono via via
     le città più piccole. Nessun "tutto insieme". */
  return Math.round(900000 * Math.pow(al / 2.7, 1.4));
}

function scaglioneDi() {}

/* simbolo per distinguere "nazioni aggiornate" vs "città aggiornate" */
const NG_CITTA = '__citta__';

function aggiornaEtichetteZoometta() {
  const alt = liveAltitudine();
  if (alt == null) return;
  /* soglia CONTINUA: la soglia di popolazione cambia in modo graduale con
     lo zoom, senza salti a blocchi. Debounce: ricalcoliamo i punti solo
     quando la soglia cambia di almeno il 10%, per evitare flicker ma
     mantenere una comparsa fluida delle città man mano che ci si avvicina. */
  const nuovo = sogliaPopDaAlt(alt);
  if (ultimaSogliaCitta === null || Math.abs(nuovo - ultimaSogliaCitta) / Math.max(1, ultimaSogliaCitta) > 0.10) {
    ultimaSogliaCitta = nuovo;
    aggiornaPunti(NG_CITTA);
  }
}

function aggiornaPoligoni() {
  if (globo2d) globo2d.polygonsData(stato.features.slice());
}

/* ---------------- selezione nazione ---------------- */

function selezionaNazione(f) {
  stato.tsClick = Date.now();
  stato.selezionata = f.key;
  stato.query = '';
  aggiornaPoligoni();
  aggiornaPunti();   // aggiorna subito le città della nazione appena scelta
  renderPannello();
  const c = centroide(f);
  if (globo2d) {
    const ctl = globo2d.controls();
    ctl.autoRotate = false;
    globo2d.pointOfView({ lat: c.lat, lng: c.lng, altitude: 0.4 }, 900);
  }
}

function deseleziona() {
  if (!stato.selezionata) return;
  if (Date.now() - (stato.tsClick || 0) < 400) return; // ignora il click del globo subito dopo la selezione
  stato.selezionata = null;
  aggiornaPoligoni();
  aggiornaPunti();
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
    /* cache VERSIONATA per le citta: ad ogni versione dell'app scarichiamo
       l'ultimo database (alimentato anche dal service worker network-first).
       Se non c'e' rete, si riusa la cache piu recente gia' salvata. */
    const cache = await caches.open('cb-citta-' + APP_VER);
    let gj = null;
    try {
      const ris = await cache.match(URL_CITTA);
      if (ris) gj = await ris.json();
      else {
        gj = await fetchJson(URL_CITTA);
        try { cache.put(URL_CITTA, new Response(JSON.stringify(gj), { headers: { 'Content-Type': 'application/json' } })); } catch (e) {}
      }
    } catch (e) {}
    if (!gj) {
      gj = await fetchJson(URL_CITTA);
      try { cache.put(URL_CITTA, new Response(JSON.stringify(gj), { headers: { 'Content-Type': 'application/json' } })); } catch (e) {}
    }
    /* costruiamo le città; anche se il dataset è stranamente vuoto,
       non deve bloccare il disegno dei punti (visitate + casa) */
    try { costruisciCittaDa(gj); } catch (e) {}
    aggiornaPunti();
  } catch (e) {
    if (!stato.pronte) toast('⚠️ Impossibile scaricare le città (serve internet la prima volta)', 4000);
    /* anche se il caricamento delle città fallisce, mostriamo comunque
       le città visitate e la casa già salvate sul dispositivo */
    aggiornaPunti();
  }
}

function costruisciCittaDa(gj) {
  /* Raggruppamento in METROPOLI: nei dataset "world cities" ogni comune/
     arrondissement (es. i quartieri di Parigi, i comuni della cintura di Milano)
     e' una voce separata -> un'inutile nuvola di nomi sovrapposti sulla stessa
     area. Raggruppiamo per prossimita': le voci vicine a una citta piu' popolosa
     vengono considerate parte della stessa metropoli e NON mostrate come pal-
     lini/nomi propri (resta solo il nome della metropoli, la piu' popolosa). */
  const RAGGIO_METRO_KM = 8;

  /* tutte le voci dal dataset, pronte ma non ancora "accettate" */
  const voci = [];
  for (const ft of gj.features) {
    const p = ft.properties;
    const key = trovaKeyCitta(p);
    if (!key) continue;
    voci.push({
      id: hashId(p.name, p.latitude, p.longitude),
      nome: p.name || p.nameascii || '?',
      lat: Number(p.latitude),
      lon: Number(p.longitude),
      pop: Number(p.pop_max) || 0,
      cap: Number(p.adm0cap) === 1,
      key
    });
  }

  /* le elaboriamo dalla piu' popolosa: la prima di una zona diventa la METRO-
     POLI, le piu' piccole entro il raggio sono "quartieri" e vengono scartate */
  const byPop = voci.slice().sort((a, b) => (b.pop || 0) - (a.pop || 0));
  const metropoli = [];
  const assorbito = new Map();        // idQuartiere -> metropoli che lo contiene
  const cosLat = Math.cos((voci[0] ? voci[0].lat : 0) * Math.PI / 180);
  const dLatMax = RAGGIO_METRO_KM / 111;
  const dLonMax = dLatMax / Math.max(0.3, Math.abs(cosLat));
  /* griglia per una ricerca veloce del vicino (evita O(n^k) su 79k voci) */
  const cella = (mlat, mlon) => Math.floor(mlat / dLatMax) * 10000 + Math.floor(mlon / dLonMax);
  const griglia = new Map();          // cella -> [metropoli]
  for (const c of byPop) {
    let dentro = false;
    const clat = Math.floor(c.lat / dLatMax), clon = Math.floor(c.lon / dLonMax);
    /* controlla le 9 celle adiacenti */
    for (let i = -1; i <= 1 && !dentro; i++) {
      for (let j = -1; j <= 1 && !dentro; j++) {
        const lista = griglia.get((clat + i) * 10000 + (clon + j));
        if (!lista) continue;
        for (const m of lista) {
          const dLat = Math.abs(c.lat - m.lat);
          const dLon = (c.lon - m.lon) * cosLat;
          if (Math.hypot(dLat, dLon) * 111 <= RAGGIO_METRO_KM) {
            dentro = true; assorbito.set(c.id, m.id); break;
          }
        }
      }
    }
    if (!dentro) {
      metropoli.push(c);
      const k = clat * 10000 + clon;
      if (!griglia.has(k)) griglia.set(k, []);
      griglia.get(k).push(c);
    }
  }

  /* ora salviamo solo le metropoli come punti/citta' */
  for (const c of metropoli) {
    if (stato.cittaById.has(c.id)) continue;
    stato.cittaById.set(c.id, c);
    if (!stato.cittaPerNazione.has(c.key)) stato.cittaPerNazione.set(c.key, []);
    stato.cittaPerNazione.get(c.key).push(c);
  }
  stato.pronte = true;

  /* visite e casa gia' salvate: se si riferivano a un "quartiere" ora assorbito,
     le reindirizziamo alla metropoli, cosi' restano visibili col nome giusto */
  if (assorbito.size) {
    const rimappa = (id) => assorbito.get(id) || id;
    if (stato.casaCitta) stato.casaCitta.id = rimappa(stato.casaCitta.id);
    if (stato.visitateCitta) {
      const nuovo = new Set();
      for (const id of stato.visitateCitta) nuovo.add(rimappa(id));
      stato.visitateCitta = nuovo;
    }
  }
  /* pool mondiale: TUTTE le città (dopo la fusione in metropoli), così anche
     le piccole (es. Porto Cesareo) compaiono a zoom profondo. Nessun tetto:
     si riduce con la soglia di popolazione negli scaglioni. */
  mondoCitta = [...stato.cittaById.values()]
    .filter(c => (c.pop || 0) >= 800)
    .sort((a, b) => (b.pop || 0) - (a.pop || 0));
  if (stato.selezionata) renderPannello();
  else aggiornaPunti();
}

/* restituisce la nazione che sta al centro della vista corrente */
function nazioneAlCentro() {
  const pov = globo2d ? globo2d.pointOfView() : null;
  if (!pov) return null;
  const pt = [pov.lon, pov.lat];
  for (const f of stato.features) {
    if (f && f.geometry && typeof d3 !== 'undefined' && d3.geoContains && d3.geoContains(f, pt)) {
      return f.key;
    }
  }
  return null;
}

function puntiVisibili() {
  const mappa = new Map();
  const push = (c) => { if (c && !mappa.has(c.id)) mappa.set(c.id, Object.assign({}, c)); };
  const alt = liveAltitudine();
  /* se una nazione e selezionata mostriamo TUTTE le sue citta (toccabili subito).
     Nessuna soglia di popolazione: appaiono tutti i pallini della nazione,
     così anche le più piccole sono visibili e toccabili. */
  if (stato.selezionata) {
    const lista = (stato.cittaPerNazione.get(stato.selezionata) || []).slice()
      .sort((a, b) => (b.cap ? 1 : 0) - (a.cap ? 1 : 0) || (b.pop || 0) - (a.pop || 0))
      .slice(0, 4000);
    lista.forEach(c => push(c));
    return Array.from(mappa.values());
  }

  /* Nella vista Percorsi le TAPPE del percorso attivo compaiono SEMPRE
     (è il contenuto della vista): le aggiungiamo al visible pool senza
     soglia di zoom, così le tocchi e le rivedi subito. */
  if (stato.modalita === 'percorsi') {
    for (const t of stato.percorsoTappe) {
      push(stato.cittaById.get(t.id) || stato.cacheCitta[t.id] ||
           { id: t.id, nome: t.nome, lat: t.lat, lon: t.lon, pop: 0, key: t.key });
    }
    if (stato.casaCitta) {
      push({ id: stato.casaCitta.id, nome: stato.casaCitta.nome, lat: stato.casaCitta.lat, lon: stato.casaCitta.lon, pop: 0, casa: true });
    }
  }

  /* citta visitate + casa (solo vista Mappa): NON sempre visibili (l'utente
     non li vuole sempre). Compaiono avvicinandosi, sotto GATE_VISITATE. */
  if (stato.modalita !== 'percorsi' && (stato.visitateCitta.size || stato.casaCitta)) {
    if (alt != null && alt < GATE_VISITATE) {
      for (const id of stato.visitateCitta) {
        push(stato.cittaById.get(id) || stato.cacheCitta[id]);
      }
      if (stato.casaCitta) {
        push({ id: stato.casaCitta.id, nome: stato.casaCitta.nome, lat: stato.casaCitta.lat, lon: stato.casaCitta.lon, pop: 0, casa: true });
      }
    }
  }

  /* NESSUNA nazione selezionata, vista globale:
     i pallini delle città compaiono SOLO a zoom molto vicino (sotto GATE_CITTA),
     e via via emergono sempre più città (soglia di popolazione CONTINUA, che
     scende con lo zoom in modo graduale). Ogni pallino avrà il suo nome. */
  if (alt != null && alt >= GATE_CITTA) return Array.from(mappa.values());

  const soglia = sogliaPopDaAlt(alt);     // continua, scende con lo zoom
  /* cap totale, graduale: a zoom massimo pochi pallini centrali (nomi
     leggibili), poi cresce fino a un massimo avvicinandosi, senza salti */
  const capTot = Math.max(150, Math.round(4500 * Math.min(1, Math.pow(alt / 0.08, 1.4))));

  const daMostrare = (globo2d ? globo2d.cittaPerZoom() : [])
    .filter(c => c && (c.pop || 0) >= soglia)
    .sort((a, b) => (b.cap ? 1 : 0) - (a.cap ? 1 : 0) || (b.pop || 0) - (a.pop || 0))
    .slice(0, capTot);
  daMostrare.forEach(c => push(c));

  /* la nazione centrale in primo piano: TUTTE le sue città sopra la soglia,
     per riempire la zona che stai guardando e non lasciare buchi. Solo a zoom
     abbastanza vicino (alt < 0.35): a zoom medio i buchi si colmano qui. */
  if (alt < 0.35) {
    const centro = nazioneAlCentro();
    if (centro) {
      (stato.cittaPerNazione.get(centro) || [])
        .filter(c => (c.pop || 0) >= soglia)
        .sort((a, b) => (b.cap ? 1 : 0) - (a.cap ? 1 : 0) || (b.pop || 0) - (a.pop || 0))
        .forEach(c => push(c));
    }
  }

  return Array.from(mappa.values());
}

/* nomi delle città: COMPAIONO INSIEME AI PALLINI. Ogni pallino visibile ha
   il suo nome (le etichette derivano dagli stessi punti mostrati), quindi
   se vedi un pallino vedi il nome, e non ci sono nomi senza pallino. */
function etichetteVisibili() {
  /* NOMI DERIVATI DAGLI STESSI PALLINI (currentPoints): ogni pallino mostrato
   ha sempre il suo nome. I pallini sono già filtrati (zoom, soglia pop,
   nazione selezionata): quindi anche i nomi seguono e compaiono SOLO
   quando compaiono i pallini (zoom vicino), mai da lontano. */
  if (!globo2d) return [];
  const attuali = globo2d.currentPoints() || [];
  const elenco = [];
  /* in modalità percorsi le etichette seguono le TAPPE del percorso (non le
     visite della mappa): così i nomi delle tappe compaiono in evidenza */
  let viste;
  if (stato.modalita === 'percorsi') {
    viste = new Set();
    for (const t of stato.percorsoTappe) if (t && t.id) viste.add(t.id);
  } else {
    viste = new Set(stato.visitateCitta);
  }
  const ordinate = attuali.slice()
    .sort((a, b) =>
      ((b.casa ? 1 : 0) - (a.casa ? 1 : 0)) ||
      ((b.cap ? 1 : 0) - (a.cap ? 1 : 0)) ||
      ((viste.has(b.id) ? 1 : 0) - (viste.has(a.id) ? 1 : 0)) ||
      ((b.pop || 0) - (a.pop || 0)));
  for (const c of ordinate) {
    const casa = !!(stato.casaCitta && c && c.id === stato.casaCitta.id);
    elenco.push({
      id: c.id, nome: c.nome, lat: c.lat, lon: c.lon,
      alt: altPunto(c) + 0.01,
      casa, vis: viste.has(c.id), cap: !!c.cap
    });
  }
  return elenco;
}

function aggiornaPunti() {
  if (!globo2d) return;
  try {
    globo2d.pointsData(puntiVisibili());
    globo2d.labelsData(etichetteVisibili());
  } catch (e) {}
  aggiornaHUD();
}

/* vista Percorsi: aggiunge/rimuove una tappa dal percorso attivo.
   Le tappe vivono in stato.percorsoTappe (dataset separato dalla mappa),
   così le due viste hanno vite indipendenti. */
function toggleTappa(c) {
  const esistente = stato.percorsoTappe.some(t => t && t.id === c.id);
  if (esistente) {
    stato.percorsoTappe = stato.percorsoTappe.filter(t => t.id !== c.id);
    toast(`Percorso: rimosso "${c.nome}"`);
  } else {
    const tappa = {
      id: c.id, nome: c.nome, lat: c.lat, lon: c.lon, key: c.key
    };
    stato.percorsoTappe.push(tappa);
    toast(`Percorso: + "${c.nome}" (tappa ${stato.percorsoTappe.length})`);
  }
  salva();
  aggiornaPunti();
  renderListaCitta();
  if (globo2d) globo2d.aggiorna();
}

function vistaAttualeAlt() {
  if (globo2d) { const p = globo2d.pointOfView(); if (p && p.altitude != null) return p.altitude; }
  return 0.1;
}

function toggleCitta(id, centra) {
  const eraVisitata = stato.visitateCitta.has(id);
  if (eraVisitata) {
    stato.visitateCitta.delete(id);
    const i = stato.visiteOrdine.indexOf(id);
    if (i >= 0) stato.visiteOrdine.splice(i, 1);
    delete stato.visiteData[id];
  } else {
    stato.visitateCitta.add(id);
    stato.visiteOrdine.push(id);
    stato.visiteData[id] = oggi();
    const c = stato.cittaById.get(id);
    if (c) {
      stato.cacheCitta[id] = { id, nome: c.nome, lat: c.lat, lon: c.lon, pop: c.pop, key: c.key };
      salvaCache();
    }
  }
  salva();
  aggiornaStatistiche();
  aggiornaPunti();
  aggiornaRigaCitta(id);
  aggiornaContatoreCitta();
  /* scelta dalla lista: mantengo l'immagine sul punto (zoom stretto),
     invece di far riallontanare il globo */
  if (centra && !eraVisitata) {
    const c = stato.cittaById.get(id) || stato.cacheCitta[id];
    if (c && globo2d) globo2d.pointOfView({ lat: c.lat, lng: c.lon, altitude: 0.05 }, 800);
  }
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
  const inPercorsi = stato.modalita === 'percorsi';

  p.innerHTML = `
    <div class="p-head">
      ${flag}
      <h2>${esc(nomeNazione(f))}</h2>
      <button class="btn" id="p-chiudi">✕</button>
    </div>
    ${inPercorsi ? '' : `<button class="btn-visita ${visitata ? 'attiva' : ''}" id="p-toggle"></button>`}
    <input class="p-ricerca" id="p-ricerca" placeholder="Cerca città…" autocomplete="off" value="${esc(stato.query)}">
    <div class="p-sub"><span>${inPercorsi ? 'Tappe del percorso — tocca le città per aggiungerle' : 'Città visitate'}</span><b id="p-count">—</b></div>
    <div class="p-lista" id="p-lista"></div>`;

  document.getElementById('p-chiudi').addEventListener('click', deseleziona);
  const btToggle = document.getElementById('p-toggle');
  if (btToggle) btToggle.addEventListener('click', toggleNazione);
  document.getElementById('p-ricerca').addEventListener('input', e => {
    stato.query = e.target.value;
    renderListaCitta();
  });

  if (btToggle) aggiornaPulsanteVisita();
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
    .slice().sort((a, b) => (b.pop || 0) - (a.pop || 0));
  /* omonimi nella stessa nazione (es. molte "Springfield"): tieni solo la piu popolosa,
     cosi la lista non si ripete */
  const visti = new Set();
  const uniche = tutte.filter(c => {
    const k = norma(c.nome || '');
    if (!k || visti.has(k)) return false;
    visti.add(k);
    return true;
  });
  const q = norma(stato.query);
  const filtrata = q ? uniche.filter(c => norma(c.nome).includes(q)) : uniche;
  return { filtrata, totale: uniche.length };
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
  stato.visiteOrdine.push(id);
  stato.visiteData[id] = oggi();
  stato.cacheCitta[id] = { id, nome: c.nome, lat: c.lat, lon: c.lon, pop: 0 };
  /* in modalità Percorsi la città aggiunta diventa anche una TAPPA del percorso */
  if (stato.modalita === 'percorsi' && !stato.percorsoTappe.some(t => t.id === id)) {
    stato.percorsoTappe.push({ id: c.id, nome: c.nome, lat: c.lat, lon: c.lon, key: c.key });
  }
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

/* trova le coordinate reali di una città (gratis, via Open-Meteo) e sposta il punto */
async function geoCercaCitta(nome, id) {
  const f = stato.featureByKey.get(stato.selezionata);
  const countryCode = (f && f.meta && f.meta.a2) || '';
  const q = encodeURIComponent(nome);

  /* 1° tentativo: col filtro della nazione (match corretto) */
  let trov = null;
  if (countryCode) {
    trov = await geoCerca(q, 10);
    trov = (trov || []).find(r => (r.country_code || r.countryCode) === countryCode) || null;
  }
  /* 2° tentativo: senza filtro (fallback: abbinami solo il primo risultato) */
  if (!trov) {
    const lista = await geoCerca(q, 5);
    trov = (lista && lista[0]) || null;
  }
  if (!trov) {
    toast('⚠️ Non ho trovato le coordinate esatte: la città è al centro della nazione. Riprova a scriverla meglio.', 4500);
    return;
  }
  const c = stato.cittaById.get(id);
  if (!c) return;
  c.lat = trov.latitude;
  c.lon = trov.longitude;
  if (trov.name && trov.name.toLowerCase() !== c.nome.toLowerCase()) c.nome = trov.name;
  stato.cacheCitta[id] = { id, nome: c.nome, lat: c.lat, lon: c.lon, pop: c.pop };
  salva();
  salvaCache();
  aggiornaPunti();
  toast(`📌 "${c.nome}" posizionata sulle coordinate reali (${c.lat.toFixed(2)}, ${c.lon.toFixed(2)})`);
}

async function geoCerca(q, count) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=${count}&language=it&format=json`;
    const ris = await fetch(url);
    if (!ris.ok) return null;
    const dati = await ris.json();
    return (dati && dati.results) || null;
  } catch (e) { return null; }
}

function renderListaCitta() {
  const el = document.getElementById('p-lista');
  if (!el || !stato.selezionata) return;
  const { filtrata, totale } = listaFiltrata();
  const inPercorsi = stato.modalita === 'percorsi';

  if (!stato.pronte) {
    el.innerHTML = '<div class="vuoto">⏳ Elenco città in caricamento…</div>';
    return;
  }

  /* In modalità Percorsi la lista segue l'ORDINE del percorso (le tappe della
     nazione prima, in ordine di viaggio, poi le altre): così spostare una
     tappa con le frecce riordina subito anche l'elenco. */
  const posTappa = new Map();
  if (inPercorsi) {
    stato.percorsoTappe.forEach((t, i) => posTappa.set(t.id, i));
    filtrata.sort((a, b) => {
      const ta = posTappa.has(a.id), tb = posTappa.has(b.id);
      if (ta !== tb) return ta ? -1 : 1;
      if (ta) return posTappa.get(a.id) - posTappa.get(b.id);
      return (b.pop || 0) - (a.pop || 0);
    });
  }

  let html = '';
  if (!filtrata.length) {
    html += `<div class="vuoto">${totale ? 'Nessuna città trovata' : 'Nessuna città in elenco per questa nazione'}</div>`;
  } else {
    filtrata.slice(0, MAX_RIGHE).forEach(c => {
      const vis = inPercorsi ? posTappa.has(c.id) : stato.visitateCitta.has(c.id);
      const nTappa = posTappa.has(c.id) ? posTappa.get(c.id) + 1 : '';
      const frecce = (inPercorsi && vis) ? `<span class="frecce">
        <button class="f-up" data-msg="${c.id}">⇡</button>
        <button class="f-down" data-msg="${c.id}">⇣</button>
      </span>` : '';
      const label = inPercorsi ? (nTappa ? '#' + nTappa : formattaPop(c.pop)) : formattaPop(c.pop);
      html += `<div class="riga-citta ${vis ? (inPercorsi ? 'tappa' : 'visitata') : ''}" data-id="${c.id}">
        <span class="pallino"></span>
        <span class="info"><span class="nome">${esc(c.nome)}</span></span>
        ${frecce}
        <span class="pop">${label}</span>
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
    r.addEventListener('click', () => {
      try {
        if (inPercorsi) {
          const c = stato.cittaById.get(r.dataset.id) || stato.cacheCitta[r.dataset.id];
          if (c) {
            const prima = !stato.percorsoTappe.some(t => t.id === c.id);
            toggleTappa(c);
            if (prima && globo2d && c.lat != null && c.lon != null) {
              globo2d.pointOfView({ lat: c.lat, lng: c.lon, altitude: vistaAttualeAlt() }, 200);
            }
          }
        } else {
          toggleCitta(r.dataset.id, true);
        }
      } catch (err) {
        toast('⚠️ ERRORE: ' + err.message + ' | ' + (err.stack || '').split('\n')[0], 6000);
      }
    }));

  el.querySelectorAll('.f-up').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    spostaTappa(b.dataset.msg, -1);
  }));
  el.querySelectorAll('.f-down').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    spostaTappa(b.dataset.msg, +1);
  }));

  el.querySelector('#aggiungi-citta').addEventListener('click', () => {
    const nome = prompt('Nome della città:', q || '');
    if (!nome) return;
    aggiungiCittaManuale(nome, null, null);
  });
}

/* sposta una tappa del percorso (id) di una posizione (su = -1, giù = +1),
   con aggiornamento immediato del disegno e della lista. */
function spostaTappa(id, dir) {
  const i = stato.percorsoTappe.findIndex(t => t.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= stato.percorsoTappe.length) return;
  const [mossa] = stato.percorsoTappe.splice(i, 1);
  stato.percorsoTappe.splice(j, 0, mossa);
  salva();
  if (globo2d) globo2d.aggiorna();
  renderListaCitta();
}

function aggiornaRigaCitta(id) {
  const r = document.querySelector(`.riga-citta[data-id="${CSS.escape(id)}"]`);
  if (r) r.classList.toggle('visitata', stato.visitateCitta.has(id));
}

function aggiornaContatoreCitta() {
  const el = document.getElementById('p-count');
  if (!el || !stato.selezionata) return;
  const tutte = stato.cittaPerNazione.get(stato.selezionata) || [];
  if (stato.modalita === 'percorsi') {
    const vis = tutte.filter(c => stato.percorsoTappe.some(t => t.id === c.id)).length;
    el.textContent = stato.pronte ? `${vis} tappe` : '…';
  } else {
    const vis = tutte.filter(c => stato.visitateCitta.has(c.id)).length;
    el.textContent = stato.pronte ? `${vis}/${tutte.length}` : '…';
  }
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

async function renderCasa() {
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
    if (filtrate.length) html += '<div class="vuoto">Città dell\'elenco:</div>';
    filtrate.slice(0, MAX_RIGHE).forEach(c => {
      html += `<div class="riga-citta" data-citta="${c.id}">
        <span class="pallino"></span>
        <span class="info"><span class="nome">${esc(c.nome)}</span></span>
        <span class="pop">${formattaPop(c.pop)}</span>
      </div>`;
    });
    if (!filtrate.length && !q) html += '<div class="vuoto">Nessuna città in elenco</div>';

    /* se l'utente ha scritto un nome, cerchiamo anche "su internet" (Open-Meteo):
       così trova anche città piccole come Terni che non sono nell'elenco locale */
    if (q) {
      const f = stato.featureByKey.get(stato.casaNazione);
      const a2 = (f && f.meta && f.meta.a2) || '';
      html += `<div class="vuoto">🔎 Cerca "${esc(casaQuery)}" online…</div>`;
      lst.innerHTML = html;
      const lista = await cercaOnline(casaQuery, a2);
      if (document.getElementById('casa-ricerca').value !== casaQuery) return;
      renderCasaOnline(lista);
      return;
    }
  }
  lst.innerHTML = html;
}

function renderCasaOnline(lista) {
  const lst = document.getElementById('casa-lista');
  if (!lista || !lista.length) {
    lst.innerHTML = '<div class="vuoto">Nessuna città trovata online. Riprova a scriverla meglio.</div>';
    return;
  }
  let html = '<div class="vuoto">🌐 Risultati online (più precisi):</div>';
  lista.slice(0, 8).forEach(r => {
    html += `<div class="riga-citta" data-citta-ext="${encodeURIComponent(JSON.stringify({ nome: r.name, lat: r.lat, lon: r.lon }))}">
      <span class="pallino" style="background:#34d399"></span>
      <span class="info"><span class="nome">${esc(r.name)}</span></span>
      <span class="pop">${r.rego || ''}</span>
    </div>`;
  });
  lst.innerHTML = html;
}

async function cercaOnline(q, a2) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=it&format=json`;
    const ris = await fetch(url);
    if (!ris.ok) return null;
    const dati = await ris.json();
    const risu = (dati && dati.results) || [];
    const filtri = a2 ? risu.filter(r => (r.country_code || r.countryCode) === a2) : risu;
    return filtri.length ? filtri : risu;
  } catch (e) { return null; }
}

/* Autocorrezione: se la casa salvata in passato manca delle coordinate
   (vecchi salvataggi), le recuperiamo da cache/database o dal geocoder
   e risalviamo, così il puntino e il nome riappaiono. */
async function autocompletaCasa() {
  const casa = stato.casaCitta;
  if (!casa) return;
  if (isFinite(casa.lat) && isFinite(casa.lon)) return;
  /* 1) prova da cache o dalle città caricate */
  let c = stato.cittaById.get(casa.id) || stato.cacheCitta[casa.id];
  if (!c && casa.nome) {
    const perNome = [...stato.cittaById.values()].find(x => x.nome === casa.nome);
    c = perNome || null;
  }
  if (c && isFinite(c.lat) && isFinite(c.lon)) {
    stato.casaCitta.lat = c.lat;
    stato.casaCitta.lon = c.lon;
  } else if (casa.nome) {
    /* 2) ultima spiaggia: geocodifica online per nome */
    const ris = await cercaOnline(casa.nome, stato.casaNazione);
    if (ris && ris.length && isFinite(ris[0].latitude) && isFinite(ris[0].longitude)) {
      stato.casaCitta.lat = ris[0].latitude;
      stato.casaCitta.lon = ris[0].longitude;
    }
  }
  if (isFinite(stato.casaCitta.lat) && isFinite(stato.casaCitta.lon)) {
    salvaCasa();
    aggiornaPunti();
    aggiornaRigaCasa();
  }
}

/* ---------------- backup ---------------- */

function costruisciBackup() {
  return {
    app: 'countries-been-3d',
    versione: 3,
    esportato: new Date().toISOString(),
    nazioni: [...stato.visitateNazioni],
    citta: [...stato.visitateCitta],
    ordine: stato.visiteOrdine,
    date: stato.visiteData,
    percorso: stato.percorsoTappe,
    cacheCitta: stato.cacheCitta,
    casa: { nazione: stato.casaNazione, citta: stato.casaCitta }
  };
}

function esporta() {
  const testo = JSON.stringify(costruisciBackup(), null, 2);
  /* Nell'app Android (WebView) salviamo in una cartella a scelta del telefono */
  if (window.AndroidBridge && typeof window.AndroidBridge.salvaBackup === 'function') {
    try {
      const nome = 'countries-been-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      window.AndroidBridge.salvaBackup(nome, testo);
      return;
    } catch (e) { /* passa al metodo normale */ }
  }
  const blob = new Blob([testo], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'countries-been-backup.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('⬇ Backup esportato');
}

function autoBackup() {
  /* chiamato dall'app Android quando va in background / si chiude:
     salva direttamente nella cartella scelta, senza selettori.
     Nel browser normale non fa nulla (non può scrivere file in una cartella). */
  if (window.AndroidBridge && typeof window.AndroidBridge.salvaAutomatico === 'function') {
    try {
      const contenuto = JSON.stringify(costruisciBackup(), null, 2);
      window.AndroidBridge.salvaAutomatico(contenuto);
    } catch (e) {}
  }
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
      /* percorso: se nel backup ci sono, li carichiamo; altrimenti li
         ricostruiamo in ordine casuale stabile (quello del Set) */
      if (Array.isArray(d.ordine) && d.ordine.length) {
        stato.visiteOrdine = d.ordine;
        if (d.date && typeof d.date === 'object') stato.visiteData = d.date;
        else stato.visiteData = {};
      } else {
        stato.visiteOrdine = [...stato.visitateCitta];
        stato.visiteData = {};
      }
      /* vista Percorsi: tappe del viaggio costruito dall'utente */
      stato.percorsoTappe = Array.isArray(d.percorso) ? d.percorso : [];
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

    // chiavi univoche: alcuni id sono duplicati (110m: "-99"; 50m: "036" condiviso da
    // Australia + Ashmore; territori senza codice). In caso di id numerico condiviso,
    // la nazione vera (nome che corrisponde al meta di quel ccn3) tiene "c"+id,
    // l'altra feature va su "x:nome".
    const conteggioId = {};
    feats.forEach(f => { const k = String(f.id); conteggioId[k] = (conteggioId[k] || 0) + 1; });
    const duplicati = new Set(Object.keys(conteggioId).filter(k => conteggioId[k] > 1));

    feats.forEach(f => {
      const id = String(f.id || '');
      if (/^\d+$/.test(id) && !duplicati.has(id)) {
        f.key = 'c' + id;
      } else if (/^\d+$/.test(id)) {
        const m = indiceAlias.get(norma(f.properties.name));
        f.key = (m && m.key === 'c' + id) ? 'c' + id : 'x:' + norma(f.properties.name);
      } else {
        f.key = 'x:' + norma(f.properties.name);
      }
      f.meta = trovaMetaFeature(f);
      if (/^x:/.test(f.key)) {
        /* territori senza codice numerico (Kosovo, N. Cyprus...): il meta lo dà il nome */
        const mByNome = indiceAlias.get(norma(f.properties.name));
        if (mByNome) f.meta = mByNome;
      }
      stato.featureByKey.set(f.key, f);
    });

    globo2d = initGlobo(feats);
    aggiornaStatistiche();
    aggiornaRigaCasa();

    mostraCaricamento('Caricamento città…');
    await caricaCitta();
    await autocompletaCasa();

    document.getElementById('caricamento').classList.add('nascosto');
    setTimeout(() => document.getElementById('caricamento').remove(), 600);
    toast('✅ Aggiornata alla versione ' + APP_VER + ' 👆 Tocca una nazione per iniziare', 4500);
    aggiornaHUD();

    /* verifica dopo 4 secondi che il canvas esista */
    setTimeout(() => {
      const canvas = document.querySelector('#globeViz canvas');
      if (!canvas || canvas.width < 10 || canvas.height < 10) {
        mostraDiagnostico(
          '⚠️ Il mappamondo non è stato creato.\n' +
          'Prova ad aggiornare il browser.'
        );
      }
    }, 4000);
  } catch (e) {
    mostraCaricamento('⚠️ Errore di caricamento (' + (e && e.message ? e.message : 'rete') + ').\nControlla la connessione e ricarica la pagina.\nLa prima apertura richiede internet per scaricare i dati.');
  }
}

/* ---------------- eventi interfaccia ---------------- */

/* contatore live: punti e nomi visibili a schermo, aggiornato durante lo zoom */
function aggiornaHUD() {
  try {
    let el = document.getElementById('hud-counts');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hud-counts';
      el.style.cssText = 'position:fixed;bottom:8px;left:12px;z-index:9999;background:rgba(8,14,32,0.8);color:#bfe0ff;font:12px system-ui;padding:5px 9px;border-radius:7px;pointer-events:none;white-space:pre';
      document.body.appendChild(el);
    }
    const dc = globo2d ? globo2d.debugCounts() : { punti: -1, etichette: -1 };
    const alt = liveAltitudine();
    el.textContent = 'punti=' + dc.punti + '  nomi=' + dc.etichette + (alt != null ? '  zoom=' + alt.toFixed(2) : '');
  } catch (e) {}
}

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

/* SALVATAGGIO AUTOMATICO ALLA CHIUSURA/IN BACKGROUND: ogni modifica viene
   già salvata al momento; qui garantiamo che nessuna variazione residua
   vada persa quando si chiude l'app (o si passa in background). */
(function salvataggioSuChiusura() {
  const salvaTutto = () => {
    try {
      salva();
      salvaCache();
      salvaCasa();
      autoBackup();
    } catch (e) {}
  };
  window.addEventListener('pagehide', salvaTutto);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') salvaTutto();
  });
  document.addEventListener('freeze', salvaTutto);
})();

(function verificaWebGL() {
  /* il nuovo mappamondo 2D non richiede WebGL: nessun controllo necessario */
})();

/* ---------------- eventi interfaccia ---------------- */

/* pulsante ⚙️ apre le impostazioni */
document.getElementById('bt-imp').addEventListener('click', () =>
  document.getElementById('modale-imp').classList.add('aperta'));
document.getElementById('bt-percorsi').addEventListener('click', () => {
  stato.modalita = stato.modalita === 'mappa' ? 'percorsi' : 'mappa';
  document.getElementById('bt-percorsi').classList.toggle('attivo', stato.modalita === 'percorsi');
  toast(stato.modalita === 'percorsi'
    ? '🗺️ Vista percorsi: seleziona le tappe del tuo viaggio (si collegano in ordine)'
    : '🗺️ Vista mappa');
  if (globo2d) globo2d.aggiorna();
  aggiornaPunti();
  if (stato.selezionata) renderListaCitta();
});
document.getElementById('imp-chiudi').addEventListener('click', () =>
  document.getElementById('modale-imp').classList.remove('aperta'));
document.getElementById('modale-imp').addEventListener('click', e => {
  if (e.target.id === 'modale-imp') e.target.classList.remove('aperta');
});
document.getElementById('imp-casa').addEventListener('click', () => {
  document.getElementById('modale-imp').classList.remove('aperta');
  apriCasa();
});
document.getElementById('imp-export').addEventListener('click', () => {
  document.getElementById('modale-imp').classList.remove('aperta');
  esporta();
});
document.getElementById('imp-cartella').addEventListener('click', () => {
  if (window.AndroidBridge && typeof window.AndroidBridge.scegliCartella === 'function') {
    window.AndroidBridge.scegliCartella();
    toast('📁 Apri la cartella dove salvare i backup');
  } else {
    toast('⚠️ Disponibile solo nell\'app Android aggiornata', 3500);
  }
});
document.getElementById('imp-import').addEventListener('click', () => {
  document.getElementById('modale-imp').classList.remove('aperta');
  document.getElementById('file-input').click();
});
document.getElementById('imp-aggiorna').addEventListener('click', () => {
  document.getElementById('modale-imp').classList.remove('aperta');
  forzaAggiornamento();
});
document.getElementById('imp-help').addEventListener('click', () => {
  document.getElementById('modale-imp').classList.remove('aperta');
  document.getElementById('modale-help').classList.add('aperta');
});
document.getElementById('file-input').addEventListener('change', e => {
  if (e.target.files && e.target.files[0]) importa(e.target.files[0]);
  e.target.value = '';
});
document.getElementById('help-chiudi').addEventListener('click', () =>
  document.getElementById('modale-help').classList.remove('aperta'));
document.getElementById('modale-help').addEventListener('click', e => {
  if (e.target.id === 'modale-help') e.target.classList.remove('aperta');
});

/* — dove vivo — */
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
    return;
  }
  const rigaExt = e.target.closest('[data-citta-ext]');
  if (rigaExt) {
    try {
      const r = JSON.parse(decodeURIComponent(rigaExt.dataset.cittaExt));
      const id = hashId(r.nome, r.lat, r.lon);
      const c = { id, nome: r.nome, lat: r.lat, lon: r.lon, pop: 0, key: stato.casaNazione };
      stato.cittaById.set(id, c);
      if (stato.casaNazione && stato.cittaPerNazione.has(stato.casaNazione)) {
        stato.cittaPerNazione.get(stato.casaNazione).push(c);
      }
      stato.casaCitta = { id: c.id, nome: c.nome, lat: c.lat, lon: c.lon };
      salvaCasa();
      salvaCache();
      aggiornaPunti();
      aggiornaRigaCasa();
      toast('🏠 Casa impostata!');
      chiudiCasa();
    } catch (err) { toast('⚠️ Impossibile impostare la città'); }
    return;
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

