interface PlayerControlsProps {
  isAuthenticated: boolean;
  isPaused: boolean;
  currentPlaylistId: string | null;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onPlaylistToggle: () => void;
}

const PlayerControls = ({
  isAuthenticated,
  isPaused,
  currentPlaylistId,
  onTogglePlay,
  onNext,
  onPrevious,
  onPlaylistToggle
}: PlayerControlsProps) => {
  return (
    <div className="w-[320px] h-full mx-[5px] ml-[141px] float-right overflow-hidden flex items-center justify-between">
      {/* Playlist Button */}
      <div className="w-1/4 flex justify-center py-3">
        <div 
          className={`w-[76px] h-[76px] bg-transparent rounded-2xl flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group
            ${isAuthenticated ? 'cursor-pointer opacity-100 hover:bg-[#252529]' : 'cursor-default opacity-30'}`}
          onClick={isAuthenticated ? onPlaylistToggle : undefined}
          title={isAuthenticated ? (currentPlaylistId ? 'Switch Playlist' : 'Select Playlist') : 'Connect to Spotify to access playlists'}
        >
          <i 
            className={`fab fa-spotify text-[26px] transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:text-white
              ${currentPlaylistId ? 'text-[#1db954]' : 'text-[#b0b3c6]'}`}
          ></i>
        </div>
      </div>

      {/* Previous Button */}
      <div className="w-1/4 flex justify-center py-3">
        <div 
          className="w-[76px] h-[76px] bg-transparent rounded-2xl cursor-pointer flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[#252529] group"
          onClick={onPrevious}
        >
          <i className="fas fa-backward text-[#b0b3c6] text-[26px] transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:text-white"></i>
        </div>
      </div>

      {/* Play/Pause Button */}
      <div className="w-1/4 flex justify-center py-3">
        <div 
          className="w-[76px] h-[76px] bg-transparent rounded-2xl cursor-pointer flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[#252529] group"
          onClick={onTogglePlay}
        >
          <i className={`${isPaused ? "fas fa-play" : "fas fa-pause"} text-[#b0b3c6] text-[26px] transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:text-white`}></i>
        </div>
      </div>

      {/* Next Button */}
      <div className="w-1/4 flex justify-center py-3">
        <div 
          className="w-[76px] h-[76px] bg-transparent rounded-2xl cursor-pointer flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[#252529] group"
          onClick={onNext}
        >
          <i className="fas fa-forward text-[#b0b3c6] text-[26px] transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:text-white"></i>
        </div>
      </div>
    </div>
  );
};

export default PlayerControls;

