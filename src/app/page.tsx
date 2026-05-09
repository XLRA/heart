import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      <div className="text-center space-y-6 max-w-xl">
        <h1 className="text-5xl sm:text-7xl font-light tracking-tight">
          sleep
        </h1>
        <p className="text-base sm:text-lg text-white/60 font-light">
          where do we go from here?
        </p>
      </div>

      <Link
        href="/music"
        className="absolute bottom-6 right-6 text-xs uppercase tracking-[0.2em] text-white/40 hover:text-white/80 transition-colors"
      >
        music →
      </Link>
    </main>
  );
}
