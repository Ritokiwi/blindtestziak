/*
  Vérifie que chaque catalogue local contient bien tout ce que la logique de
  génération produirait à partir de la discographie Deezer actuelle.
  Recalcule un jeu de morceaux "attendu" pour chaque artiste (mêmes règles que
  generate-catalog.js) et le compare au JSON réellement présent sur le site.
  Usage : node scripts/verify-completeness.js
*/
const fs = require('fs');
const path = require('path');
const { generateCatalog, fetchJson } = require('./generate-catalog');

const ROOT = path.join(__dirname, '..');
const REPORT_PATH = path.join(__dirname, 'completeness-report.json');

// IDs Deezer connus pour les 24 artistes ajoutés dans cette mission.
const KNOWN_IDS = {
  ninho: 5542343, 'la-mano19': 184573357, pnl: 1519461, gazo: 8873540,
  werenoi: 121672292, 'koba-lad': 14621667, 'la-rvfleuze': 174484227, sdm: 604107,
  tiakola: 13918545, zola: 13962203, mhd: 881751, gambi: 65303292,
  'beendo-z': 109312472, gims: 4429712, plk: 1479842, niska: 5288900,
  houdi: 48443532, vald: 5175734, theodora: 13820325, 'nono-la-grinta': 194146027,
  'black-cat': 378625491, l2b: 13790723, damso: 9197980, jolagreen23: 132179322
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function resolveArtistId(slug, songs) {
  if (KNOWN_IDS[slug]) return KNOWN_IDS[slug];
  const withTrack = songs.find(s => s.deezerTrackId);
  if (!withTrack) return null;
  const track = await fetchJson(`https://api.deezer.com/track/${withTrack.deezerTrackId}`);
  return track?.artist?.id || null;
}

async function run() {
  const artists = JSON.parse(fs.readFileSync(path.join(ROOT, 'artists.json'), 'utf8'));
  const onlySlug = process.argv[2];
  const report = {};

  for (const artist of artists) {
    if (onlySlug && artist.id !== onlySlug) continue;
    const catalogPath = path.join(ROOT, artist.catalog);
    const songs = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const actualIds = new Set(songs.filter(s => s.deezerTrackId).map(s => Number(s.deezerTrackId)));

    console.log(`\n→ ${artist.name} (${artist.id}) — ${songs.length} morceaux actuels`);
    const artistId = await resolveArtistId(artist.id, songs);
    if (!artistId) { console.log('  ! impossible de déterminer l\'ID Deezer, skip'); continue; }

    let expected;
    try {
      expected = await generateCatalog(artist.id, artistId, () => {});
    } catch (err) {
      console.log(`  ! erreur régénération: ${err.message}`);
      report[artist.id] = { error: err.message };
      continue;
    }
    const expectedIds = new Set(expected.tracks.map(t => Number(t.deezerTrackId)));

    const missing = [...expectedIds].filter(id => !actualIds.has(id)).map(id => expected.tracks.find(t => Number(t.deezerTrackId) === id));
    const extra = [...actualIds].filter(id => !expectedIds.has(id));

    console.log(`  attendu maintenant: ${expectedIds.size} — manquants: ${missing.length} — surnuméraires (déjà présents mais plus générés maintenant): ${extra.length}`);
    if (missing.length) console.log('  MANQUANTS:', missing.map(t => `${t.title} [${t.project}, ${t.deezerTrackId}]`).join(' | '));
    if (extra.length) console.log('  SURNUMÉRAIRES:', extra.join(', '));

    report[artist.id] = {
      name: artist.name,
      artistId,
      actualCount: actualIds.size,
      expectedCount: expectedIds.size,
      missing: missing.map(t => ({ title: t.title, project: t.project, deezerTrackId: t.deezerTrackId })),
      extra
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
    await sleep(200);
  }
  console.log('\nTerminé. Rapport dans scripts/completeness-report.json');
}

run().catch(err => { console.error(err); process.exit(1); });
