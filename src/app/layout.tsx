import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "sleep",
  description: "where do we go from here?",
  icons: {
    icon: '/favicon.ico'
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        />
        <script src="https://sdk.scdn.co/spotify-player.js" async></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.onSpotifyWebPlaybackSDKReady = function() {
                console.log('Spotify Web Playback SDK is ready');
                window.dispatchEvent(new CustomEvent('spotifySDKReady'));
              };
            `,
          }}
        />
      </head>
      <body className={`${inter.className} bg-black`}>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
