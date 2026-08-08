/*
  Générateur de catalogue Deezer pour un artiste.
  Usage : node scripts/generate-catalog.js <slug> <deezerArtistId>
  Produit <slug>.json à la racine (même format que fave.json/kerchak.json/...)
  et télécharge la photo officielle Deezer dans assets/artists/<slug>.<ext>.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'assets', 'artists');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchJson(url, retries = 4) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && data.error) throw new Error(data.error.message || `Deezer error ${data.error.type || ''}`);
      return data;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
}

// Titres à écarter : pas de vraies chansons distinctes pour un blind test.
const EXCLUDE_TITLE_RE = /\b(remix|instrumental|acapella|karaok\w*|live)\b/i;

// Retire les suffixes "(feat. X)" et les annotations de session Deezer
// ("(Enregistré à Paris)") pour ne garder que le titre devinable.
function cleanTitle(title) {
  return title
    .replace(/\s*[\(\[](?:feat\.?|ft\.?|featuring)\s+[^)\]]*[\)\]]/gi, '')
    .replace(/\s*[\(\[]enregistr[ée]e?\s+[àa]\s+[^)\]]*[\)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function normaliseTitle(title) {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(feat[^)]*\)/gi, '')
    .replace(/\((radio edit|clean|explicit|bonus version|version bonus|réédition|reedition|edition deluxe|deluxe|extension|edit)[^)]*\)/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchArtist(artistId) {
  return fetchJson(`https://api.deezer.com/artist/${artistId}`);
}

async function fetchAlbums(artistId) {
  const data = await fetchJson(`https://api.deezer.com/artist/${artistId}/albums?limit=1000`);
  return (data.data || []).filter(album => album.record_type !== 'compilation');
}

async function fetchAlbumTracks(albumId) {
  const data = await fetchJson(`https://api.deezer.com/album/${albumId}/tracks?limit=1000`);
  return data.data || [];
}

async function generateCatalog(slug, artistId, log = console.log) {
  const artist = await fetchArtist(artistId);
  const albums = await fetchAlbums(artistId);
  albums.sort((a, b) => new Date(a.release_date || 0) - new Date(b.release_date || 0));

  const tracks = [];
  const seenByIsrc = new Map();
  const seenByNormTitle = new Map();
  const stats = {
    albumsSeen: albums.length,
    albumsFailed: 0,
    excludedNotArtist: 0,
    excludedFiltered: 0,
    excludedNoPreview: 0,
    duplicatesSkipped: 0
  };

  for (const album of albums) {
    let albumTracks;
    try {
      albumTracks = await fetchAlbumTracks(album.id);
    } catch (err) {
      stats.albumsFailed++;
      log(`  ! album ${album.id} (${album.title}) inaccessible : ${err.message}`);
      await sleep(150);
      continue;
    }
    for (const track of albumTracks) {
      if (!track.title) continue;
      if (Number(track.artist?.id) !== Number(artistId)) { stats.excludedNotArtist++; continue; }
      if (EXCLUDE_TITLE_RE.test(track.title)) { stats.excludedFiltered++; continue; }
      if (!track.preview) { stats.excludedNoPreview++; continue; }
      const normTitle = normaliseTitle(track.title);
      if (!normTitle) continue;
      if (track.isrc && seenByIsrc.has(track.isrc)) { stats.duplicatesSkipped++; continue; }
      if (seenByNormTitle.has(normTitle)) { stats.duplicatesSkipped++; continue; }

      const releaseDate = album.release_date || '';
      const year = releaseDate ? Number(releaseDate.slice(0, 4)) : null;
      const entry = {
        id: `${slug}-${track.id}`,
        title: cleanTitle(track.title),
        project: album.title,
        year,
        releaseDate,
        deezerTrackId: track.id
      };
      tracks.push(entry);
      if (track.isrc) seenByIsrc.set(track.isrc, entry);
      seenByNormTitle.set(normTitle, entry);
    }
    await sleep(150);
  }

  tracks.sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''));
  return { artist, tracks, stats };
}

async function downloadArtistImage(url, destBaseNoExt) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) throw new Error(`Contenu non-image (${contentType})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2000) throw new Error('Image trop petite / suspecte');
  const ext = contentType.includes('png') ? '.png' : '.jpg';
  const dest = `${destBaseNoExt}${ext}`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return { filename: path.basename(dest), bytes: buf.length };
}

async function fetchArtistImage(artist, slug) {
  const candidates = [artist.picture_xl, artist.picture_big, artist.picture_medium].filter(Boolean);
  let lastError = null;
  for (const url of candidates) {
    try {
      const result = await downloadArtistImage(url, path.join(ASSETS_DIR, slug));
      return { ...result, source: url === artist.picture_xl ? 'picture_xl' : (url === artist.picture_big ? 'picture_big' : 'picture_medium') };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Aucune image disponible');
}

module.exports = { generateCatalog, fetchArtistImage, fetchArtist, fetchJson, normaliseTitle, cleanTitle };

if (require.main === module) {
  const [slug, artistIdRaw] = process.argv.slice(2);
  if (!slug || !artistIdRaw) {
    console.error('Usage: node scripts/generate-catalog.js <slug> <deezerArtistId>');
    process.exit(1);
  }
  (async () => {
    console.log(`→ ${slug} (Deezer ${artistIdRaw})`);
    const { artist, tracks, stats } = await generateCatalog(slug, Number(artistIdRaw));
    fs.writeFileSync(path.join(ROOT, `${slug}.json`), JSON.stringify(tracks, null, 2) + '\n');
    console.log(`  ${tracks.length} morceaux écrits dans ${slug}.json`);
    console.log(`  stats: ${JSON.stringify(stats)}`);
    try {
      const image = await fetchArtistImage(artist, slug);
      console.log(`  image: ${image.filename} (${image.source}, ${image.bytes} octets)`);
    } catch (err) {
      console.warn(`  ! image indisponible: ${err.message}`);
    }
  })().catch(err => { console.error(err); process.exit(1); });
}
