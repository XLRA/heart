'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Callback() {
  const router = useRouter();

  useEffect(() => {
    const handleCallback = () => {
      const hash = window.location.hash;
      const params = new URLSearchParams(hash.substring(1));
      
      const accessToken = params.get('access_token');
      const tokenType = params.get('token_type');
      const expiresIn = params.get('expires_in');
      const error = params.get('error');

      if (error) {
        console.error('Spotify authentication error:', error);
        router.push('/');
        return;
      }

      if (accessToken) {
        localStorage.setItem('spotify_access_token', accessToken);
        if (tokenType) localStorage.setItem('spotify_token_type', tokenType);
        if (expiresIn) localStorage.setItem('spotify_expires_in', expiresIn);
        
        // Redirect back to home page
        router.push('/');
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
