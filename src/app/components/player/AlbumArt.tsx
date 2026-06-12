import Image from 'next/image';
import Icon from '../Icon';

interface AlbumArtProps {
  cover: string;
  title: string;
  isActive: boolean;
  isBuffering: boolean;
}

const AlbumArt = ({ cover, title, isActive, isBuffering }: AlbumArtProps) => {
  return (
    <div 
      className={`absolute w-[115px] h-[115px] ml-[40px] rounded-full overflow-hidden bg-[#151518] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[top,box-shadow]
        ${isActive 
          ? '-top-[60px] shadow-[0_0_0_4px_#23232b,0_30px_50px_-15px_#23232b]' 
          : '-top-[40px] shadow-[0_0_0_10px_#18181f]'
        }`}
    >
      {/* Center hole for the record look */}
      <div className="absolute top-1/2 left-0 right-0 w-5 h-5 -mt-2.5 mx-auto bg-[#252529] rounded-full shadow-[inset_0_0_0_2px_rgba(255,255,255,0.2)] z-[2] content-['']" />
      
      <div className={`w-full h-full ${isActive ? 'animate-rotate-album' : ''}`}>
        <Image 
          src={cover || '/covers/cover1.jpg'}
          alt={`${title || 'No track'} cover`}
          width={115}
          height={115}
          onError={(e) => {
            console.warn('Image loading error for:', cover);
            e.currentTarget.style.display = 'none';
            const fallback = e.currentTarget.nextElementSibling as HTMLElement;
            if (fallback) fallback.style.display = 'flex';
          }}
          className="w-full h-full object-cover backface-hidden"
        />
        {/* Fallback placeholder */}
        <div className="absolute inset-0 hidden items-center justify-center bg-[#252529] text-[#8f8f9d] text-2xl">
          <Icon name="music" />
        </div>
      </div>

      {/* Buffer indicator */}
      <div 
        className={`absolute top-1/2 left-0 right-0 h-[13px] text-white text-[13px] font-bold font-sans text-center leading-none p-1.5 -mt-3 mx-auto bg-[rgba(36,36,48,0.7)] z-[2] transition-opacity duration-200 ${isBuffering ? 'opacity-100' : 'opacity-0'}`}
      >
        Buffering ...
      </div>
    </div>
  );
};

export default AlbumArt;

