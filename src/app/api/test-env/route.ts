import { NextResponse } from 'next/server';

/**
 * Test endpoint to verify environment variables are loaded
 * DELETE THIS FILE after testing!
 */
export async function GET() {
  const hasGeniusToken = !!process.env.GENIUS_ACCESS_TOKEN;
  const tokenPreview = process.env.GENIUS_ACCESS_TOKEN 
    ? `${process.env.GENIUS_ACCESS_TOKEN.substring(0, 10)}...` 
    : 'NOT SET';

  return NextResponse.json({
    geniusTokenConfigured: hasGeniusToken,
    tokenPreview: tokenPreview,
    environment: process.env.NODE_ENV,
    allEnvVars: Object.keys(process.env).filter(key => 
      key.includes('GENIUS') || key.includes('MUSIXMATCH')
    )
  });
}

