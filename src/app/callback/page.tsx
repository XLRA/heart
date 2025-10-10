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
        router.push('/');
        return;
      }

      if (code) {
        try {
          console.log('Authorization code received:', code);
          
          // Exchange authorization code for access token
          const response = await fetch('/api/spotify/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ code }),
          });

          console.log('Token exchange response status:', response.status);

          if (!response.ok) {
            const errorText = await response.text();
            console.error('Token exchange failed:', errorText);
            throw new Error(`Failed to exchange code for token: ${errorText}`);
          }

          const data = await response.json();
          console.log('Token exchange successful:', data);
          
          localStorage.setItem('spotify_access_token', data.access_token);
          if (data.token_type) localStorage.setItem('spotify_token_type', data.token_type);
          if (data.expires_in) localStorage.setItem('spotify_expires_in', data.expires_in);
          
          console.log('Tokens stored in localStorage');
          
          // Dispatch custom event to notify context of token change
          window.dispatchEvent(new CustomEvent('spotifyTokenUpdated'));
          
          // Redirect back to home page
          router.push('/');
        } catch (error) {
          console.error('Error exchanging code for token:', error);
          router.push('/');
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
