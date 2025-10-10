import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    domains: [
      'sleeep.dev', 
      'i.scdn.co', 
      'mosaic.scdn.co', 
      'blend-playlist-covers.spotifycdn.com', 
      'charts-images.scdn.co', 
      'newjams-images.scdn.co', 
      'seeded-session-images.scdn.co', 
      'thisis-images.scdn.co', 
      'lineup-images.scdn.co', 
      'daily-mix.scdn.co',
      'image-cdn-ak.spotifycdn.com',
      'image-cdn-fa.spotifycdn.com'
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'sleeep.dev',
      },
      {
        protocol: 'https',
        hostname: 'i.scdn.co',
      },
      {
        protocol: 'https',
        hostname: 'mosaic.scdn.co',
      },
      {
        protocol: 'https',
        hostname: 'blend-playlist-covers.spotifycdn.com',
      },
      {
        protocol: 'https',
        hostname: 'charts-images.scdn.co',
      },
      {
        protocol: 'https',
        hostname: 'newjams-images.scdn.co',
      },
      {
        protocol: 'https',
        hostname: 'seeded-session-images.scdn.co',
      },
      {
        protocol: 'https',
        hostname: 'thisis-images.scdn.co',
      },
      {
        protocol: 'https',
        hostname: 'lineup-images.scdn.co',
      },
      {
        protocol: 'https',
        hostname: 'daily-mix.scdn.co',
      },
      {
        protocol: 'https',
        hostname: 'image-cdn-ak.spotifycdn.com',
      },
      {
        protocol: 'https',
        hostname: 'image-cdn-fa.spotifycdn.com',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
        ],
      },
    ];
  },
};

export default nextConfig;
