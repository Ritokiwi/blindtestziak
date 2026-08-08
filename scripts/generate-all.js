/*
  Lance generate-catalog pour la liste complète des 24 nouveaux artistes.
  Écrit un rapport JSON dans scripts/report.json au fur et à mesure (reprise possible).
*/
const fs = require('fs');
const path = require('path');
const { generateCatalog, fetchArtistImage, fetchArtist } = require('./generate-catalog');

const ROOT = path.join(__dirname, '..');
const REPORT_PATH = path.join(__dirname, 'report.json');

const ARTISTS = [
  ['ninho', 5542343, 'Ninho'],
  ['la-mano19', 184573357, 'La Mano1.9'],
  ['pnl', 1519461, 'PNL'],
  ['gazo', 8873540, 'Gazo'],
  ['werenoi', 121672292, 'Werenoi'],
  ['koba-lad', 14621667, 'Koba LaD'],
  ['la-rvfleuze', 174484227, 'La Rvfleuze'],
  ['sdm', 604107, 'SDM'],
  ['tiakola', 13918545, 'Tiakola'],
  ['zola', 13962203, 'Zola'],
  ['mhd', 881751, 'MHD'],
  ['gambi', 65303292, 'Gambi'],
  ['beendo-z', 109312472, 'Beendo Z'],
  ['gims', 4429712, 'GIMS'],
  ['plk', 1479842, 'PLK'],
  ['niska', 5288900, 'Niska'],
  ['houdi', 48443532, 'Houdi'],
  ['vald', 5175734, 'Vald'],
  ['theodora', 13820325, 'Theodora'],
  ['nono-la-grinta', 194146027, 'Nono la Grinta'],
  ['black-cat', 378625491, 'Black Cat'],
  ['l2b', 13790723, 'L2B'],
  ['damso', 9197980, 'Damso'],
  ['jolagreen23', 132179322, 'Jolagreen23']
];

function loadReport() {
  try { return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8')); } catch { return {}; }
}
function saveReport(report) {
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
}

async function run() {
  const report = loadReport();
  const onlySlug = process.argv[2];
  for (const [slug, artistId, expectedName] of ARTISTS) {
    if (onlySlug && slug !== onlySlug) continue;
    if (report[slug] && report[slug].done) {
      console.log(`= ${slug} déjà généré, skip (relancer avec --force pour refaire)`);
      continue;
    }
    console.log(`\n→ ${slug} (Deezer ${artistId}, attendu: ${expectedName})`);
    try {
      const { artist, tracks, stats } = await generateCatalog(slug, artistId, m => console.log(m));
      if (!artist || !artist.name) throw new Error('Réponse artiste Deezer invalide');
      fs.writeFileSync(path.join(ROOT, `${slug}.json`), JSON.stringify(tracks, null, 2) + '\n');
      console.log(`  ${tracks.length} morceaux écrits dans ${slug}.json (stats: ${JSON.stringify(stats)})`);

      let image = null;
      let imageError = null;
      try {
        image = await fetchArtistImage(artist, slug);
        console.log(`  image: ${image.filename} (${image.source})`);
      } catch (err) {
        imageError = err.message;
        console.warn(`  ! image indisponible: ${err.message}`);
      }

      report[slug] = {
        done: true,
        expectedName,
        deezerName: artist.name,
        nameMismatch: artist.name.toLowerCase().replace(/\s+/g, '') !== expectedName.toLowerCase().replace(/\s+/g, ''),
        artistId,
        trackCount: tracks.length,
        stats,
        image: image ? { filename: image.filename, source: image.source } : null,
        imageError
      };
      saveReport(report);
    } catch (err) {
      console.error(`  !! ÉCHEC ${slug}: ${err.message}`);
      report[slug] = { done: false, error: err.message, artistId, expectedName };
      saveReport(report);
    }
  }
  console.log('\nTerminé.');
}

run().catch(err => { console.error(err); process.exit(1); });
