'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Callback() {
  const router = useRouter();

  useEffect(() => {
    const handleCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const error = urlParams.get('error');

      if (error) {
        console.error('Spotify authentication error:', error);
        router.push('/music');
        return;
      }

      if (code) {
        try {
          const response = await fetch('/api/spotify/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ code }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Token exchange failed:', response.status, errorText);
            throw new Error('Failed to exchange code for token');
          }

          // NOTE: never log the token payload -- it contains the access and
          // refresh tokens.
          const data = await response.json();

          localStorage.setItem('spotify_access_token', data.access_token);
          if (data.token_type) localStorage.setItem('spotify_token_type', data.token_type);
          if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
          if (data.expires_in) {
            // Store the absolute expiry so SpotifyContext can refresh proactively.
            localStorage.setItem(
              'spotify_token_expires_at',
              String(Date.now() + Number(data.expires_in) * 1000)
            );
          }

          window.dispatchEvent(new CustomEvent('spotifyTokenUpdated'));

          router.push('/music');
        } catch (error) {
          console.error('Error exchanging code for token:', error);
          router.push('/music');
        }
      }
    };

    handleCallback();
  }, [router]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-white text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p>Connecting to Spotify...</p>
      </div>
    </div>
  );
}
