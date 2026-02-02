'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';

// =====================================================
// CONFETTI COMPONENT
// =====================================================
// =====================================================
// LYRICS DATA
// =====================================================
const SONG_LYRICS = [
  { text: "I wake up exhausted, even in the mornin'", startTime: 9600 },
  { text: "Like I'm made out of decaf, I'm barely runnin'", startTime: 13280 },
  { text: "Oh, and I hate parties, it's just too many bodies", startTime: 17060 },
  { text: "I don't like small talk, I'm always leavin' early", startTime: 20380 },
  { text: "Then I met you and my eyes changed", startTime: 24240 },
  { text: "And now you're in my eye range, I'm gunnin' for you", startTime: 27980 },
  { text: "You changed my heart in a big way", startTime: 31220 },
  { text: "Now every day's a celebration and I wanna say", startTime: 34950 },
  { text: "When you're around, it's already alright", startTime: 38560 },
  { text: "Already alright, like a radio", startTime: 41610 },
  { text: "I'm tunin' into you (I'm tunin' into you)", startTime: 44750 },
  { text: "You're turnin' me on (you're turnin' me on)", startTime: 48150 },
  { text: "And I'm my own person, not like I need protection", startTime: 53330 },
  { text: "It's just that I wanna change and go in your direction", startTime: 56780 },
  { text: "God, you're a laser beam, you're all my teen dreams", startTime: 60340 },
  { text: "And if I knew you in school, you'd be too cool for me", startTime: 64090 },
  { text: "Then I met you and my eyes changed", startTime: 67820 },
  { text: "And now you're in my eye range, I'm gunnin' for you", startTime: 71540 },
  { text: "You changed my heart in a big way", startTime: 75080 },
  { text: "Now every day's a celebration and I wanna say", startTime: 78550 },
  { text: "When you're around, it's already alright", startTime: 82230 },
  { text: "Already alright, like a radio", startTime: 85230 },
  { text: "I'm tunin' into you (I'm tunin' into you)", startTime: 88380 },
  { text: "You're turnin' me on (you're turnin' me on)", startTime: 91650 },
  { text: "You make me feel like I could dance all night", startTime: 96750 },
  { text: "Already all night, like a live wire", startTime: 99770 },
  { text: "I'm always louder with you (I'm always louder with you)", startTime: 102820 },
  { text: "Keep turnin' me on (keep turnin' me on)", startTime: 106110 },
  { text: "Up, up, up, up", startTime: 111510 },
  { text: "When I get down, when I get down, when I get", startTime: 113440 },
  { text: "Up, up, up, up", startTime: 118860 },
  { text: "When I get down, when I get down, when I (ow!)", startTime: 120820 },
  { text: "When you're around, it's already alright", startTime: 125920 },
  { text: "Already alright, like a radio", startTime: 128830 },
  { text: "I'm tunin' into you (I'm tunin' into you)", startTime: 131920 },
  { text: "You're turnin' me on (you're turnin' me on)", startTime: 135370 },
  { text: "You make me feel like I could dance all night", startTime: 140320 },
  { text: "Already all night, like a live wire", startTime: 143430 },
  { text: "I'm always louder with you (I'm always louder with you)", startTime: 146530 },
  { text: "Keep turnin' me on (keep turnin' me on)", startTime: 149880 },
  { text: "When you're around, it's already alright (keep turnin' me up, up, keep turnin' me)", startTime: 154950 },
  { text: "Already alright, like a radio (keep turnin' me up, up, keep turnin' me)", startTime: 158090 },
  { text: "I'm tunin' into you (I'm tunin' into you)", startTime: 161040 },
  { text: "You're turnin' me on (you're turnin' me on)", startTime: 164290 },
  { text: "You make me feel like I could dance all night (keep turnin' me up, up, keep turnin' me)", startTime: 169270 },
  { text: "Already all night, like a live wire (keep turnin' me up, up, keep turnin' me)", startTime: 172480 },
  { text: "I'm always louder with you (I'm always louder with you)", startTime: 175680 },
  { text: "Keep turnin' me on (keep turnin' me on)", startTime: 178900 },
  { text: "When you're around, it's already alright", startTime: 184030 },
  { text: "Already alright, like a radio", startTime: 186970 },
  { text: "I'm tunin' into you (I'm tunin' into you)", startTime: 190160 },
  { text: "You're turnin' me on (you're turnin' me)", startTime: 193260 },
];

