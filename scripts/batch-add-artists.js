/*
  Génère en série les catalogues d'une liste d'artistes (slug + id Deezer)
  et écrit le résultat au format attendu par le site (comme generate-catalog.js
  en boucle, avec un log de progression et une tolérance aux échecs isolés).
  Usage : node scripts/batch-add-artists.js
*/
const fs = require('fs');
const path = require('path');
const { generateCatalog, fetchArtistImage, fetchArtist } = require('./generate-catalog');

const ROOT = path.join(__dirname, '..');

const ARTISTS = [
  ['freeze-corleone', 13755123],
  ['jrk19', 115427322],
  ['maes', 4448630],
  ['timal', 74463],
  ['timar', 6354270],
  ['naps', 4842061],
  ['djadja-dinaz', 9930130],
  ['fresh-la-douille', 101739872],
  ['iss', 4365815],
  ['le-crime', 80268952],
  ['lacrim', 4087782],
  ['aya-nakamura', 8909272],
  ['naza', 7459270],
  ['niro', 58624],
  ['yl', 12490752],
  ['sadek', 1270444],
  ['rim-k', 256080],
  ['gradur', 5876247],
  ['booba', 390],
  ['kaaris', 388973],
  ['heuss-lenfoire', 13645509],
  ['alonzo', 259729],
  ['sch', 162665],
  ['zkr', 14240131],
  ['dosseh', 158083],
  ['mister-you', 256681],
  ['hornet-la-frappe', 6545727],
  ['sasso', 604395],
  ['soso-maness', 5594859],
  ['leto', 455796],
  ['dinos', 292949],
  ['josman', 7365500],
  ['nekfeu', 1412564],
  ['laylow', 4510044],
  ['hamza', 171998],
  ['la-feve', 102204242],
  ['so-la-lune', 68553672],
  ['guy2bezbar', 11026886],
  ['kalash-criminel', 10452069],
  ['da-uzi', 11884111],
  ['kofs', 5593078],
  ['1plike140', 85082932],
  ['soolking', 10189104],
  ['jokair', 4907510],
  ['franglish', 10695573],
  ['kekra', 8352118],
  ['green-montana', 15337813],
  ['oboy', 4986771],
  ['alpha-wann', 4428187]
];

async function run() {
  const results = [];
  for (const [slug, artistId] of ARTISTS) {
    process.stdout.write(`-> ${slug} (Deezer ${artistId})... `);
    try {
      const { artist, tracks, stats } = await generateCatalog(slug, artistId);
      fs.writeFileSync(path.join(ROOT, `${slug}.json`), JSON.stringify(tracks, null, 2) + '\n');
      let imageInfo = null;
      try { imageInfo = await fetchArtistImage(artist, slug); } catch (err) { console.log(`\n   ! image indisponible pour ${slug}: ${err.message}`); }
      console.log(`${tracks.length} morceaux, name="${artist.name}"${imageInfo ? `, image=${imageInfo.filename}` : ''}`);
      results.push({ slug, artistId, name: artist.name, tracks: tracks.length, ok: true, stats });
    } catch (err) {
      console.log(`ÉCHEC: ${err.message}`);
      results.push({ slug, artistId, ok: false, error: err.message });
    }
  }
  fs.writeFileSync(path.join(ROOT, 'scripts', 'batch-add-artists-result.json'), JSON.stringify(results, null, 2) + '\n');
  console.log('\n=== Terminé ===');
  const failed = results.filter(r => !r.ok);
  if (failed.length) console.log('Échecs:', failed.map(f => f.slug).join(', '));
  else console.log('Tous les artistes ont été générés avec succès.');
}
run().catch(err => { console.error(err); process.exit(1); });
