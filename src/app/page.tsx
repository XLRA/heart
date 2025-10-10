import HeartAnimation from './components/HeartAnimation';
import AdvancedMusicPlayer from './components/AdvancedMusicPlayer';
import SpotifyLogin from './components/SpotifyLogin';
import { SpotifyProvider } from './context/SpotifyContext';
import { WebPlayerProvider } from './context/WebPlayerContext';

export default function Home() {
  return (
    <SpotifyProvider>
      <WebPlayerProvider>
        <main className="min-h-screen bg-black relative">
          <HeartAnimation />
          <SpotifyLogin />
          <div className="absolute bottom-0 left-0 z-10">
            <AdvancedMusicPlayer />
          </div>
        </main>
      </WebPlayerProvider>
    </SpotifyProvider>
  );
}
