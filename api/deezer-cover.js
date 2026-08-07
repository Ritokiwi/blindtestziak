module.exports = async function handler(request, response) {
  const id = String(request.query?.id || '');
  if (!/^\d+$/.test(id)) return response.status(400).send('Invalid Deezer track id');

  try {
    const trackResponse = await fetch(`https://api.deezer.com/track/${id}`);
    if (!trackResponse.ok) return response.status(404).send('Cover unavailable');
    const track = await trackResponse.json();
    const coverUrl = track.album?.cover_big || track.album?.cover_medium;
    if (!coverUrl) return response.status(404).send('Cover unavailable');
    const coverResponse = await fetch(coverUrl);
    if (!coverResponse.ok) return response.status(404).send('Cover unavailable');
    response.setHeader('Content-Type', coverResponse.headers.get('content-type') || 'image/jpeg');
    response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return response.status(200).end(Buffer.from(await coverResponse.arrayBuffer()));
  } catch {
    return response.status(502).send('Cover unavailable');
  }
};
