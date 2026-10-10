import { NextRequest, NextResponse } from 'next/server';
import {
  TtlCache,
  reccoFeatures,
  spotifyPreview,
  deezerByIsrc,
  deezerSearch,
  itunesPreview,
  type AudioFeatures,
  type PreviewClip,
} from '../../../services/trackIntel/server';

// Track Intelligence, fast half: audio features + a playable preview clip of
// the exact track. The (slower) whole-song beat map lives at ./beatmap so the
// client can start analyzing the clip while MusicBrainz/AcousticBrainz work.

export interface TrackIntelResponse {
  id: string;
  isrc: string | null;
  features: AudioFeatures | null;
  /** Best available tempo estimate (ReccoBeats, else Deezer). */
  tempo: number | null;
  preview: PreviewClip | null;
}

const cache = new TtlCache<TrackIntelResponse>(1000);
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const id = sp.get('id') || '';
  const name = (sp.get('name') || '').slice(0, 200);
  const artist = (sp.get('artist') || '').slice(0, 200);
  const durationMs = Number(sp.get('durationMs')) || undefined;
  if (!SPOTIFY_ID.test(id)) {
    return NextResponse.json({ error: 'Invalid Spotify track id' }, { status: 400 });
  }

  const cached = cache.get(id);
  if (cached) return respond(cached);

  const [features, spPreview] = await Promise.all([reccoFeatures(id), spotifyPreview(id)]);
  let isrc = features?.isrc || null;
  let tempo = features?.tempo || null;
  let preview: PreviewClip | null = spPreview;

  if (!preview || !tempo || !isrc) {
    const dz = (isrc ? await deezerByIsrc(isrc) : null) || (artist && name ? await deezerSearch(artist, name, durationMs) : null);
    if (dz) {
      isrc = isrc || dz.isrc || null;
      if (!tempo && dz.bpm && dz.bpm > 40) tempo = dz.bpm;
      if (!preview && dz.preview) preview = { url: dz.preview, source: 'deezer' };
    }
  }
  if (!preview && artist && name) preview = await itunesPreview(artist, name, durationMs);

  const body: TrackIntelResponse = { id, isrc, features, tempo, preview };
  // Deezer preview URLs are signed and expire ~15 minutes after issue.
  const ttl = preview?.source === 'deezer' ? 5 * 60_000 : 24 * 3600_000;
  cache.set(id, body, ttl);
  return respond(body);
}

function respond(body: TrackIntelResponse) {
  const maxAge = body.preview?.source === 'deezer' ? 300 : 86400;
  return NextResponse.json(body, {
    headers: { 'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}` },
  });
}
