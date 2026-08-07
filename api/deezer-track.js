module.exports = async function handler(request, response) {
  const id = String(request.query?.id || '');
  if (!/^\d+$/.test(id)) {
    return response.status(400).json({ error: 'Invalid Deezer track id' });
  }

  try {
    const deezerResponse = await fetch(`https://api.deezer.com/track/${id}`);
    if (!deezerResponse.ok) return response.status(502).json({ error: 'Deezer unavailable' });
    const track = await deezerResponse.json();
    if (!track.preview) return response.status(404).json({ error: 'No preview available' });
    let album = track.album || {};
    if (album.id) {
      const albumResponse = await fetch(`https://api.deezer.com/album/${album.id}`);
      if (albumResponse.ok) album = { ...album, ...(await albumResponse.json()) };
    }
    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return response.status(200).json({
      preview: track.preview,
      title: track.title,
      cover: `/api/deezer-cover?id=${id}`,
      albumTitle: album.title || '',
      albumTracks: album.nb_tracks || null,
      releaseDate: track.release_date || album.release_date || ''
    });
  } catch {
    return response.status(502).json({ error: 'Deezer unavailable' });
  }
};
