/*
  Complète un catalogue existant avec les morceaux réellement absents de la
  discographie Deezer actuelle (titre inconnu du catalogue), sans toucher aux
  morceaux déjà présents ni dupliquer les chansons qui existent déjà sous un
  autre Deezer Track ID.
  Usage : node scripts/fill-gaps.js <slug> <catalogFile> <deezerArtistId>
*/
const fs = require('fs');
const path = require('path');
const { generateCatalog, normaliseTitle } = require('./generate-catalog');

const ROOT = path.join(__dirname, '..');

async function run() {
  const [slug, catalogFile, artistIdRaw] = process.argv.slice(2);
  if (!slug || !catalogFile || !artistIdRaw) {
    console.error('Usage: node scripts/fill-gaps.js <slug> <catalogFile> <deezerArtistId>');
    process.exit(1);
  }
  const catalogPath = path.join(ROOT, catalogFile);
  const current = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const hasIdField = Boolean(current[0]?.id);
  const currentTitles = new Set(current.map(s => normaliseTitle(s.title)));

  console.log(`→ ${slug}: ${current.length} morceaux actuels, régénération Deezer...`);
  const { tracks } = await generateCatalog(slug, Number(artistIdRaw), () => {});

  const toAdd = tracks.filter(t => !currentTitles.has(normaliseTitle(t.title)));
  console.log(`  ${toAdd.length} morceau(x) réellement absent(s) à ajouter :`);
  toAdd.forEach(t => console.log(`    + ${t.title} [${t.project}, ${t.releaseDate}]`));

  const merged = [...current, ...toAdd.map(t => {
    const entry = { title: t.title, project: t.project, year: t.year, releaseDate: t.releaseDate, deezerTrackId: t.deezerTrackId };
    return hasIdField ? { id: `${slug}-${t.deezerTrackId}`, ...entry } : entry;
  })];
  merged.sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''));

  fs.writeFileSync(catalogPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`  ${catalogFile} mis à jour : ${merged.length} morceaux au total.`);
}

run().catch(err => { console.error(err); process.exit(1); });
