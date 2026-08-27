'use strict';

/* ============================================================
   Utility dati: normalizzazione nomi nazioni + alias
   (per collegare le città di Natural Earth alle nazioni della mappa)
   ============================================================ */

const TOT_NAZIONI = 195;

function norma(s) {
  return (s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* abbreviazioni usate da Natural Earth */
const ESPANDI = {
  rep: 'republic', dem: 'democratic', eq: 'equatorial', is: 'islands',
  st: 'saint', cent: 'central', afr: 'africa', n: 'north', s: 'south',
  e: 'east', w: 'west', herz: 'herzegovina', sar: '', pdr: '',
  grt: 'great', un: 'united', fr: 'french'
};

/* varianti di un nome (originale + con abbreviazioni espanse + senza articoli) */
function variantiNome(nome) {
  const out = new Set();
  const base = norma(nome);
  if (!base) return [''];
  out.add(base);
  const parole = base.split(' ');
  const esp = parole.map(p => (ESPANDI[p] !== undefined ? ESPANDI[p] : p)).filter(Boolean);
  const e2 = esp.join(' ').replace(/\s+/g, ' ').trim();
  if (e2) out.add(e2);
  const stop = new Set(['of', 'the', 'and']);
  const r = esp.filter(p => !stop.has(p)).join(' ').trim();
  if (r) out.add(r);
  return Array.from(out);
}

/* eccezioni: nome normalizzato -> codice ISO3
   (differenze tra i nomi di Natural Earth e l'elenco standard) */
const SOPRASCRIPTI = {
  'united states of america': 'USA',
  'dem rep congo': 'COD', 'democratic republic of congo': 'COD', 'congo kinshasa': 'COD',
  'republic of congo': 'COG', 'congo brazzaville': 'COG',
  'ivory coast': 'CIV', 'cote d ivoire': 'CIV',
  'swaziland': 'SWZ', 'east timor': 'TLS', 'timor leste': 'TLS',
  'burma': 'MMR', 'laos': 'LAO', 'lao pdr': 'LAO',
  'vatican': 'VAT', 'holy see': 'VAT',
  'palestine': 'PSE', 'west bank': 'PSE', 'gaza strip': 'PSE', 'palestinian territory': 'PSE',
  'macedonia': 'MKD', 'north macedonia': 'MKD',
  'czech rep': 'CZE', 'czech republic': 'CZE',
  'south korea': 'KOR', 'korea south': 'KOR', 'republic of korea': 'KOR',
  'north korea': 'PRK', 'korea north': 'PRK', 'dem peoples rep of korea': 'PRK', 'korea dpr': 'PRK',
  'russian federation': 'RUS', 'syrian arab republic': 'SYR',
  'islamic republic of iran': 'IRN', 'iran islamic republic': 'IRN',
  'united republic of tanzania': 'TZA', 'brunei darussalam': 'BRN', 'viet nam': 'VNM',
  'bolivia plurinational state of': 'BOL', 'plurinational state of bolivia': 'BOL',
  'venezuela bolivarian republic of': 'VEN', 'bolivarian republic of venezuela': 'VEN',
  'dominican rep': 'DOM', 'central african rep': 'CAF',
  'eq guinea': 'GNQ', 's sudan': 'SSD', 'south sudan': 'SSD',
  'solomon is': 'SLB', 'cape verde': 'CPV',
  'st vincent and the grenadines': 'VCT', 'st lucia': 'LCA', 'st kitts and nevis': 'KNA',
  'sao tome and principe': 'STP',
  'turkiye': 'TUR', 'great britain': 'GBR', 'uk': 'GBR',
  'northern cyprus': 'CYP', 'somaliland': 'SOM',
  'hong kong': 'HKG', 'macau': 'MAC', 'macao': 'MAC',
  'taiwan province of china': 'TWN', 'chinese taipei': 'TWN',
  'falkland islands': 'FLK', 'fr s antarctic lands': 'ATF', 'french southern territories': 'ATF',
  'cura ao': 'CUW', 'curacao': 'CUW',
  'heard island and mcdonald islands': 'HMD', 'svalbard': 'SJM', 'jan mayen': 'SJM'
};

/* emoji bandiera da codice ISO2 */
function emojiDaA2(a2) {
  if (!a2 || a2.length !== 2 || /[^A-Za-z]/.test(a2)) return '';
  return String.fromCodePoint(...a2.toUpperCase().split('').map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}