// =====================================================
// ALTERNATING LYRICS COMPONENT
// =====================================================
const AlternatingLyrics = ({ currentPosition, isPlaying }: { currentPosition: number; isPlaying: boolean }) => {
  const [currentLineIndex, setCurrentLineIndex] = useState<number>(-1);
  const [displayedLine, setDisplayedLine] = useState<{ text: string; side: 'left' | 'right'; key: number } | null>(null);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    // Find the current line based on position
    const lineIndex = SONG_LYRICS.findIndex((line, index) => {
      const nextLine = SONG_LYRICS[index + 1];
      if (nextLine) {
        return currentPosition >= line.startTime && currentPosition < nextLine.startTime;
      }
      return currentPosition >= line.startTime;
    });

    if (lineIndex !== -1 && lineIndex !== currentLineIndex) {
      setCurrentLineIndex(lineIndex);
      // Alternate sides based on line index
      const side = lineIndex % 2 === 0 ? 'left' : 'right';
      setDisplayedLine({ text: SONG_LYRICS[lineIndex].text, side, key: lineIndex });
    }
  }, [currentPosition, isPlaying, currentLineIndex]);

  // Reset when not playing
  useEffect(() => {
    if (!isPlaying) {
      setCurrentLineIndex(-1);
      setDisplayedLine(null);
    }
  }, [isPlaying]);

  if (!displayedLine || !isPlaying) {
    return null;
  }

  return (
    <>
      {/* Left side lyrics */}
      <div 
        className="fixed top-1/2 -translate-y-1/2 z-10 pointer-events-none"
        style={{ left: '3%', maxWidth: '280px' }}
      >
        {displayedLine.side === 'left' && (
          <div
            key={`left-${displayedLine.key}`}
            className="text-white text-xl font-semibold text-left animate-lyric-fade"
            style={{
              textShadow: '0 2px 8px rgba(0, 0, 0, 0.8), 0 0 20px rgba(255, 255, 255, 0.2)',
              lineHeight: '1.4',
            }}
          >
            {displayedLine.text}
          </div>
        )}
      </div>

      {/* Right side lyrics */}
      <div 
        className="fixed top-1/2 -translate-y-1/2 z-10 pointer-events-none"
        style={{ right: '3%', maxWidth: '280px' }}
      >
        {displayedLine.side === 'right' && (
          <div
            key={`right-${displayedLine.key}`}
            className="text-white text-xl font-semibold text-right animate-lyric-fade"
            style={{
              textShadow: '0 2px 8px rgba(0, 0, 0, 0.8), 0 0 20px rgba(255, 255, 255, 0.2)',
              lineHeight: '1.4',
            }}
          >
            {displayedLine.text}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes lyricFade {
          0% {
            opacity: 0;
            transform: translateY(10px);
          }
          15% {
            opacity: 1;
            transform: translateY(0);
          }
          85% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 0;
            transform: translateY(-10px);
          }
        }
        .animate-lyric-fade {
          animation: lyricFade 3.5s ease-in-out forwards;
        }
      `}</style>
    </>
  );
};

// =====================================================
// CONFETTI COMPONENT
// =====================================================
const Confetti = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces: Array<{
      x: number;
      y: number;
      rotation: number;
      color: string;
      size: number;
      speedX: number;
      speedY: number;
      rotationSpeed: number;
    }> = [];

    const colors = ['#ec4899', '#f472b6', '#fb7185', '#f43f5e', '#e879f9', '#c084fc', '#fff'];

    // Create confetti pieces
    for (let i = 0; i < 150; i++) {
      pieces.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 200,
        y: canvas.height / 2,
        rotation: Math.random() * 360,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 10 + 5,
        speedX: (Math.random() - 0.5) * 20,
        speedY: Math.random() * -20 - 10,
        rotationSpeed: (Math.random() - 0.5) * 10,
      });
    }

    let animationId: number;
    const gravity = 0.5;
    const friction = 0.99;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      pieces.forEach((piece) => {
        piece.speedY += gravity;
        piece.speedX *= friction;
        piece.x += piece.speedX;
        piece.y += piece.speedY;
        piece.rotation += piece.rotationSpeed;

        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate((piece.rotation * Math.PI) / 180);
        ctx.fillStyle = piece.color;
        ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size / 2);
        ctx.restore();
      });

      // Continue animation if pieces are still visible
      if (pieces.some(p => p.y < canvas.height + 100)) {
        animationId = requestAnimationFrame(animate);
      }
    };

    animate();

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-50 pointer-events-none"
    />
  );
};

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
// RUNAWAY BUTTON COMPONENT (Contained within box)
// =====================================================
const RunawayButton = ({ onClick, containerRef: externalContainerRef }: { onClick: () => void; containerRef: React.RefObject<HTMLDivElement | null> }) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [initialized, setInitialized] = useState(false);
  const runAwayDistance = 80;
  const moveDistance = 70;
  const buttonWidth = 85;
  const buttonHeight = 48;
  const padding = 20;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!externalContainerRef.current || !buttonRef.current) return;

      const containerRect = externalContainerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;
      
      // Mouse position relative to container
      const mouseX = e.clientX - containerRect.left;
      const mouseY = e.clientY - containerRect.top;
      
      // Button center position
      const buttonCenterX = position.x + buttonWidth / 2;
      const buttonCenterY = position.y + buttonHeight / 2;

      const distanceX = mouseX - buttonCenterX;
      const distanceY = mouseY - buttonCenterY;
      const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

      if (distance < runAwayDistance) {
        // Direction away from mouse
        const angle = Math.atan2(distanceY, distanceX);
        
        let newX = position.x - Math.cos(angle) * moveDistance;
        let newY = position.y - Math.sin(angle) * moveDistance;

        // Bounds within container
        const minX = padding;
        const maxX = containerWidth - buttonWidth - padding;
        const minY = padding;
        const maxY = containerHeight - buttonHeight - padding;

        // Clamp to bounds
        newX = Math.max(minX, Math.min(maxX, newX));
        newY = Math.max(minY, Math.min(maxY, newY));

        setPosition({ x: newX, y: newY });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [position, externalContainerRef]);

  // Initialize position when container is ready
  useEffect(() => {
    if (!initialized && externalContainerRef.current) {
      const containerRect = externalContainerRef.current.getBoundingClientRect();
      // Start at bottom center of container, next to Yes button
      setPosition({
        x: (containerRect.width - buttonWidth) / 2 + 60, // Offset right from center
        y: containerRect.height - buttonHeight - 20, // Near bottom, matching Yes button
      });
      setInitialized(true);
    }
  }, [initialized, externalContainerRef]);

  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      className="absolute px-8 py-3 text-base font-medium rounded-xl bg-[#252529] hover:bg-[#303035] text-[#8f8f9d] hover:text-white transition-all duration-200 ease-out"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      No
    </button>
  );
};

// =====================================================
// MUSIC PLAYER (Matching original site style exactly)
// =====================================================
const ValentinePlayer = ({ onPlayStateChange, onPositionChange }: { onPlayStateChange: (isPlaying: boolean) => void; onPositionChange: (position: number) => void }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const volumeBarRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.30); // Default 30%
  const [isMuted, setIsMuted] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(0.30);
  const [isDragging, setIsDragging] = useState(false);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
  };

  // Set initial volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, []);

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
      const positionMs = audio.currentTime * 1000;
      setProgress(positionMs);
      onPositionChange(positionMs);
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
  }, [onPlayStateChange, onPositionChange]);

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

  const handleVolumeUpdate = useCallback((clientX: number) => {
    if (volumeBarRef.current && audioRef.current) {
      const rect = volumeBarRef.current.getBoundingClientRect();
      const newValue = Math.max(0, Math.min(1, (clientX - rect.left) / volumeBarRef.current.offsetWidth));
      setVolume(newValue);
      audioRef.current.volume = newValue;
      if (newValue > 0) {
        setIsMuted(false);
      }
    }
  }, []);

  const handleVolumeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handleVolumeUpdate(e.clientX);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        handleVolumeUpdate(e.clientX);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleVolumeUpdate]);

  const handleMuteToggle = () => {
    if (audioRef.current) {
      if (isMuted) {
        setVolume(previousVolume);
        audioRef.current.volume = previousVolume;
      } else {
        setPreviousVolume(volume);
        setVolume(0);
        audioRef.current.volume = 0;
      }
      setIsMuted(!isMuted);
    }
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
            Radio
          </div>
          
          {/* Artist Name */}
          <div className="text-[#8f8f9d] text-[13px] my-[2px] mb-2 truncate">
            Bershy
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
                src="/shahd/cover.jpeg"
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

        {/* Volume Control */}
        <div className="absolute top-full right-[15px] left-[15px] p-[13px] px-[22px] bg-[#151518] rounded-b-[15px] z-[1] flex items-center gap-[15px] h-[50px] border border-white/10 border-t-0">
          <div 
            className="w-6 h-6 flex items-center justify-center rounded-md bg-transparent cursor-pointer transition-all duration-200 hover:bg-[#252529] hover:text-white group"
            onClick={handleMuteToggle}
          >
            <i 
              className={`fas text-[16px] text-[#8f8f9d] group-hover:text-white transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]
                ${isMuted ? "fa-volume-mute" : volume === 0 ? "fa-volume-off" : volume < 0.5 ? "fa-volume-down" : "fa-volume-up"}`}
            ></i>
          </div>
          
          <div 
            ref={volumeBarRef}
            className="relative flex-1 h-1 rounded bg-[#252529] cursor-pointer group"
            onClick={(e) => handleVolumeUpdate(e.clientX)}
            onMouseDown={handleVolumeMouseDown}
          >
            <div 
              className="absolute top-0 bottom-0 left-0 bg-white transition-[width] duration-200 ease-linear rounded group-hover:bg-white"
              style={{ width: `${volume * 100}%` }}
            ></div>
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
  const [currentPosition, setCurrentPosition] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleYes = () => {
    setShowResponse('yes');
  };

  const handleNo = () => {
    setShowResponse('no');
  };

  if (showResponse === 'yes') {
    return (
      <main className="min-h-screen bg-black relative overflow-hidden">
        <Confetti />
        <ValentineHeartAnimation isPlaying={true} />
        <AlternatingLyrics currentPosition={currentPosition} isPlaying={isMusicPlaying} />
        <div className="relative z-10 flex flex-col items-center justify-center min-h-screen text-center px-4">
          <h1 className="text-5xl md:text-7xl font-bold text-[#f1f1f1] mb-4">
            YAYYYY
          </h1>
          <p className="text-xl md:text-2xl text-[#8f8f9d]">
            Happy Valentine&apos;s Day
          </p>
        </div>
        <ValentinePlayer onPlayStateChange={setIsMusicPlaying} onPositionChange={setCurrentPosition} />
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
      
      {/* Question - above the heart */}
      <div className="fixed top-[18%] left-1/2 -translate-x-1/2 z-10 text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-[#f1f1f1]">
          Shahd, will you be my Valentine?
        </h1>
      </div>

      {/* Container for buttons - covers area around heart */}
      <div 
        ref={containerRef}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none"
        style={{ width: '600px', height: '70vh', maxHeight: '600px' }}
      >
        {/* Yes button - positioned at bottom left of container */}
        <button
          onClick={handleYes}
          className="absolute px-8 py-3 text-base font-medium rounded-xl bg-[#ec4899] hover:bg-[#f472b6] text-white transition-colors duration-200 pointer-events-auto"
          style={{ 
            left: '50%', 
            bottom: '20px',
            transform: 'translateX(calc(-50% - 60px))'
          }}
        >
          Yes
        </button>

        {/* No button - starts next to Yes, moves within container */}
        <div className="pointer-events-auto">
          <RunawayButton onClick={handleNo} containerRef={containerRef} />
        </div>
      </div>

      {/* Hint text under buttons */}
      <div className="fixed bottom-[8%] left-1/2 -translate-x-1/2 z-10">
        <p className="text-[#5a5a6e] text-sm italic">no seems a little shy</p>
      </div>

      {/* Lyrics */}
      <AlternatingLyrics currentPosition={currentPosition} isPlaying={isMusicPlaying} />

      {/* Music Player */}
      <ValentinePlayer onPlayStateChange={setIsMusicPlaying} onPositionChange={setCurrentPosition} />
    </main>
  );
}
