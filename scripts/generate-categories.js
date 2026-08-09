/*
  Génère les catalogues des catégories multi-artistes (mélange plusieurs
  artistes dans une même partie), à partir des catalogues déjà présents sur
  le site (RAP FR, SONS DU MOMENT) et du classement mondial Deezer (TOP 100).
  Usage : node scripts/generate-categories.js
*/
const fs = require('fs');
const path = require('path');
const { fetchJson, cleanTitle } = require('./generate-catalog');

const ROOT = path.join(__dirname, '..');

function loadRealArtistCatalogs() {
  const artists = JSON.parse(fs.readFileSync(path.join(ROOT, 'artists.json'), 'utf8'));
  const pool = [];
  const seenTrackIds = new Set();
  for (const artist of artists) {
    if (artist.category) continue;
    const songs = JSON.parse(fs.readFileSync(path.join(ROOT, artist.catalog), 'utf8'));
    for (const song of songs) {
      // Un featuring peut apparaître dans les catalogues des deux artistes crédités
      // (même deezerTrackId) : on ne le garde qu'une fois pour éviter le doublon
      // dans le pool mélangé.
      if (seenTrackIds.has(song.deezerTrackId)) continue;
      seenTrackIds.add(song.deezerTrackId);
      pool.push({
        id: `cat-${artist.id}-${song.deezerTrackId}`,
        title: song.title,
        artist: artist.name,
        project: song.project,
        year: song.year,
        releaseDate: song.releaseDate,
        deezerTrackId: song.deezerTrackId
      });
    }
  }
  return pool;
}

function generateRapFr() {
  const pool = loadRealArtistCatalogs();
  fs.writeFileSync(path.join(ROOT, 'category-rapfr.json'), JSON.stringify(pool, null, 2) + '\n');
  console.log(`RAP FR : ${pool.length} morceaux (tous artistes confondus)`);
}

function generateMoment(limit = 150) {
  const pool = loadRealArtistCatalogs();
  const recent = [...pool]
    .filter(s => s.releaseDate)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .slice(0, limit);
  fs.writeFileSync(path.join(ROOT, 'category-moment.json'), JSON.stringify(recent, null, 2) + '\n');
  console.log(`SONS DU MOMENT : ${recent.length} morceaux (les plus récents, du ${recent.at(-1)?.releaseDate} au ${recent[0]?.releaseDate})`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function generateTop100() {
  const chart = await fetchJson('https://api.deezer.com/chart/0/tracks?limit=100');
  const tracks = [];
  for (const track of chart.data || []) {
    if (!track.title || !track.preview) continue;
    let releaseDate = '';
    try {
      const album = await fetchJson(`https://api.deezer.com/album/${track.album.id}`);
      releaseDate = album.release_date || '';
    } catch { /* tant pis pour la date, le morceau reste jouable */ }
    tracks.push({
      id: `cat-top100-${track.id}`,
      title: cleanTitle(track.title),
      artist: track.artist?.name || 'Artiste inconnu',
      project: track.album?.title || '',
      year: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
      releaseDate,
      deezerTrackId: track.id
    });
    await sleep(120);
  }
  fs.writeFileSync(path.join(ROOT, 'category-top100.json'), JSON.stringify(tracks, null, 2) + '\n');
  console.log(`TOP 100 MONDE : ${tracks.length} morceaux (classement mondial Deezer)`);
}

async function run() {
  generateRapFr();
  generateMoment();
  await generateTop100();
}

run().catch(err => { console.error(err); process.exit(1); });
