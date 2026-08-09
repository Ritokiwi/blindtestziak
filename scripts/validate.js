/*
  Contrôle de cohérence avant déploiement :
  - artists.json bien formé, chaque entrée a un catalogue + une image existants
  - chaque catalogue est un JSON valide, non vide, avec les champs attendus par script.js
  - pas de deezerTrackId dupliqué dans un même catalogue
  Usage : node scripts/validate.js
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let errors = 0;
let warnings = 0;

function fail(msg) { console.error(`  ✗ ${msg}`); errors++; }
function warn(msg) { console.warn(`  ! ${msg}`); warnings++; }

function isImageFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const buf = fs.readFileSync(filePath);
  if (buf.length < 500) return false;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  return isJpeg || isPng;
}

let artists;
try {
  artists = JSON.parse(fs.readFileSync(path.join(ROOT, 'artists.json'), 'utf8'));
} catch (err) {
  console.error(`artists.json invalide: ${err.message}`);
  process.exit(1);
}

const seenIds = new Set();
for (const artist of artists) {
  console.log(`\n${artist.name} (${artist.id})`);
  if (seenIds.has(artist.id)) fail(`id "${artist.id}" en double dans artists.json`);
  seenIds.add(artist.id);
  if (!artist.catalog) { fail('champ "catalog" manquant'); continue; }

  const catalogPath = path.join(ROOT, artist.catalog);
  if (!fs.existsSync(catalogPath)) { fail(`catalogue introuvable: ${artist.catalog}`); continue; }

  let songs;
  try {
    songs = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch (err) {
    fail(`JSON invalide dans ${artist.catalog}: ${err.message}`);
    continue;
  }
  if (!Array.isArray(songs) || songs.length === 0) { fail(`catalogue vide: ${artist.catalog}`); continue; }

  const trackIds = new Set();
  let badEntries = 0;
  for (const song of songs) {
    if (!song || typeof song !== 'object') { badEntries++; continue; }
    if (!song.title) { badEntries++; continue; }
    if (!song.audio && !song.soundcloudUrl && !song.deezerTrackId) { badEntries++; continue; }
    if (song.deezerTrackId) {
      if (trackIds.has(song.deezerTrackId)) fail(`deezerTrackId ${song.deezerTrackId} dupliqué dans ${artist.catalog}`);
      trackIds.add(song.deezerTrackId);
    }
  }
  if (badEntries) fail(`${badEntries} morceau(x) avec des champs manquants dans ${artist.catalog}`);
  else console.log(`  ✓ ${songs.length} morceaux valides`);

  if (!artist.image) { if (!artist.category) fail('champ "image" manquant'); }
  else {
    const imagePath = path.join(ROOT, artist.image);
    if (!isImageFile(imagePath)) fail(`image manquante ou invalide: ${artist.image}`);
    else console.log(`  ✓ image ${artist.image}`);
  }
}

console.log(`\n${errors ? '✗' : '✓'} ${artists.length} artistes contrôlés — ${errors} erreur(s), ${warnings} avertissement(s)`);
process.exit(errors ? 1 : 0);
