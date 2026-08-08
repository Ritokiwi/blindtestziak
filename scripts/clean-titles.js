/*
  Nettoie les titres de tous les catalogues : retire les suffixes "(feat. X)"
  et les annotations de session Deezer type "(Enregistré à Paris)", pour ne
  garder que le titre devinable. Ne touche ni au project, ni au deezerTrackId.
  Usage : node scripts/clean-titles.js
*/
const fs = require('fs');
const path = require('path');
const { cleanTitle } = require('./generate-catalog');

const ROOT = path.join(__dirname, '..');

function run() {
  const artists = JSON.parse(fs.readFileSync(path.join(ROOT, 'artists.json'), 'utf8'));
  let totalChanged = 0;
  for (const artist of artists) {
    const catalogPath = path.join(ROOT, artist.catalog);
    const songs = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    let changed = 0;
    for (const song of songs) {
      const cleaned = cleanTitle(song.title);
      if (cleaned && cleaned !== song.title) {
        console.log(`  ${artist.id}: "${song.title}" -> "${cleaned}"`);
        song.title = cleaned;
        changed++;
      }
    }
    if (changed) {
      fs.writeFileSync(catalogPath, JSON.stringify(songs, null, 2) + '\n');
      console.log(`${artist.id}: ${changed} titre(s) nettoyé(s) dans ${artist.catalog}`);
      totalChanged += changed;
    }
  }
  console.log(`\nTotal : ${totalChanged} titres nettoyés.`);
}

run();
module.exports = { cleanTitle };
