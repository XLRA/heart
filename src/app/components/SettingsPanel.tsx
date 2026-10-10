'use client';

import { useState, useEffect, useCallback } from 'react';
import Icon from './Icon';
import { useSettings, ParticleLevel, LyricsMode, SYNC_NUDGE_LIMIT_MS } from '../context/SettingsContext';
import { useAudioVisualizer } from '../context/AudioVisualizerContext';
import { useReactivity, type ReactivityStatus } from '../context/ReactivityContext';

function describeStatus(status: ReactivityStatus): { title: string; detail: string; tone: 'good' | 'ok' | 'muted' } {
  switch (status.kind) {
    case 'idle':
      return { title: 'Waiting for music', detail: 'Play something and the heart locks onto it automatically.', tone: 'muted' };
    case 'loading':
      return { title: 'Analyzing this track…', detail: 'Reading its tempo, groove and beat map.', tone: 'muted' };
    case 'unavailable':
      return { title: 'No analysis for this track', detail: 'The heart keeps breathing; live capture below still works.', tone: 'muted' };
    case 'live': {
      const bpm = `${Math.round(status.bpm)} BPM`;
      const clip = status.clip === 'synthetic' ? ' · tempo only (no preview audio)' : '';
      if (status.source === 'full') return { title: `Full-song analysis · ${bpm}`, detail: 'Every beat known in advance.', tone: 'good' };
      if (status.source === 'beatmap') {
        return {
          title: `Beat-mapped · ${bpm}${clip}`,
          detail: status.beatMap === 'spotify-analysis'
            ? 'Spotify’s own beats, bars and sections.'
            : 'Whole-song beat map. Sync once to also lock the bar’s downbeat.',
          tone: 'good',
        };
      }
      if (status.source === 'synced') return { title: `Locked to the beat · ${bpm}${clip}`, detail: 'Synced to what your speakers play.', tone: 'good' };
      return { title: `Tempo & groove locked · ${bpm}${clip}`, detail: 'Tap T on the beat 4 times, or sync with the mic, to lock the timing.', tone: 'ok' };
    }
  }
}

const SettingsPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { particleLevel, setParticleLevel, lyricsMode, setLyricsMode, setUiHidden, syncNudgeMs, setSyncNudgeMs, micAutoSync, setMicAutoSync } = useSettings();
  const { tabAudioStream, setTabAudioStream, isSpotifyMode } = useAudioVisualizer();
  const { status, micSync, micSupported, syncWithMic, clearSync, tapMessage } = useReactivity();
  const statusInfo = describeStatus(status);
  const canSync = status.kind === 'live' && status.source !== 'full' && isSpotifyMode;
  const toast = tapMessage
    ?? (micSync.state === 'listening' ? `Listening… ${micSync.seconds}s` : null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  // Decided after mount: computing this during render made the server HTML
  // ("not supported") differ from the client's, a React hydration error.
  const [isTabCaptureSupported, setIsTabCaptureSupported] = useState(false);
  useEffect(() => {
    setIsTabCaptureSupported(!!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
  }, []);

  // Listen for the captured stream's audio track ending (user clicked "Stop sharing" in Chrome)
  useEffect(() => {
    if (!tabAudioStream) return;

    const audioTrack = tabAudioStream.getAudioTracks()[0];
    if (!audioTrack) return;

    const handleEnded = () => {
      setTabAudioStream(null);
    };

    audioTrack.addEventListener('ended', handleEnded);
    return () => {
      audioTrack.removeEventListener('ended', handleEnded);
    };
  }, [tabAudioStream, setTabAudioStream]);

  const startTabCapture = useCallback(async () => {
    setCaptureError(null);
    setIsCapturing(true);

    try {
      // Disable speech-tuned filters that mangle music: NS attenuates sustained tonal
      // content, EC introduces nonlinear distortion, AGC fights our own normalization.
      const displayMediaOptions: DisplayMediaStreamOptions = {
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000,
          channelCount: 2,
        } as MediaTrackConstraints,
      };
      // Chrome-specific hints: preferCurrentTab collapses the share picker to
      // a streamlined one-click "share this tab" dialog (Chrome 94+), which is
      // exactly what we want since the music plays in this tab. selfBrowserSurface
      // keeps the tab listed for browsers that ignore preferCurrentTab; system
      // audio is excluded because we only want this tab's output.
      Object.assign(displayMediaOptions, {
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        systemAudio: 'exclude',
      });
      const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

      // Stop the video track immediately -- we only need audio
      stream.getVideoTracks().forEach(track => track.stop());

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        setCaptureError('No audio track captured. Make sure you select "Share tab audio" in the picker.');
        stream.getTracks().forEach(track => track.stop());
        setIsCapturing(false);
        return;
      }

      setTabAudioStream(stream);
      setCaptureError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setCaptureError(null);
      } else {
        setCaptureError('Failed to capture tab audio. Try again.');
        console.error('Tab capture error:', err);
      }
    } finally {
      setIsCapturing(false);
    }
  }, [setTabAudioStream]);

  const stopTabCapture = useCallback(() => {
    if (tabAudioStream) {
      tabAudioStream.getTracks().forEach(track => track.stop());
      setTabAudioStream(null);
    }
    setCaptureError(null);
  }, [tabAudioStream, setTabAudioStream]);

  const particleLevels: { value: ParticleLevel; label: string; description: string }[] = [
    { value: 'low', label: 'Low', description: 'Best performance' },
    { value: 'medium', label: 'Medium', description: 'Balanced' },
    { value: 'high', label: 'High', description: 'Full quality' },
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
        <Icon name="cog" className={`text-[#6b6b7a] text-lg transition-all duration-300 group-hover:text-[#8f8f9d] ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      {/* Settings Panel - Opens above the button */}
      <div 
        className={`fixed bottom-24 right-8 z-50 w-[300px] max-h-[calc(100vh-8rem)] overflow-y-auto bg-[#101012] rounded-[15px] border border-white/10 shadow-[0_30px_80px_#101012] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          isOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'
        }`}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10">
          <h3 className="text-[#f1f1f1] text-[15px] font-bold">Settings</h3>
          <p className="text-[#8f8f9d] text-[11px] mt-1">Customize your experience</p>
        </div>

        {/* Reactivity (Track Intelligence) */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[#f1f1f1] text-[13px] font-medium">Reactivity</span>
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: statusInfo.tone === 'good' ? '#00e5a0' : statusInfo.tone === 'ok' ? '#f5b041' : '#5a5a6e' }}
            />
          </div>
          <p className="text-[#d6d6de] text-[12px]">{statusInfo.title}</p>
          <p className="text-[#5a5a6e] text-[10px] mt-1 italic">{statusInfo.detail}</p>

          {canSync && micSupported && (
            <>
              <button
                onClick={syncWithMic}
                disabled={micSync.state === 'listening'}
                className={`w-full mt-3 py-2 px-3 rounded-lg text-[12px] font-medium transition-all duration-200 border ${
                  micSync.state === 'listening'
                    ? 'bg-[#1a1a1d] text-[#5a5a6e] border-white/5 cursor-wait'
                    : 'bg-[#1a1a1d] text-[#8f8f9d] border-white/10 hover:bg-[#252529] hover:text-white hover:border-white/20 cursor-pointer'
                }`}
              >
                <Icon name={micSync.state === 'listening' ? 'spinner' : 'broadcast'} className={`mr-1.5 ${micSync.state === 'listening' ? 'animate-spin' : ''}`} />
                {micSync.state === 'listening' ? `Listening… ${micSync.seconds}s` : 'Sync with microphone'}
              </button>
              {(micSync.state === 'done' || micSync.state === 'failed') && (
                <p className={`text-[10px] mt-2 ${micSync.state === 'done' ? 'text-[#00e5a0]' : 'text-[#ff6b6b]'}`}>{micSync.message}</p>
              )}
              <label className="flex items-center gap-2 mt-3 text-[11px] text-[#8f8f9d] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={micAutoSync}
                  onChange={(e) => setMicAutoSync(e.target.checked)}
                  className="accent-[#00e5a0]"
                />
                Auto-sync new tracks (mic, a few seconds each)
              </label>
              <p className="text-[#5a5a6e] text-[10px] mt-1 italic">
                Listens briefly through your speakers to find the beat; nothing is recorded or sent anywhere. Headphones? Tap T on the beat instead.
              </p>
            </>
          )}
          {canSync && status.kind === 'live' && status.source === 'synced' && (
            <button onClick={clearSync} className="mt-2 text-[10px] text-[#5a5a6e] hover:text-[#8f8f9d] underline">
              Forget this track&rsquo;s sync
            </button>
          )}

          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] text-[#8f8f9d]">
              <span>Timing nudge</span>
              <span className="tabular-nums">{syncNudgeMs > 0 ? '+' : ''}{syncNudgeMs} ms</span>
            </div>
            <input
              type="range"
              min={-SYNC_NUDGE_LIMIT_MS}
              max={SYNC_NUDGE_LIMIT_MS}
              step={10}
              value={syncNudgeMs}
              onChange={(e) => setSyncNudgeMs(Number(e.target.value))}
              className="w-full mt-1"
              aria-label="Visual timing nudge in milliseconds"
            />
            <p className="text-[#5a5a6e] text-[10px] mt-1 italic">Heart hits before you hear the beat? Slide right.</p>
          </div>
        </div>

        {/* Particle Quality */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#f1f1f1] text-[13px] font-medium">Particle Quality</span>
            <Icon name="sparkles" className="text-[#8f8f9d] text-xs" />
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

        {/* Lyrics Display */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#f1f1f1] text-[13px] font-medium">Lyrics Display</span>
            <Icon name="align-center" className="text-[#8f8f9d] text-xs" />
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

        {/* Live Audio Capture */}
        <div className="px-5 py-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#f1f1f1] text-[13px] font-medium">Live tab capture <span className="text-[#5a5a6e] font-normal">(advanced)</span></span>
            {tabAudioStream ? (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#00e5a0] animate-pulse" />
                <span className="text-[#00e5a0] text-[10px] font-medium">LIVE</span>
              </span>
            ) : (
              <Icon name="music" className="text-[#8f8f9d] text-xs" />
            )}
          </div>

          {!isTabCaptureSupported ? (
            <p className="text-[#5a5a6e] text-[10px] italic">
              Tab audio capture is not supported in this browser. Use Chrome or Edge.
            </p>
          ) : tabAudioStream ? (
            <button
              onClick={stopTabCapture}
              className="w-full py-2 px-3 rounded-lg text-[12px] font-medium transition-all duration-200 bg-[#252529] text-[#00e5a0] border border-[#00e5a0]/30 hover:bg-[#2a2a30] hover:border-[#00e5a0]/50"
            >
              <Icon name="stop-circle" className="mr-1.5" />
              Disconnect Live Audio
            </button>
          ) : (
            <button
              onClick={startTabCapture}
              disabled={isCapturing}
              className={`w-full py-2 px-3 rounded-lg text-[12px] font-medium transition-all duration-200 ${
                isCapturing
                  ? 'bg-[#1a1a1d] text-[#5a5a6e] border border-white/5 cursor-wait'
                  : 'bg-[#1a1a1d] text-[#8f8f9d] border border-white/10 hover:bg-[#252529] hover:text-white hover:border-white/20 cursor-pointer'
              }`}
            >
              <Icon name={isCapturing ? 'spinner' : 'broadcast'} className={`mr-1.5 ${isCapturing ? 'animate-spin' : ''}`} />
              {isCapturing ? 'Waiting for selection...' : 'Enable Live Audio'}
            </button>
          )}

          {captureError && (
            <p className="text-[#ff6b6b] text-[10px] mt-2">{captureError}</p>
          )}

          <p className="text-[#5a5a6e] text-[10px] mt-2 italic">
            {tabAudioStream
              ? 'Heart reacts to real audio from the tab'
              : 'Optional: analyze the tab’s audio live instead of the track analysis above (Chrome/Edge share dialog).'}
          </p>
        </div>

        {/* Clean Mode */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#f1f1f1] text-[13px] font-medium">Interface</span>
            <Icon name="eye-off" className="text-[#8f8f9d] text-xs" />
          </div>
          <button
            onClick={() => {
              setIsOpen(false);
              setUiHidden(true);
            }}
            className="w-full py-2 px-3 rounded-lg text-[12px] font-medium transition-all duration-200 bg-[#1a1a1d] text-[#8f8f9d] border border-white/10 hover:bg-[#252529] hover:text-white hover:border-white/20 cursor-pointer"
          >
            <Icon name="eye-off" className="mr-1.5" />
            Hide Interface
          </button>
          <p className="text-[#5a5a6e] text-[10px] mt-2 italic">
            Clean view with just the heart. Press H or Esc to bring it back, or
            move the mouse and click the button.
          </p>
        </div>
      </div>

      {/* Sync feedback toast (tap sync works with the panel closed). */}
      <div
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-[#1a1a1d]/90 border border-white/10 text-[#d6d6de] text-[12px] backdrop-blur-sm pointer-events-none transition-opacity duration-300"
        style={{ opacity: toast && !isOpen ? 1 : 0 }}
        aria-live="polite"
      >
        {toast}
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
