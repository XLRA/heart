import { NextRequest, NextResponse } from 'next/server';
import { TtlCache, acousticBrainzBeatMap, type BeatMap } from '../../../../services/trackIntel/server';

// Track Intelligence, slow half: whole-song beat positions from the
// AcousticBrainz archive (via MusicBrainz ISRC/search lookup). Immutable data,
// so both hits and misses cache for a long time.

const cache = new TtlCache<BeatMap | null>(2000);
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const isrcRaw = (sp.get('isrc') || '').toUpperCase();
  const isrc = ISRC.test(isrcRaw) ? isrcRaw : null;
  const name = (sp.get('name') || '').slice(0, 200);
  const artist = (sp.get('artist') || '').slice(0, 200);
  const durationMs = Number(sp.get('durationMs')) || undefined;
  if (!isrc && !(name && artist)) {
    return NextResponse.json({ error: 'Need isrc or name + artist' }, { status: 400 });
  }

  const key = `${isrc || ''}|${name.toLowerCase()}|${artist.toLowerCase()}|${durationMs ? Math.round(durationMs / 1000) : ''}`;
  let beatMap = cache.get(key);
  if (beatMap === undefined) {
    beatMap = await acousticBrainzBeatMap({ isrc, artist, title: name, durationMs });
    cache.set(key, beatMap, beatMap ? 30 * 86400_000 : 3 * 86400_000);
  }
  return NextResponse.json(
    { beatMap },
    { headers: { 'Cache-Control': `public, max-age=86400, s-maxage=${beatMap ? 2592000 : 259200}` } },
  );
}
