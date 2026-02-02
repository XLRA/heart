'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';

// =====================================================
// HEART ANIMATION COMPONENT (Valentine's themed)
// =====================================================
const ValentineHeartAnimation = ({ isPlaying = false }: { isPlaying?: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPlayingRef = useRef(isPlaying);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    let width = canvas.width = window.innerWidth * dpr;
    let height = canvas.height = window.innerHeight * dpr;
    
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    const heartPosition = (rad: number): [number, number] => {
      return [
        Math.pow(Math.sin(rad), 3),
        -(15 * Math.cos(rad) - 5 * Math.cos(2 * rad) - 2 * Math.cos(3 * rad) - Math.cos(4 * rad))
      ];
    };

    const scaleAndTranslate = (pos: [number, number], sx: number, sy: number, dx: number, dy: number): [number, number] => {
      return [dx + pos[0] * sx, dy + pos[1] * sy];
    };

    const handleResize = () => {
      width = canvas.width = window.innerWidth * dpr;
      height = canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "rgba(0,0,0,1)";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    const traceCount = 50;
    const pointsOrigin: [number, number][] = [];
    const dr = 0.1;

    for (let i = 0; i < Math.PI * 2; i += dr) {
      pointsOrigin.push(scaleAndTranslate(heartPosition(i), 210, 13, 0, 0));
    }
    for (let i = 0; i < Math.PI * 2; i += dr) {
      pointsOrigin.push(scaleAndTranslate(heartPosition(i), 150, 9, 0, 0));
    }
    for (let i = 0; i < Math.PI * 2; i += dr) {
      pointsOrigin.push(scaleAndTranslate(heartPosition(i), 90, 5, 0, 0));
    }

    const heartPointsCount = pointsOrigin.length;
    const targetPoints: [number, number][] = [];

    const pulse = (kx: number, ky: number) => {
      for (let i = 0; i < pointsOrigin.length; i++) {
        targetPoints[i] = [
          kx * pointsOrigin[i][0] + window.innerWidth / 2,
          ky * pointsOrigin[i][1] + window.innerHeight / 2
        ];
      }
    };

    interface Particle {
      vx: number;
      vy: number;
      R: number;
      speed: number;
      q: number;
      D: number;
      force: number;
      f: string;
      trace: { x: number; y: number }[];
    }

    const valentineColors = [
      'hsla(350, 90%, 60%, 0.5)',
      'hsla(340, 85%, 55%, 0.45)',
      'hsla(330, 80%, 50%, 0.4)',
      'hsla(320, 75%, 45%, 0.35)',
      'hsla(0, 85%, 55%, 0.5)',
      'hsla(355, 90%, 65%, 0.45)',
      'hsla(345, 85%, 60%, 0.4)',
      'hsla(335, 80%, 55%, 0.35)',
    ];

    const e: Particle[] = [];
    for (let i = 0; i < heartPointsCount; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      e[i] = {
        vx: 0,
        vy: 0,
        R: 2,
        speed: Math.random() + 5,
        q: ~~(Math.random() * heartPointsCount),
        D: 2 * (i % 2) - 1,
        force: 0.2 * Math.random() + 0.7,
        f: valentineColors[i % valentineColors.length],
        trace: Array(traceCount).fill(null).map(() => ({ x, y })),
      };
    }

    const config = {
      traceK: 0.4,
      timeDelta: 0.005
    };

    let time = 0;
    let animationId: number;

    const loop = () => {
      const naturalHeartbeat = Math.sin(time * 2) * 0.15 + 1;
      const musicPulse = isPlayingRef.current ? 1 + Math.sin(time * 4) * 0.1 : 1;
      
      const finalPulse = naturalHeartbeat * musicPulse;
      const clampedPulse = Math.max(0.8, Math.min(1.4, finalPulse));
      
      pulse(clampedPulse, clampedPulse);
      
      time += ((Math.sin(time)) < 0 ? 12 : (naturalHeartbeat > 1.2) ? .3 : 1.5) * config.timeDelta;
      
      const trailOpacity = 0.08;
      ctx.fillStyle = `rgba(0,0,0,${trailOpacity})`;
      ctx.fillRect(0, 0, width, height);

      for (let i = e.length; i--;) {
        const u = e[i];
        const q = targetPoints[u.q];
        const dx = u.trace[0].x - q[0];
        const dy = u.trace[0].y - q[1];
        const length = Math.sqrt(dx * dx + dy * dy);

        if (10 > length) {
          if (0.95 < Math.random()) {
            u.q = ~~(Math.random() * heartPointsCount);
          } else {
            if (0.99 < Math.random()) {
              u.D *= -1;
            }
            u.q += u.D;
            u.q %= heartPointsCount;
            if (0 > u.q) {
              u.q += heartPointsCount;
            }
          }
        }

        u.vx += -dx / length * u.speed;
        u.vy += -dy / length * u.speed;
        u.trace[0].x += u.vx;
        u.trace[0].y += u.vy;
        u.vx *= u.force;
        u.vy *= u.force;

        for (let k = 0; k < u.trace.length - 1;) {
          const T = u.trace[k];
          const N = u.trace[++k];
          N.x -= config.traceK * (N.x - T.x);
          N.y -= config.traceK * (N.y - T.y);
        }

        ctx.fillStyle = u.f;
        for (let k = 0; k < u.trace.length; k++) {
          ctx.fillRect(u.trace[k].x, u.trace[k].y, 1, 1);
        }
      }

      animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 z-0" />;
};

// =====================================================
// RUNAWAY BUTTON COMPONENT (Stays within viewport)
// =====================================================
const RunawayButton = ({ onClick }: { onClick: () => void }) => {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const runAwayDistance = 100;
  const moveDistance = 100;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!buttonRef.current) return;

      const rect = buttonRef.current.getBoundingClientRect();
      const buttonCenterX = rect.left + rect.width / 2;
      const buttonCenterY = rect.top + rect.height / 2;

      const distanceX = e.clientX - buttonCenterX;
      const distanceY = e.clientY - buttonCenterY;
      const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

      if (distance < runAwayDistance) {
        // Direction away from mouse
        const angle = Math.atan2(distanceY, distanceX);
        
        // Calculate new offset
        let newOffsetX = offset.x - Math.cos(angle) * moveDistance;
        let newOffsetY = offset.y - Math.sin(angle) * moveDistance;

        // Get current button position and viewport
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const btnW = rect.width;
        const btnH = rect.height;
        const pad = 20;

        // Calculate where button would end up
        const baseLeft = rect.left - offset.x; // Original position without offset
        const baseTop = rect.top - offset.y;
        
        const newLeft = baseLeft + newOffsetX;
        const newTop = baseTop + newOffsetY;
        const newRight = newLeft + btnW;
        const newBottom = newTop + btnH;

        // Bounce off walls
        if (newLeft < pad) {
          newOffsetX = pad - baseLeft;
        } else if (newRight > viewportW - pad) {
          newOffsetX = viewportW - pad - btnW - baseLeft;
        }

        if (newTop < pad) {
          newOffsetY = pad - baseTop;
        } else if (newBottom > viewportH - pad) {
          newOffsetY = viewportH - pad - btnH - baseTop;
        }

        setOffset({ x: newOffsetX, y: newOffsetY });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [offset]);

  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      className="px-8 py-3 text-base font-medium rounded-xl bg-[#252529] hover:bg-[#303035] text-[#8f8f9d] hover:text-white transition-transform duration-200 ease-out"
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px)`,
      }}
    >
      No
    </button>
  );
};

// =====================================================
// MUSIC PLAYER (Matching original site style exactly)
// =====================================================
const ValentinePlayer = ({ onPlayStateChange }: { onPlayStateChange: (isPlaying: boolean) => void }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => {
      setIsPlaying(true);
      onPlayStateChange(true);
    };
    const handlePause = () => {
      setIsPlaying(false);
      onPlayStateChange(false);
    };
    const handleTimeUpdate = () => {
      setProgress(audio.currentTime * 1000);
    };
    const handleLoadedMetadata = () => {
      setDuration(audio.duration * 1000);
    };
    const handleEnded = () => {
      audio.currentTime = 0;
      audio.play();
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [onPlayStateChange]);

  const formatTime = (timeMs: number): string => {
    if (isNaN(timeMs)) return '00:00';
    const time = timeMs / 1000;
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes < 10 ? '0' + minutes : minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
  };

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const seekT = e.clientX - rect.left;
    const seekPercent = seekT / e.currentTarget.offsetWidth;
    audioRef.current.currentTime = (duration / 1000) * seekPercent;
  };

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;
  const isActive = isPlaying;

  return (
    <div className="fixed bottom-8 left-0 z-50 pl-5">
      <div id="player-container" className="w-[500px] h-[100px] relative mb-[50px]">
        
        {/* Track Info Panel - slides up when active */}
        <div 
          className={`absolute top-0 right-[15px] left-[15px] pt-[13px] pb-[10px] pl-[184px] pr-[22px] bg-[#151518] rounded-t-[15px] z-[1] border border-white/10 border-b-0 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform backface-hidden
            ${isActive ? '-translate-y-[92px]' : 'translate-y-0'}`}
        >
          {/* Track Name */}
          <div className="text-[#f1f1f1] text-[17px] font-bold truncate mb-1">
            Our Song
          </div>
          
          {/* Artist Name */}
          <div className="text-[#8f8f9d] text-[13px] my-[2px] mb-2 truncate">
            For Shahd
          </div>

          {/* Time Indicators */}
          <div className="h-[12px] mb-[2px] overflow-hidden">
            <div 
              className={`float-left text-[11px] rounded-[10px] transition-all duration-300 ease-all ${isActive ? 'text-[#8f8f9d] bg-transparent' : 'text-transparent bg-[#252529]'}`}
            >
              {formatTime(progress)}
            </div>
            <div 
              className={`float-right text-[11px] rounded-[10px] transition-all duration-300 ease-all ${isActive ? 'text-[#8f8f9d] bg-transparent' : 'text-transparent bg-[#252529]'}`}
            >
              {formatTime(duration)}
            </div>
          </div>

          {/* Seek Bar */}
          <div 
            className="relative h-1 rounded bg-[#252529] cursor-pointer group"
            onClick={handleSeekClick}
          >
            <div 
              className="absolute top-0 bottom-0 left-0 bg-[#8f8f9d] transition-all duration-200 ease-linear z-[1] rounded"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Player Content - Main box */}
        <div className="relative h-full bg-[#101012] shadow-[0_30px_80px_#101012] rounded-[15px] z-[2] border border-white/10">
          
          {/* Album Art */}
          <div 
            className={`absolute w-[115px] h-[115px] ml-[40px] rounded-full overflow-hidden bg-[#151518] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[top,box-shadow]
              ${isActive 
                ? '-top-[60px] shadow-[0_0_0_4px_#23232b,0_30px_50px_-15px_#23232b]' 
                : '-top-[40px] shadow-[0_0_0_10px_#18181f]'
              }`}
          >
            {/* Center hole for the record look */}
            <div className="absolute top-1/2 left-0 right-0 w-5 h-5 -mt-2.5 mx-auto bg-[#252529] rounded-full shadow-[inset_0_0_0_2px_rgba(255,255,255,0.2)] z-[2]" />
            
            <div className={`w-full h-full ${isActive ? 'animate-rotate-album' : ''}`}>
              <Image 
                src="/shahd/cover.jpg"
                alt="Album cover"
                width={115}
                height={115}
                className="w-full h-full object-cover backface-hidden"
              />
            </div>
          </div>

          {/* Controls */}
          <div className="w-[320px] h-full mx-[5px] ml-[141px] float-right overflow-hidden flex items-center justify-between">
            {/* Previous Button */}
            <div className="w-1/3 flex justify-center py-3">
              <div 
                className="w-[76px] h-[76px] bg-transparent rounded-2xl cursor-pointer flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[#252529] group"
              >
                <i className="fas fa-backward text-[#b0b3c6] text-[26px] transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:text-white"></i>
              </div>
            </div>

            {/* Play/Pause Button */}
            <div className="w-1/3 flex justify-center py-3">
              <div 
                className="w-[76px] h-[76px] bg-transparent rounded-2xl cursor-pointer flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[#252529] group"
                onClick={togglePlay}
              >
                <i className={`${isPlaying ? "fas fa-pause" : "fas fa-play"} text-[#b0b3c6] text-[26px] transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:text-white`}></i>
              </div>
            </div>

            {/* Next Button */}
            <div className="w-1/3 flex justify-center py-3">
              <div 
                className="w-[76px] h-[76px] bg-transparent rounded-2xl cursor-pointer flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[#252529] group"
              >
                <i className="fas fa-forward text-[#b0b3c6] text-[26px] transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:text-white"></i>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Audio element - song in /public/shahd/song.mp3 */}
      <audio ref={audioRef} src="/shahd/song.mp3" preload="auto" />
    </div>
  );
};

// =====================================================
// MAIN VALENTINE'S PROPOSAL PAGE
// =====================================================
export default function ValentineProposal() {
  const [showResponse, setShowResponse] = useState<'yes' | 'no' | null>(null);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);

  const handleYes = () => {
    setShowResponse('yes');
  };

  const handleNo = () => {
    setShowResponse('no');
  };

  if (showResponse === 'yes') {
    return (
      <main className="min-h-screen bg-black relative overflow-hidden">
        <ValentineHeartAnimation isPlaying={true} />
        <div className="relative z-10 flex flex-col items-center justify-center min-h-screen text-center px-4">
          <h1 className="text-5xl md:text-7xl font-bold text-[#f1f1f1] mb-6">
            I knew it
          </h1>
          <p className="text-xl md:text-2xl text-[#8f8f9d]">
            Happy Valentine&apos;s Day, Shahd
          </p>
        </div>
        <ValentinePlayer onPlayStateChange={setIsMusicPlaying} />
      </main>
    );
  }

  if (showResponse === 'no') {
    return (
      <main className="min-h-screen bg-black relative overflow-hidden">
        <ValentineHeartAnimation isPlaying={false} />
        <div className="relative z-10 flex flex-col items-center justify-center min-h-screen text-center px-4">
          <h1 className="text-3xl font-bold text-[#8f8f9d] mb-4">
            How did you even click that
          </h1>
          <button
            onClick={() => setShowResponse(null)}
            className="px-6 py-3 bg-[#252529] text-[#f1f1f1] rounded-xl hover:bg-[#303035] transition-colors"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black relative overflow-hidden">
      <ValentineHeartAnimation isPlaying={isMusicPlaying} />
      
      {/* Question - positioned at bottom center, above the heart */}
      <div className="fixed bottom-[200px] left-1/2 -translate-x-1/2 z-10 text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-[#f1f1f1] mb-8">
          Will you be my Valentine?
        </h1>

        {/* Buttons */}
        <div className="flex gap-6 items-center justify-center">
          <button
            onClick={handleYes}
            className="px-8 py-3 text-base font-medium rounded-xl bg-[#ec4899] hover:bg-[#f472b6] text-white transition-colors duration-200"
          >
            Yes
          </button>

          <RunawayButton onClick={handleNo} />
        </div>
      </div>

      {/* Music Player */}
      <ValentinePlayer onPlayStateChange={setIsMusicPlaying} />
    </main>
  );
}
