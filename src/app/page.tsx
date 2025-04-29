import HeartAnimation from './components/HeartAnimation';
import AdvancedMusicPlayer from './components/AdvancedMusicPlayer';

export default function Home() {
  return (
    <main className="min-h-screen bg-black relative">
      <HeartAnimation />
      <div className="absolute bottom-0 left-0 z-10">
        <AdvancedMusicPlayer />
      </div>
    </main>
  );
}
