/* Mini-server locale per Countries Been 3D — nessuna installazione richiesta (solo Node.js).
   Avvio: doppio clic su avvia.bat  →  si apre http://localhost:8080 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 8080;
const RADICE = __dirname;

const TIPI = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let percorso = decodeURIComponent((req.url || '/').split('?')[0]);
  if (percorso === '/' || percorso === '') percorso = '/index.html';
  const file = path.join(RADICE, percorso);
  if (!file.startsWith(RADICE)) {
    res.writeHead(403); res.end('Vietato'); return;
  }
  fs.readFile(file, (err, dati) => {
    if (err) { res.writeHead(404); res.end('Non trovato'); return; }
    res.writeHead(200, { 'Content-Type': TIPI[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(dati);
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Il server è già attivo sulla porta ${PORT}. Apro il browser…`);
    apriBrowser();
  } else {
    console.error('Errore server:', err.message);
  }
});

function apriBrowser() {
  const cmd = process.platform === 'win32' ? `start "" "http://localhost:${PORT}"` : 'xdg-open';
  exec(cmd, () => {});
}

server.listen(PORT, () => {
  console.log('');
  console.log('  🌍 Countries Been 3D in esecuzione!');
  console.log(`  Apri nel browser:  http://localhost:${PORT}`);
  console.log('  Lascia aperta questa finestra finché usi l\'app. Chiudila per fermare.');
  console.log('');
  apriBrowser();
});
