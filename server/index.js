// Point d'entrée : sert le client web en HTTP et ouvre le WebSocket du jeu sur le même port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './Room.js';
import { DEFAULT_PORT } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || DEFAULT_PORT;

// préfixe d'URL -> dossier servi
const MOUNTS = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three', 'build')],
  ['/', path.join(ROOT, 'client')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const file = path.join(dir, urlPath.slice(prefix.length));
    if (!file.startsWith(dir + path.sep)) break; // pas de sortie du dossier
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404).end('Not found');
}

function lanUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      // 169.254.x.x = carte réseau sans connexion : inutilisable par les autres joueurs
      if (ni.family === 'IPv4' && !ni.internal && !ni.address.startsWith('169.254.')) urls.push(`http://${ni.address}:${PORT}`);
    }
  }
  // les adresses de box / routeur domestique en premier
  const home = (u) => (u.includes('//192.168.') ? 0 : u.includes('//10.') ? 1 : 2);
  return urls.sort((a, b) => home(a) - home(b));
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, perMessageDeflate: false });
const urls = lanUrls();
const room = new Room({ lanUrls: urls });
// connexion depuis le PC qui fait tourner le serveur (localhost ou une de ses propres adresses réseau)
const ownAddresses = new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map((ni) => ni.address));
function isLocal(addr = '') {
  const a = addr.replace(/^::ffff:/, '');
  return a === '::1' || a.startsWith('127.') || ownAddresses.has(a);
}
wss.on('connection', (ws, req) => room.addClient(ws, isLocal(req.socket.remoteAddress)));
room.start();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Le port ${PORT} est déjà utilisé. Ferme l'autre serveur ou lance avec un autre port (variable PORT).`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  TANK 3D — serveur lancé');
  console.log('  -----------------------');
  console.log(`  Toi (sur ce PC)       : http://localhost:${PORT}`);
  for (const u of urls) console.log(`  Tes potes (même réseau) : ${u}`);
  if (!urls.length) console.log('  (aucune adresse réseau détectée : vérifie ta connexion Wi-Fi / Ethernet)');
  console.log('');
  console.log('  Si Windows demande une autorisation pare-feu, accepte pour le réseau privé.');
  console.log('  Ctrl+C pour arrêter.');
  console.log('');
});
