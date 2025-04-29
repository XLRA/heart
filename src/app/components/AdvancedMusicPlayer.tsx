'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';

interface Song {
  title: string;
  artist: string;
  url: string;
  cover: string;
}

const AdvancedMusicPlayer = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekPosition, setSeekPosition] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showSeekTime, setShowSeekTime] = useState(false);
  const [seekTimeValue, setSeekTimeValue] = useState('00:00');
  const [seekHoverPosition, setSeekHoverPosition] = useState(0);
  const [volume, setVolume] = useState(0.47);
  const [previousVolume, setPreviousVolume] = useState(0.47);
  const [isMuted, setIsMuted] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(true);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const bufferingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastBufferingTimeRef = useRef<number>(0);
  const volumeBarRef = useRef<HTMLDivElement>(null);

  const songs: Song[] = [
    {
      title: "What You Need",
      artist: "The Weeknd - Durdnn Remix",
      url: "/music/song1.mp3",
      cover: "/covers/cover1.jpg"
    },
    {
      title: "No. 1 Party Anthem",
      artist: "Arctic Monkeys",
      url: "/music/song2.mp3",
      cover: "/covers/cover2.png"
    }
  ];

  const formatTime = (time: number): string => {
    if (isNaN(time)) return '00:00';
    
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    
    return `${minutes < 10 ? '0' + minutes : minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const playNextSong = () => {
    const nextIndex = (currentSongIndex + 1) % songs.length;
    setCurrentSongIndex(nextIndex);
  };

  const playPreviousSong = () => {
    const prevIndex = (currentSongIndex - 1 + songs.length) % songs.length;
    setCurrentSongIndex(prevIndex);
  };

  const handleSeekHover = (e: React.MouseEvent<HTMLDivElement>) => {
    const seekBarContainer = e.currentTarget;
    const rect = seekBarContainer.getBoundingClientRect();
    const seekT = e.clientX - rect.left;
    const seekLoc = duration * (seekT / seekBarContainer.offsetWidth);
    
    setSeekHoverPosition(seekT);
    
    const cM = seekLoc / 60;
    const ctMinutes = Math.floor(cM);
    const ctSeconds = Math.floor(seekLoc - ctMinutes * 60);
    
    if (ctMinutes < 0 || ctSeconds < 0) return;
    
    const formattedMinutes = ctMinutes < 10 ? `0${ctMinutes}` : `${ctMinutes}`;
    const formattedSeconds = ctSeconds < 10 ? `0${ctSeconds}` : `${ctSeconds}`;
    
    setSeekTimeValue(`${formattedMinutes}:${formattedSeconds}`);
    setShowSeekTime(true);
  };

  const handleSeekLeave = () => {
    setSeekHoverPosition(0);
    setShowSeekTime(false);
  };

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const seekBarContainer = e.currentTarget;
    const rect = seekBarContainer.getBoundingClientRect();
    const seekT = e.clientX - rect.left;
    const seekLoc = duration * (seekT / seekBarContainer.offsetWidth);
    
    if (audioRef.current) {
      audioRef.current.currentTime = seekLoc;
      setCurrentTime(seekLoc);
    }
    
    setSeekHoverPosition(0);
    setShowSeekTime(false);
  };

  const handleVolumeChange = (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
    if (volumeBarRef.current) {
      const rect = volumeBarRef.current.getBoundingClientRect();
      const volumeValue = Math.max(0, Math.min(1, (e.clientX - rect.left) / volumeBarRef.current.offsetWidth));
      
      if (audioRef.current) {
        audioRef.current.volume = volumeValue;
        setVolume(volumeValue);
      }
    }
  };

  const handleVolumeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingVolume(true);
    handleVolumeChange(e);
  };

  const handleVolumeMouseMove = (e: MouseEvent) => {
    if (isDraggingVolume) {
      handleVolumeChange(e);
    }
  };

  const handleVolumeMouseUp = () => {
    setIsDraggingVolume(false);
  };

  const handleMuteToggle = () => {
    if (isMuted) {
      setVolume(previousVolume);
      if (audioRef.current) {
        audioRef.current.volume = previousVolume;
      }
    } else {
      setPreviousVolume(volume);
      setVolume(0);
      if (audioRef.current) {
        audioRef.current.volume = 0;
      }
    }
    setIsMuted(!isMuted);
  };

  const handleImageLoad = () => {
    setImageLoaded(true);
  };

  const handleImageError = () => {
    console.error('Image loading error for:', songs[currentSongIndex].cover);
    setImageLoaded(false);
  };

  const checkBuffering = () => {
    if (bufferingIntervalRef.current) {
      clearInterval(bufferingIntervalRef.current);
    }
    
    bufferingIntervalRef.current = setInterval(() => {
      const now = new Date().getTime();
      
      if (now === 0 || lastBufferingTimeRef.current - now > 1000) {
        setIsBuffering(true);
      } else {
        setIsBuffering(false);
      }
      
      lastBufferingTimeRef.current = now;
    }, 100);
  };

  const updateCurrentTime = () => {
    if (audioRef.current) {
      const currentTimeValue = audioRef.current.currentTime;
      const durationValue = audioRef.current.duration;
      
      setCurrentTime(currentTimeValue);
      setDuration(durationValue);
      setSeekPosition((currentTimeValue / durationValue) * 100);
      
      if (currentTimeValue >= durationValue) {
        setIsPlaying(false);
        setSeekPosition(0);
        setCurrentTime(0);
      }
    }
  };

  useEffect(() => {
    if (isDraggingVolume) {
      window.addEventListener('mousemove', handleVolumeMouseMove);
      window.addEventListener('mouseup', handleVolumeMouseUp);
    }
    
    return () => {
      window.removeEventListener('mousemove', handleVolumeMouseMove);
      window.removeEventListener('mouseup', handleVolumeMouseUp);
    };
  }, [isDraggingVolume, handleVolumeMouseMove]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.src = songs[currentSongIndex].url;
      audioRef.current.volume = volume;
      
      if (isPlaying) {
        audioRef.current.play();
        checkBuffering();
      }
    }
    
    return () => {
      if (bufferingIntervalRef.current) {
        clearInterval(bufferingIntervalRef.current);
      }
    };
  }, [currentSongIndex, isPlaying, songs, volume]);

  useEffect(() => {
    setImageLoaded(true);
  }, [currentSongIndex]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    const handleTimeUpdate = () => updateCurrentTime();
    const handleLoadedMetadata = () => setDuration(audio.duration);
    const handleEnded = () => setIsPlaying(false);
    
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  return (
    <div className="fixed bottom-8 left-0 z-50" style={{ padding: '0 0 0 20px' }}>
      <div id="player-container" style={{
        width: '430px',
        height: '100px',
        position: 'relative',
        marginBottom: '50px'
      }}>
        <div id="player-track" style={{
          position: 'absolute',
          top: isPlaying ? '-92px' : '0',
          right: '15px',
          left: '15px',
          padding: '13px 22px 10px 184px',
          backgroundColor: '#151518',
          borderRadius: '15px 15px 0 0',
          transition: '0.3s ease top',
          zIndex: 1,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderBottom: 'none'
        }}>
          <div id="album-name" style={{
            color: '#f1f1f1',
            fontSize: '17px',
            fontWeight: 'bold'
          }}>{songs[currentSongIndex].title}</div>
          <div id="track-name" style={{
            color: '#8f8f9d',
            fontSize: '13px',
            margin: '2px 0 8px 0'
          }}>{songs[currentSongIndex].artist}</div>
          <div id="track-time" style={{
            height: '12px',
            marginBottom: '2px',
            overflow: 'hidden'
          }}>
            <div id="current-time" style={{
              float: 'left',
              color: isPlaying ? '#8f8f9d' : 'transparent',
              fontSize: '11px',
              backgroundColor: isPlaying ? 'transparent' : '#252529',
              borderRadius: '10px',
              transition: '0.3s ease all'
            }}>{formatTime(currentTime)}</div>
            <div id="track-length" style={{
              float: 'right',
              color: isPlaying ? '#8f8f9d' : 'transparent',
              fontSize: '11px',
              backgroundColor: isPlaying ? 'transparent' : '#252529',
              borderRadius: '10px',
              transition: '0.3s ease all'
            }}>{formatTime(duration)}</div>
          </div>
          <div id="seek-bar-container" 
            style={{
              position: 'relative',
              height: '4px',
              borderRadius: '4px',
              backgroundColor: '#252529',
              cursor: 'pointer'
            }}
            onMouseMove={handleSeekHover}
            onMouseLeave={handleSeekLeave}
            onClick={handleSeekClick}
          >
            <div id="seek-time" style={{
              position: 'absolute',
              top: '-29px',
              color: '#fff',
              fontSize: '12px',
              whiteSpace: 'pre',
              padding: '5px 6px',
              borderRadius: '4px',
              display: showSeekTime ? 'block' : 'none',
              backgroundColor: '#151518',
              left: `${seekHoverPosition}px`,
              marginLeft: '-21px'
            }}>{seekTimeValue}</div>
            <div id="s-hover" style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: `${seekHoverPosition}px`,
              opacity: 0.2,
              zIndex: 2,
              backgroundColor: '#8f8f9d'
            }}></div>
            <div id="seek-bar" style={{
              content: '',
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: `${seekPosition}%`,
              backgroundColor: '#8f8f9d',
              transition: '0.2s ease width',
              zIndex: 1
            }}></div>
          </div>
        </div>
        <div id="player-content" style={{
          position: 'relative',
          height: '100%',
          backgroundColor: '#101012',
          boxShadow: '0 30px 80px #101012',
          borderRadius: '15px',
          zIndex: 2,
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <div id="album-art" style={{
            position: 'absolute',
            top: isPlaying ? '-60px' : '-40px',
            width: '115px',
            height: '115px',
            marginLeft: '40px',
            transform: 'rotateZ(0)',
            transition: '0.3s ease all',
            boxShadow: isPlaying ? '0 0 0 4px #23232b, 0 30px 50px -15px #23232b' : '0 0 0 10px #18181f',
            borderRadius: '50%',
            overflow: 'hidden',
            backgroundColor: '#151518'
          }}>
            <Image 
              src={songs[currentSongIndex].cover}
              alt={`${songs[currentSongIndex].title} cover`}
              width={64}
              height={64}
              onLoad={handleImageLoad}
              onError={handleImageError}
              className="rounded-lg"
            />
            <div id="buffer-box" style={{
              position: 'absolute',
              top: '50%',
              right: 0,
              left: 0,
              height: '13px',
              color: '#fff',
              fontSize: '13px',
              fontFamily: 'Helvetica',
              textAlign: 'center',
              fontWeight: 'bold',
              lineHeight: 1,
              padding: '6px',
              margin: '-12px auto 0 auto',
              backgroundColor: 'rgba(36, 36, 48, 0.7)',
              opacity: isBuffering ? 1 : 0,
              zIndex: 2
            }}>Buffering ...</div>
          </div>
          <div id="player-controls" style={{
            width: '250px',
            height: '100%',
            margin: '0 5px 0 141px',
            float: 'right',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div className="control" style={{
              width: '33.333%',
              display: 'flex',
              justifyContent: 'center',
              padding: '12px 0'
            }}>
              <div 
                className="button" 
                onClick={playPreviousSong}
                style={{
                  width: '76px',
                  height: '76px',
                  backgroundColor: 'transparent',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <i style={{
                  color: '#b0b3c6',
                  fontSize: '26px'
                }} className="fas fa-backward"></i>
              </div>
            </div>
            <div className="control" style={{
              width: '33.333%',
              display: 'flex',
              justifyContent: 'center',
              padding: '12px 0'
            }}>
              <div 
                className="button" 
                onClick={togglePlay}
                style={{
                  width: '76px',
                  height: '76px',
                  backgroundColor: 'transparent',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <i style={{
                  color: '#b0b3c6',
                  fontSize: '26px'
                }} className={isPlaying ? "fas fa-pause" : "fas fa-play"}></i>
              </div>
            </div>
            <div className="control" style={{
              width: '33.333%',
              display: 'flex',
              justifyContent: 'center',
              padding: '12px 0'
            }}>
              <div 
                className="button" 
                onClick={playNextSong}
                style={{
                  width: '76px',
                  height: '76px',
                  backgroundColor: 'transparent',
                  borderRadius: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <i style={{
                  color: '#b0b3c6',
                  fontSize: '26px'
                }} className="fas fa-forward"></i>
              </div>
            </div>
          </div>
        </div>
        <div id="volume-control" style={{
          position: 'absolute',
          top: '100%',
          right: '15px',
          left: '15px',
          padding: '13px 22px',
          backgroundColor: '#151518',
          borderRadius: '0 0 15px 15px',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: '15px',
          height: '50px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderTop: 'none'
        }}>
          <div 
            className="button"
            onClick={handleMuteToggle}
            style={{
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              backgroundColor: 'transparent',
              cursor: 'pointer'
            }}
          >
            <i style={{
              color: '#8f8f9d',
              fontSize: '16px'
            }} className={isMuted ? "fas fa-volume-mute" : volume === 0 ? "fas fa-volume-off" : volume < 0.5 ? "fas fa-volume-down" : "fas fa-volume-up"}></i>
          </div>
          <div id="volume-bar-container" 
            ref={volumeBarRef}
            style={{
              position: 'relative',
              flex: 1,
              height: '4px',
              borderRadius: '4px',
              backgroundColor: '#252529',
              cursor: 'pointer'
            }}
            onClick={handleVolumeChange}
            onMouseDown={handleVolumeMouseDown}
          >
            <div id="volume-bar" style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: `${volume * 100}%`,
              backgroundColor: '#fff',
              transition: '0.2s ease width',
              borderRadius: '4px'
            }}></div>
          </div>
        </div>
      </div>
      <audio ref={audioRef} />
      <style jsx>{`
        @keyframes rotateAlbumArt {
          0% { transform: rotateZ(0); }
          100% { transform: rotateZ(360deg); }
        }
        
        #album-art:before {
          content: "";
          position: absolute;
          top: 50%;
          right: 0;
          left: 0;
          width: 20px;
          height: 20px;
          margin: -10px auto 0 auto;
          background-color: #252529;
          border-radius: 50%;
          box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.2);
          z-index: 2;
        }

        .button {
          transition: all 0.2s ease;
        }
        
        .button i {
          transition: all 0.2s ease;
        }
        
        .button:hover {
          background-color: #252529 !important;
        }
        
        .button:hover i {
          color: #ffffff !important;
        }

        #volume-bar-container:hover #volume-bar {
          background-color: #ffffff !important;
        }
      `}</style>
    </div>
  );
};

export default AdvancedMusicPlayer; 