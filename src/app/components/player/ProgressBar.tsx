import { useState, MouseEvent } from 'react';

interface ProgressBarProps {
  position: number; // in ms
  duration: number; // in ms
  onSeek: (position: number) => void;
  isActive: boolean;
}

const ProgressBar = ({ position, duration, onSeek, isActive }: ProgressBarProps) => {
  const [showSeekTime, setShowSeekTime] = useState(false);
  const [seekTimeValue, setSeekTimeValue] = useState('00:00');
  const [seekHoverPosition, setSeekHoverPosition] = useState(0);

  const formatTime = (time: number): string => {
    if (isNaN(time)) return '00:00';
    
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    
    return `${minutes < 10 ? '0' + minutes : minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
  };

  const handleSeekHover = (e: MouseEvent<HTMLDivElement>) => {
    const seekBarContainer = e.currentTarget;
    const rect = seekBarContainer.getBoundingClientRect();
    const seekT = e.clientX - rect.left;
    const currentDurationSec = duration / 1000;
    
    if (currentDurationSec <= 0) return;
    
    const seekLoc = currentDurationSec * (seekT / seekBarContainer.offsetWidth);
    
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

  const handleSeekClick = (e: MouseEvent<HTMLDivElement>) => {
    const seekBarContainer = e.currentTarget;
    const rect = seekBarContainer.getBoundingClientRect();
    const seekT = e.clientX - rect.left;
    const currentDurationSec = duration / 1000;
    
    if (currentDurationSec <= 0) return;
    
    const seekLoc = currentDurationSec * (seekT / seekBarContainer.offsetWidth);
    
    onSeek(seekLoc * 1000);
    
    setSeekHoverPosition(0);
    setShowSeekTime(false);
  };

  const progressPercent = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <>
      {/* Time Indicators */}
      <div className="h-[12px] mb-[2px] overflow-hidden">
        <div 
          className={`float-left text-[11px] rounded-[10px] transition-all duration-300 ease-all ${isActive ? 'text-[#8f8f9d] bg-transparent' : 'text-transparent bg-[#252529]'}`}
        >
          {formatTime(position / 1000)}
        </div>
        <div 
          className={`float-right text-[11px] rounded-[10px] transition-all duration-300 ease-all ${isActive ? 'text-[#8f8f9d] bg-transparent' : 'text-transparent bg-[#252529]'}`}
        >
          {formatTime(duration / 1000)}
        </div>
      </div>

      {/* Seek Bar */}
      <div 
        className="relative h-1 rounded bg-[#252529] cursor-pointer group"
        onMouseMove={handleSeekHover}
        onMouseLeave={handleSeekLeave}
        onClick={handleSeekClick}
      >
        {/* Seek Time Tooltip */}
        <div 
          className="absolute -top-[29px] text-white text-xs whitespace-pre px-1.5 py-[5px] rounded bg-[#151518] -ml-[21px]"
          style={{ 
            display: showSeekTime ? 'block' : 'none',
            left: `${seekHoverPosition}px`
          }}
        >
          {seekTimeValue}
        </div>
        
        {/* Hover Highlight */}
        <div 
          className="absolute top-0 bottom-0 left-0 opacity-20 z-[2] bg-[#8f8f9d]"
          style={{ width: `${seekHoverPosition}px` }}
        ></div>
        
        {/* Progress Bar */}
        <div 
          className="absolute top-0 bottom-0 left-0 bg-[#8f8f9d] transition-all duration-200 ease-linear z-[1] rounded"
          style={{ width: `${progressPercent}%` }}
        ></div>
      </div>
    </>
  );
};

export default ProgressBar;

