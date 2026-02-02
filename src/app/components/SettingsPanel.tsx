'use client';

import { useState } from 'react';
import { useSettings, ParticleLevel, LyricsMode, FrameRate, CanvasResolution } from '../context/SettingsContext';

const SettingsPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { 
    particleLevel, setParticleLevel, 
    lyricsMode, setLyricsMode,
    frameRate, setFrameRate,
    canvasResolution, setCanvasResolution
  } = useSettings();

  const particleLevels: { value: ParticleLevel; label: string; description: string }[] = [
    { value: 'low', label: 'Low', description: 'Best performance' },
    { value: 'medium', label: 'Medium', description: 'Balanced' },
    { value: 'high', label: 'High', description: 'Full quality' },
  ];

  const frameRates: { value: FrameRate; label: string }[] = [
    { value: '30', label: '30 FPS' },
    { value: '60', label: '60 FPS' },
  ];

  const resolutions: { value: CanvasResolution; label: string }[] = [
    { value: '0.5', label: '50%' },
    { value: '0.75', label: '75%' },
    { value: '1', label: '100%' },
  ];

  const lyricsModes: { value: LyricsMode; label: string; description: string }[] = [
    { value: 'center', label: 'Center', description: 'Bottom center' },
    { value: 'alternating', label: 'Alternating', description: 'Left & right' },
  ];

  return (
    <>
      {/* Settings Toggle Button - Bottom right, above player */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-8 right-8 z-50 w-11 h-11 rounded-xl bg-[#1a1a1d] border border-white/10 flex items-center justify-center cursor-pointer transition-all duration-200 hover:bg-[#252529] group shadow-lg"
        title="Settings"
      >
        <i className={`fas fa-cog text-[#6b6b7a] text-lg transition-all duration-300 group-hover:text-[#8f8f9d] ${isOpen ? 'rotate-90' : ''}`}></i>
      </button>

      {/* Settings Panel - Opens above the button */}
      <div 
        className={`fixed bottom-24 right-8 z-50 w-[280px] bg-[#101012] rounded-[15px] border border-white/10 shadow-[0_30px_80px_#101012] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          isOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'
        }`}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10">
          <h3 className="text-[#f1f1f1] text-[15px] font-bold">Settings</h3>
          <p className="text-[#8f8f9d] text-[11px] mt-1">Customize your experience</p>
        </div>

        {/* Particle Quality */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#f1f1f1] text-[13px] font-medium">Particle Quality</span>
            <i className="fas fa-sparkles text-[#8f8f9d] text-xs"></i>
          </div>
          <div className="flex gap-2">
            {particleLevels.map((level) => (
              <button
                key={level.value}
                onClick={() => setParticleLevel(level.value)}
                className={`flex-1 py-2 px-3 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                  particleLevel === level.value
                    ? 'bg-[#252529] text-white border border-white/20'
                    : 'bg-transparent text-[#8f8f9d] border border-transparent hover:bg-[#1a1a1d] hover:text-white'
                }`}
                title={level.description}
              >
                {level.label}
              </button>
            ))}
          </div>
          <p className="text-[#5a5a6e] text-[10px] mt-2 italic">
            {particleLevel === 'low' && 'Reduced particles for better performance'}
            {particleLevel === 'medium' && 'Balanced quality and performance'}
            {particleLevel === 'high' && 'Maximum visual quality'}
          </p>
        </div>

        {/* Frame Rate */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#f1f1f1] text-[13px] font-medium">Frame Rate</span>
            <i className="fas fa-film text-[#8f8f9d] text-xs"></i>
          </div>
          <div className="flex gap-2">
            {frameRates.map((rate) => (
              <button
                key={rate.value}
                onClick={() => setFrameRate(rate.value)}
                className={`flex-1 py-2 px-3 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                  frameRate === rate.value
                    ? 'bg-[#252529] text-white border border-white/20'
                    : 'bg-transparent text-[#8f8f9d] border border-transparent hover:bg-[#1a1a1d] hover:text-white'
                }`}
              >
                {rate.label}
              </button>
            ))}
          </div>
          <p className="text-[#5a5a6e] text-[10px] mt-2 italic">
            {frameRate === '30' && 'Lower CPU usage, slight choppiness'}
            {frameRate === '60' && 'Smooth animation, higher CPU usage'}
          </p>
        </div>

        {/* Canvas Resolution */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#f1f1f1] text-[13px] font-medium">Resolution</span>
            <i className="fas fa-expand text-[#8f8f9d] text-xs"></i>
          </div>
          <div className="flex gap-2">
            {resolutions.map((res) => (
              <button
                key={res.value}
                onClick={() => setCanvasResolution(res.value)}
                className={`flex-1 py-2 px-3 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                  canvasResolution === res.value
                    ? 'bg-[#252529] text-white border border-white/20'
                    : 'bg-transparent text-[#8f8f9d] border border-transparent hover:bg-[#1a1a1d] hover:text-white'
                }`}
              >
                {res.label}
              </button>
            ))}
          </div>
          <p className="text-[#5a5a6e] text-[10px] mt-2 italic">
            {canvasResolution === '0.5' && 'Best performance, lower quality'}
            {canvasResolution === '0.75' && 'Good balance of quality and speed'}
            {canvasResolution === '1' && 'Full resolution, highest quality'}
          </p>
        </div>

        {/* Lyrics Display */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#f1f1f1] text-[13px] font-medium">Lyrics Display</span>
            <i className="fas fa-align-center text-[#8f8f9d] text-xs"></i>
          </div>
          <div className="flex gap-2">
            {lyricsModes.map((mode) => (
              <button
                key={mode.value}
                onClick={() => setLyricsMode(mode.value)}
                className={`flex-1 py-2 px-3 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                  lyricsMode === mode.value
                    ? 'bg-[#252529] text-white border border-white/20'
                    : 'bg-transparent text-[#8f8f9d] border border-transparent hover:bg-[#1a1a1d] hover:text-white'
                }`}
                title={mode.description}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className="text-[#5a5a6e] text-[10px] mt-2 italic">
            {lyricsMode === 'center' && 'Lyrics appear at the bottom center'}
            {lyricsMode === 'alternating' && 'Lyrics alternate left and right'}
          </p>
        </div>
      </div>

      {/* Backdrop to close panel */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
};

export default SettingsPanel;
