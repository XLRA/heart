import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "sleep — music",
  description: "where do we go from here?",
};

export default function MusicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
      />
      <Script
        id="spotify-sdk-ready"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.onSpotifyWebPlaybackSDKReady = function() {
              console.log('Spotify Web Playback SDK is ready');
              window.dispatchEvent(new CustomEvent('spotifySDKReady'));
            };
          `,
        }}
      />
      <Script
        src="https://sdk.scdn.co/spotify-player.js"
        strategy="afterInteractive"
      />
      {children}
    </>
  );
}
