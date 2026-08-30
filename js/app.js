'use strict';

const APP_VER = 'v1.14.8';

/* ============================================================
   Countries Been 3D — logica applicativa
   ============================================================ */

const URL_NAZIONI = 'https://unpkg.com/world-atlas@2.0.2/countries-110m.json';
const URL_META    = 'https://cdn.jsdelivr.net/npm/world-countries@5/dist/countries-unescaped.json';
const URL_CITTA   = 'data/citta.geojson';
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
  cittaVista: '#ff2d2d',                  // rosso vivo: città visitata
  cittaNo: '#000000',                     // nero: città non ancora visitata
  cittaCap: '#ffd166',                  // oro: capitale
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
  if (c.cap) return COL.cittaCap;
  return stato.visitateCitta.has(c.id) ? COL.cittaVista : COL.cittaNo;
}

function altPunto(c) {
  if (eCasa(c.id)) return 0.04;
  if (stato.visitateCitta.has(c.id)) return 0.025;
  return 0.008;
}

function raggioPunto(c) {
  if (eCasa(c.id)) return 0.5;
  if (stato.visitateCitta.has(c.id)) return 0.22;
  return 0.07;
}

function etichettaCitta(c) {
  const vis = stato.visitateCitta.has(c.id);
  const pref = eCasa(c.id) ? '🏠 ' : '';
  const col = eCasa(c.id) ? '#c084fc' : (vis ? '#ff2d2d' : '#93a4c8');
  return `<div style="background:rgba(11,17,34,.92);padding:6px 10px;border-radius:8px;border:1px solid rgba(120,160,255,.35)">
        <b>${pref}${esc(c.nome)}</b>${c.pop ? ` · ${formattaPop(c.pop)}` : ''}<br>
        <span style="font-size:11px;color:${col}">
          ${eCasa(c.id) ? 'La tua città' : vis ? '✓ Visitata' : 'Tocca per segnare'}</span></div>`;
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
  const controlli = {
    autoRotate: false,           // il globo si muove SOLO se lo muovi tu
    autoRotateSpeed: 0,
    enableDamping: true,
    dampingFactor: 0.2,
    rotateSpeed: 0.55,
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
    for (const c of punti) {
      const p = puntoSchermo(c);
      if (!p) continue;
      const casa = eCasa(c.id);
      const visitata = stato.visitateCitta.has(c.id);
      const cap = !casa && !!c.cap;
      const r = casa ? 2.6 : (cap ? 2.0 : (visitata ? 1.5 : 1.2));
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = colorePunto(c);
      ctx.fill();
      /* bordo chiaro su TUTTI i punti: rende visibili anche i pallini neri
         (non visitati) sullo sfondo scuro dell'oceano */
      ctx.strokeStyle = cap ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = (visitata || casa || cap) ? 1.1 : 0.8;
      ctx.stroke();
    }
  }

  function disegnaNomi() {
    const alt = liveAltitudine();
    if (alt >= SOGLIA_NOMI) return;
    ctx.font = '500 ' + Math.round(scaleFont) + 'px system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const e of etichette) {
      const p = puntoSchermo(e);
      if (!p) continue;
      const cap = e.cap && !e.casa;
      const fz = cap ? Math.round(scaleFont) + 2 : Math.round(scaleFont);
      ctx.font = '600 ' + fz + 'px system-ui';
      ctx.fillStyle = 'rgba(8,14,32,0.82)';
      const larg = ctx.measureText(e.nome).width;
      roundRect(p[0] + 4, p[1] - 8, larg + 8, cap ? 18 : 16, 3);
      ctx.fill();
      ctx.fillStyle = e.casa ? '#c084fc' : (cap ? '#ffd166' : (e.vis ? '#ff6b6b' : '#5eead4'));
      ctx.font = '600 ' + fz + 'px system-ui';
      ctx.fillText(e.nome, p[0] + 8, p[1]);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
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
    let miglior = null, miglioreD = 18;
    for (const c of punti) {
      const p = puntoSchermo(c);
      if (!p) continue;
      const dx = p[0] - x, dy = p[1] - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < miglioreD) { miglioreD = d; miglior = c; }
    }
    return miglior;
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
      const dx = e.clientX - ultimoX;
      const dy = e.clientY - ultimoY;
      /* velocità angolare: un pixel = altrettanti gradi del globo (scala) */
      const gradiPerPx = 360 / (scalaAttuale() * Math.PI * 2);
      vista.lon -= dx * gradiPerPx * controlli.rotateSpeed * 3;
      vista.lat = Math.max(-89.99, Math.min(89.99, vista.lat + dy * gradiPerPx * controlli.rotateSpeed * 3));
      /* normalizza lon */
      vista.lon = ((vista.lon % 360) + 360) % 360;
      /* inerzia */
      const ora = performance.now();
      const dt = Math.max(1, ora - lastTime);
      velX = dx * gradiPerPx * controlli.rotateSpeed * 3 * (dt / 16);
      velY = dy * gradiPerPx * controlli.rotateSpeed * 3 * (dt / 16);
      lastTime = ora;
      ultimoX = e.clientX; ultimoY = e.clientY;
    } else if (dita.size === 2) {
      const [a, b] = [...dita.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (distanzaDita > 0 && d > 0) {
        const f = d / distanzaDita;
        /* più sensibile: spingendo il pizzico entri più in fretta */
        vista.alt = Math.max(MIN_ALT, Math.min(MAX_ALT, altStartZoom / Math.pow(f, 1.5)));
      }
    }
  }

  function pointerSu(e) {
    dita.delete(e.pointerId);
    if (dita.size === 0) {
      trascinando = false;
      controlli.autoRotate = false;
    }
  }

  function tap() {
    const click = ultimoEventoClick;
    if (!click) return;
    const c = cittaSotto(click.x, click.y);
    if (c) {
      toggleCitta(c.id);
      ultimoEventoClick = null;
      return;
    }
    const f = nazioneSotto(click.x, click.y);
    if (f) selezionaNazione(f);
    else deseleziona();
    ultimoEventoClick = null;
  }

  let downX = 0, downY = 0, downTime = 0, spostato = false;

  canvas.addEventListener('pointerdown', e => {
    downX = e.clientX; downY = e.clientY; downTime = Date.now(); spostato = false;
    pointerGiù(e);
  });
  canvas.addEventListener('pointermove', e => {
    if (dita.has(e.pointerId) && Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) spostato = true;
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
        const c = cittaSotto(e.clientX, e.clientY);
        if (c) { toggleCitta(c.id); return; }
        const f = nazioneSotto(e.clientX, e.clientY);
        if (f) selezionaNazione(f);
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
    const f = Math.pow(0.82, (delta || 0) * 0.02);
    vista.alt = Math.max(MIN_ALT, Math.min(MAX_ALT, vista.alt * f));
    daRidisegnare = true;
  }, { passive: false });

  const MIN_ALT = 0.03;
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
    /* città delle nazioni visibili a schermo (per lo zoom manuale):
       rivela anche le città non ancora salvate, così ci si ricorda e si tocca */
    cittaPerZoom() {
      const scelte = [];
      const pov = this.pointOfView();
      const cLon = pov ? pov.lon : 0;
      const cLat = pov ? pov.lat : 0;
      const on = [];
      for (const f of poligoni) {
        const c = centroide(f);
        const p = proj([c.lng, c.lat]);
        if (!p || isNaN(p[0]) || isNaN(p[1])) continue;
        if (p[0] >= -W / 2 && p[0] <= W * 1.5 && p[1] >= -H / 2 && p[1] <= H * 1.5) {
          const dLon = Math.abs(c.lng - cLon) % 360;
          const dLat = c.lat - cLat;
          on.push({ key: f.key, d: dLat * dLat + (dLon > 180 ? 360 - dLon : dLon) * (dLon > 180 ? 360 - dLon : dLon) });
        }
      }
      on.sort((a, b) => a.d - b.d);
      for (const o of on) {
        scelte.push(...(stato.cittaPerNazione.get(o.key) || []));
      }
      return scelte;
    }
  };
}

