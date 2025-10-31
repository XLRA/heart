'use client';

import { useEffect, useState, useRef } from 'react';

interface LyricsLine {
  text: string;
  startTime: number; // in milliseconds
  endTime: number;
}

interface LiveLyricsProps {
  currentTrackId: string | null;
  currentTrackName?: string;
  currentArtist?: string;
  currentPosition: number; // in milliseconds
  isPlaying: boolean;
}

const LiveLyrics = ({ 
  currentTrackId, 
  currentTrackName, 
  currentArtist, 
  currentPosition,
  isPlaying 
}: LiveLyricsProps) => {
  const [lyrics, setLyrics] = useState<LyricsLine[]>([]);
  const [currentLineIndex, setCurrentLineIndex] = useState<number>(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousTrackIdRef = useRef<string | null>(null);

  // Fetch lyrics when track changes
  useEffect(() => {
    if (!currentTrackId || !currentTrackName || !currentArtist) {
      setLyrics([]);
      setCurrentLineIndex(-1);
      setError(null);
      return;
    }

    // Only fetch if track has changed
    if (currentTrackId === previousTrackIdRef.current) {
      return;
    }

    previousTrackIdRef.current = currentTrackId;
    setIsLoading(true);
    setError(null);

    console.log(`[LiveLyrics] Fetching time-synced lyrics for track ID: ${currentTrackId}`);
    console.log(`[LiveLyrics] Track: "${currentTrackName}" by "${currentArtist}"`);

    // Fetch lyrics from our API endpoint using Spotify track ID
    const apiUrl = `/api/lyrics?trackId=${encodeURIComponent(currentTrackId)}&track=${encodeURIComponent(currentTrackName)}&artist=${encodeURIComponent(currentArtist)}`;
    
    console.log(`[LiveLyrics] API URL:`, apiUrl);
    
    fetch(apiUrl)
      .then(response => {
        console.log(`[LiveLyrics] Response status:`, response.status);
        if (!response.ok) {
          throw new Error('Lyrics not found');
        }
        return response.json();
      })
      .then(data => {
        console.log(`[LiveLyrics] Received data:`, data);
        if (data.lyrics && Array.isArray(data.lyrics)) {
          console.log(`[LiveLyrics] ✅ Loaded ${data.lyrics.length} lyrics lines from source: ${data.source}`);
          setLyrics(data.lyrics);
          setCurrentLineIndex(-1);
        } else {
          console.warn(`[LiveLyrics] ❌ No lyrics in response`);
          setError('No lyrics available');
          setLyrics([]);
        }
      })
      .catch(err => {
        console.error('[LiveLyrics] ❌ Error fetching lyrics:', err);
        setError('Lyrics not available');
        setLyrics([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [currentTrackId, currentTrackName, currentArtist]);

  // Update current line based on playback position
  useEffect(() => {
    if (!isPlaying || lyrics.length === 0) {
      return;
    }

    // Find the current line based on position
    // Handle both cases: endTime provided OR compare with next line's startTime
    const lineIndex = lyrics.findIndex(
      (line, index) => {
        const nextLine = lyrics[index + 1];
        
        // If endTime is provided and > 0, use it
        if (line.endTime && line.endTime > 0) {
          return currentPosition >= line.startTime && currentPosition < line.endTime;
        }
        
        // Otherwise, check if we're past this line's start but before next line's start
        if (nextLine) {
          return currentPosition >= line.startTime && currentPosition < nextLine.startTime;
        }
        
        // Last line: show if we've passed its start time
        return currentPosition >= line.startTime;
      }
    );

    if (lineIndex !== -1 && lineIndex !== currentLineIndex) {
      console.log(`[LiveLyrics] Line changed: ${currentLineIndex} → ${lineIndex} (position: ${(currentPosition/1000).toFixed(1)}s)`);
      console.log(`[LiveLyrics] New line: "${lyrics[lineIndex]?.text}"`);
      setCurrentLineIndex(lineIndex);
    }
  }, [currentPosition, lyrics, isPlaying, currentLineIndex]);

  // Don't render if no lyrics or error
  if (!currentTrackId || lyrics.length === 0) {
    return null;
  }

  const currentLine = currentLineIndex >= 0 && currentLineIndex < lyrics.length 
    ? lyrics[currentLineIndex] 
    : null;

  const nextLine = currentLineIndex >= 0 && currentLineIndex + 1 < lyrics.length 
    ? lyrics[currentLineIndex + 1] 
    : null;

  return (
    <div style={{
      position: 'fixed',
      top: '55%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 5,
      pointerEvents: 'none',
      width: '90%',
      maxWidth: '800px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '12px'
    }}>
      {/* Loading indicator */}
      {isLoading && (
        <div style={{
          color: 'rgba(255, 255, 255, 0.5)',
          fontSize: '16px',
          fontWeight: '500',
          textAlign: 'center',
          animation: 'fadeIn 0.3s ease-in-out'
        }}>
          Loading lyrics...
        </div>
      )}

      {/* Error message */}
      {error && !isLoading && (
        <div style={{
          color: 'rgba(255, 255, 255, 0.3)',
          fontSize: '14px',
          fontWeight: '400',
          textAlign: 'center',
          animation: 'fadeIn 0.3s ease-in-out'
        }}>
          {error}
        </div>
      )}

      {/* Current line (prominent) */}
      {currentLine && !isLoading && !error && (
        <div
          key={`current-${currentLineIndex}`}
          style={{
            color: '#ffffff',
            fontSize: '32px',
            fontWeight: '700',
            textAlign: 'center',
            textShadow: '0 2px 8px rgba(0, 0, 0, 0.8), 0 0 20px rgba(255, 255, 255, 0.3)',
            animation: 'lyricsSlideIn 0.4s ease-out',
            letterSpacing: '0.5px',
            lineHeight: '1.4',
            maxWidth: '100%',
            padding: '0 20px'
          }}
        >
          {currentLine.text}
        </div>
      )}

      {/* Next line (subtle preview) */}
      {nextLine && !isLoading && !error && (
        <div
          key={`next-${currentLineIndex + 1}`}
          style={{
            color: 'rgba(255, 255, 255, 0.4)',
            fontSize: '20px',
            fontWeight: '500',
            textAlign: 'center',
            textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)',
            animation: 'fadeIn 0.5s ease-in-out',
            letterSpacing: '0.3px',
            lineHeight: '1.4',
            maxWidth: '100%',
            padding: '0 20px'
          }}
        >
          {nextLine.text}
        </div>
      )}

      <style jsx>{`
        @keyframes lyricsSlideIn {
          0% {
            opacity: 0;
            transform: translateY(20px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeIn {
          0% {
            opacity: 0;
          }
          100% {
            opacity: 1;
          }
        }

        @keyframes fadeOut {
          0% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
};

export default LiveLyrics;

