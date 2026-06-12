import { ReactNode } from 'react';
import Icon from '../Icon';
import { SpotifyPlaylistData } from '@/types/spotify';

interface TrackInfoProps {
  title: string;
  artist: string;
  currentPlaylist: SpotifyPlaylistData | null;
  showPlaylistSongs: boolean;
  onPlaylistSongsToggle: () => void;
  onBackToDefault: () => void;
  isActive: boolean;
  children?: ReactNode;
}

const TrackInfo = ({ 
  title, 
  artist, 
  currentPlaylist, 
  showPlaylistSongs, 
  onPlaylistSongsToggle, 
  onBackToDefault,
  isActive,
  children
}: TrackInfoProps) => {
  return (
    <div 
      className={`absolute top-0 right-[15px] left-[15px] pt-[13px] pb-[10px] pl-[184px] pr-[22px] bg-[#151518] rounded-t-[15px] z-[1] border border-white/10 border-b-0 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform backface-hidden
        ${isActive ? '-translate-y-[92px]' : 'translate-y-0'}`}
    >
      {/* Album/Track Name Row */}
      <div className="flex items-center gap-2 mb-1">
        <div className="text-[#f1f1f1] text-[17px] font-bold flex-1 truncate">
          {title || 'No track'}
        </div>
        {currentPlaylist && (
          <>
            <button
              onClick={onPlaylistSongsToggle}
              className={`bg-transparent border-none p-1 rounded cursor-pointer text-xs transition-all duration-200 hover:bg-[#252529] hover:text-[#1db954] ${showPlaylistSongs ? 'text-[#1db954]' : 'text-[#8f8f9d]'}`}
              title={showPlaylistSongs ? "Hide playlist" : "Show playlist"}
            >
              <Icon name={showPlaylistSongs ? 'chevron-down' : 'chevron-up'} />
            </button>
            <button
              onClick={onBackToDefault}
              className="bg-transparent border-none text-[#8f8f9d] p-1 rounded cursor-pointer text-xs transition-all duration-200 hover:bg-[#252529] hover:text-white"
              title="Back to default playlist"
            >
              <Icon name="times" />
            </button>
          </>
        )}
      </div>

      {/* Artist Name Row */}
      <div className="text-[#8f8f9d] text-[13px] my-[2px] mb-2 truncate">
        {artist || 'No artist'}
        {currentPlaylist && (
          <span className="text-[#1db954] ml-2">
            • {currentPlaylist.name}
          </span>
        )}
      </div>

      {children}
    </div>
  );
};

export default TrackInfo;