let globo2d = null;
let ultimaSogliaZoom = null;
let ultimaSogliaCitta = null;

function liveAltitudine() {
  if (!globo2d) return null;
  const pov = globo2d.pointOfView();
  return pov ? pov.alt : null;
}

/* soglia di popolazione per la comparsa progressiva delle città con lo zoom:
   da lontano (alt alto) solo le città più grandi, avvicinandosi (alt basso)
   scende e "emergono" sempre più città, come nell'app Country Beans */
function sogliaPopDaAlt(alt) {
  if (alt == null) return 1500000;
  const al = Math.max(0.03, alt);
  return Math.round(500000 * Math.pow(al / 2.2, 2));
}

/* simbolo per distinguere "nazioni aggiornate" vs "città aggiornate" */
const NG_CITTA = '__citta__';

function aggiornaEtichetteZoometta() {
  const alt = liveAltitudine();
  if (alt == null) return;
  /* nomi delle città: solo davvero vicini */
  const zoomata = alt < 0.35;
  if (zoomata !== ultimaSogliaZoom) {
    ultimaSogliaZoom = zoomata;
    aggiornaPunti(NG_CITTA);
  }
  /* comparsa progressiva con lo zoom: ogni volta che la soglia di
     popolazione cambia (cioè mentre ci si avvicina o allontana) le città
     vengono ricalcolate, così "emergono" via via, come nell'app Country Beans */
  const nuovo = sogliaPopDaAlt(alt);
  if (nuovo !== ultimaSogliaCitta) {
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
      cap: Number(p.adm0cap) === 1,
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

  /* Da lontananza massima NON si vede nessun pallino, solo le nazioni colorate.
     Zoomando: prima emergono le citta gia visitate + casa (sotto 0.55), poi
     ancora piu dentro le citta da selezionare (sotto 0.35). Modello Country Beans. */
  if (alt != null && alt >= 0.7) return [];

  /* citta visitate + casa: compaiono avvicinandosi, non da lontano */
  if (stato.visitateCitta.size || stato.casaCitta) {
    for (const id of stato.visitateCitta) {
      push(stato.cittaById.get(id) || stato.cacheCitta[id]);
    }
    if (stato.casaCitta) {
      push({ id: stato.casaCitta.id, nome: stato.casaCitta.nome, lat: stato.casaCitta.lat, lon: stato.casaCitta.lon, pop: 0, casa: true });
    }
  }

  /* se una nazione e selezionata mostriamo TUTTE le sue citta (toccabili subito) */
  if (stato.selezionata) {
    const lista = (stato.cittaPerNazione.get(stato.selezionata) || []).slice()
      .sort((a, b) => (b.pop || 0) - (a.pop || 0))
      .slice(0, 1500);
    lista.forEach(c => push(c));
  } else if (globo2d && alt != null && alt < 0.55) {
    /* citta da selezionare: compaiono SOLO quando ti avvicini abbastanza */
    const soglia = sogliaPopDaAlt(alt);
    const lista = globo2d.cittaPerZoom()
      .filter(c => c && (c.pop || 0) >= soglia)
      .sort((a, b) => (b.pop || 0) - (a.pop || 0))
      .slice(0, 2000);
    lista.forEach(c => push(c));
    const centro = nazioneAlCentro();
    if (centro) {
      (stato.cittaPerNazione.get(centro) || [])
        .filter(c => (c.pop || 0) >= soglia)
        .forEach(c => push(c));
    }
  }

  return Array.from(mappa.values());
}

/* nomi delle città da mostrare; solo quando si è abbastanza vicini (zoom in) */
function etichetteVisibili() {
  const alt = liveAltitudine();
  if (alt == null || alt >= 0.7) return [];   // non ancora abbastanza vicini: niente nomi
  const elenco = [];
  const viste = new Set(stato.visitateCitta);
  const visite = [...viste].map(id =>
    stato.cittaById.get(id) || stato.cacheCitta[id]).filter(Boolean);
  for (const c of visite) {
    elenco.push({ id: c.id, nome: c.nome, lat: c.lat, lon: c.lon, alt: altPunto(c) + 0.01, casa: c.id === (stato.casaCitta && stato.casaCitta.id), vis: true, cap: !!c.cap });
  }
  /* casa: sempre presente, con le coordinate salvate (così compare anche il nome) */
  if (stato.casaCitta) {
    if (!viste.has(stato.casaCitta.id)) {
      const casa = { id: stato.casaCitta.id };
      elenco.push({ id: stato.casaCitta.id, nome: stato.casaCitta.nome, lat: stato.casaCitta.lat, lon: stato.casaCitta.lon, alt: altPunto(casa) + 0.01, casa: true, vis: true });
    }
  }
  /* città non ancora visitate visibili a schermo: mostriamo i loro nomi man
     mano che ci si avvicina, così si capisce QUALE pallino è quale (modello
     Country Beans) — limitiamo il numero per non riempire lo schermo */
  if (globo2d && alt < 0.55) {
    const attuali = globo2d.currentPoints() || [];
    const extra = attuali
      .filter(c => c && !viste.has(c.id) && !(stato.casaCitta && c.id === stato.casaCitta.id))
      .sort((a, b) => (b.pop || 0) - (a.pop || 0))
      .slice(0, 400);
    for (const c of extra) {
      elenco.push({ id: c.id, nome: c.nome, lat: c.lat, lon: c.lon, alt: altPunto(c) + 0.01, casa: false, vis: false, cap: !!c.cap });
    }
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
    aggiungiCittaManuale(nome, null, null);
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
    versione: 1,
    esportato: new Date().toISOString(),
    nazioni: [...stato.visitateNazioni],
    citta: [...stato.visitateCitta],
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
      el.style.cssText = 'position:fixed;top:8px;right:8px;z-index:9999;background:rgba(8,14,32,0.85);color:#bfe0ff;font:12px system-ui;padding:5px 9px;border-radius:7px;pointer-events:none;white-space:pre';
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

(function verificaWebGL() {
  /* il nuovo mappamondo 2D non richiede WebGL: nessun controllo necessario */
})();

/* ---------------- eventi interfaccia ---------------- */

/* pulsante ⚙️ apre le impostazioni */
document.getElementById('bt-imp').addEventListener('click', () =>
  document.getElementById('modale-imp').classList.add('aperta'));
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

