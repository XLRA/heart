import { useState, useRef, useEffect, useCallback } from 'react';

interface VolumeControlProps {
  volume: number;
  isMuted: boolean;
  onVolumeChange: (volume: number) => void;
  onMuteToggle: () => void;
}

const VolumeControl = ({ volume, isMuted, onVolumeChange, onMuteToggle }: VolumeControlProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const volumeBarRef = useRef<HTMLDivElement>(null);

  const handleVolumeUpdate = useCallback((clientX: number) => {
    if (volumeBarRef.current) {
      const rect = volumeBarRef.current.getBoundingClientRect();
      const newValue = Math.max(0, Math.min(1, (clientX - rect.left) / volumeBarRef.current.offsetWidth));
      onVolumeChange(newValue);
    }
  }, [onVolumeChange]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
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

  return (
    <div className="absolute top-full right-[15px] left-[15px] p-[13px] px-[22px] bg-[#151518] rounded-b-[15px] z-[1] flex items-center gap-[15px] h-[50px] border border-white/10 border-t-0">
      <div 
        className="w-6 h-6 flex items-center justify-center rounded-md bg-transparent cursor-pointer transition-all duration-200 hover:bg-[#252529] hover:text-white group"
        onClick={onMuteToggle}
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
        onMouseDown={handleMouseDown}
      >
        <div 
          className="absolute top-0 bottom-0 left-0 bg-white transition-[width] duration-200 ease-linear rounded group-hover:bg-white"
          style={{ width: `${volume * 100}%` }}
        ></div>
      </div>
    </div>
  );
};

export default VolumeControl;

