export interface ReccoBeatsAudioFeatures {
  id: string;
  href: string;
  acousticness: number;
  danceability: number;
  energy: number;
  instrumentalness: number;
  key: number;
  liveness: number;
  loudness: number;
  mode: number;
  speechiness: number;
  tempo: number;
  valence: number;
}

export interface ReccoBeatsTrack {
  id: string;
  name: string;
  artists: Array<{
    name: string;
  }>;
  album: {
    name: string;
    images: Array<{ url: string }>;
  };
  duration_ms: number;
  external_urls: {
    spotify: string;
  };
}

export interface ReccoBeatsAlbum {
  id: string;
  name: string;
  artists: Array<{
    name: string;
  }>;
  images: Array<{ url: string }>;
  release_date: string;
  total_tracks: number;
}

export interface ReccoBeatsMultipleTracks {
  tracks: ReccoBeatsTrack[];
}

export interface ReccoBeatsError {
  error: {
    status: number;
    message: string;
  };
}
