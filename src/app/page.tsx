import HeartAnimation from './components/HeartAnimation';
import AdvancedMusicPlayer from './components/AdvancedMusicPlayer';
import SpotifyLogin from './components/SpotifyLogin';
import { SpotifyProvider } from './context/SpotifyContext';

export default function Home() {
  return (
    <SpotifyProvider>
      <main className="min-h-screen bg-black relative">
        <HeartAnimation />
        <SpotifyLogin />
        <div className="absolute bottom-0 left-0 z-10">
          <AdvancedMusicPlayer />
        </div>
      </main>
    </SpotifyProvider>
  );
}
