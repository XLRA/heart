import ColorThief from 'colorthief';

export interface AlbumColors {
  dominant: string;      // Most prominent color (HSLA)
  palette: string[];     // 3-5 prominent colors (HSLA)
  raw: {
    dominant: [number, number, number];  // RGB
    palette: [number, number, number][]; // RGB array
  };
}

// Cache for extracted colors to avoid re-extraction
const colorCache = new Map<string, AlbumColors>();

/**
 * Convert RGB to HSL
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return [
    Math.round(h * 360),
    Math.round(s * 100),
    Math.round(l * 100)
  ];
}

/**
 * Convert RGB array to HSLA string with specified alpha
 */
function rgbToHslaString(rgb: [number, number, number], alpha: number = 0.4): string {
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
}

/**
 * Get a variation of the color for more visual interest
 * Slightly adjusts saturation and lightness
 */
function getColorVariation(rgb: [number, number, number], variation: number): string {
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  
  // Add some variation to saturation and lightness
  const newS = Math.max(40, Math.min(100, s + (variation * 20 - 10)));
  const newL = Math.max(20, Math.min(80, l + (variation * 30 - 15)));
  
  return `hsla(${h}, ${newS}%, ${newL}%, 0.4)`;
}

/**
 * Extract dominant colors from an image URL
 * Uses the smallest Spotify image for fast extraction
 */
export async function extractColorsFromImage(imageUrl: string): Promise<AlbumColors | null> {
  // Check cache first
  const cached = colorCache.get(imageUrl);
  if (cached) {
    console.log('[ColorExtractor] Returning cached colors for:', imageUrl.substring(0, 50));
    return cached;
  }

  try {
    console.log('[ColorExtractor] Extracting colors from:', imageUrl.substring(0, 50));
    const startTime = performance.now();

    // Create an image element
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    
    // Wait for image to load
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageUrl;
    });

    const colorThief = new ColorThief();
    
    // Get dominant color and palette
    const dominantRgb = colorThief.getColor(img) as [number, number, number];
    const paletteRgb = colorThief.getPalette(img, 5) as [number, number, number][];

    // Convert to HSLA strings
    const dominant = rgbToHslaString(dominantRgb, 0.6);
    
    // Create palette with variations for more visual interest
    const palette: string[] = paletteRgb.map((rgb, index) => {
      // More prominent colors (first in palette) get higher alpha
      const alpha = 0.5 - (index * 0.05);
      return rgbToHslaString(rgb, alpha);
    });

    // Add some color variations for more particle variety
    const extendedPalette = [
      ...palette,
      ...paletteRgb.slice(0, 3).map((rgb, i) => getColorVariation(rgb, i * 0.5))
    ];

    const result: AlbumColors = {
      dominant,
      palette: extendedPalette,
      raw: {
        dominant: dominantRgb,
        palette: paletteRgb
      }
    };

    const endTime = performance.now();
    console.log(`[ColorExtractor] ✅ Extracted ${result.palette.length} colors in ${(endTime - startTime).toFixed(1)}ms`);
    console.log('[ColorExtractor] Dominant color:', dominant);
    console.log('[ColorExtractor] Palette:', palette.slice(0, 3).join(', '));

    // Cache the result
    colorCache.set(imageUrl, result);

    return result;
  } catch (error) {
    console.error('[ColorExtractor] ❌ Failed to extract colors:', error);
    return null;
  }
}

/**
 * Get the smallest image URL from Spotify album images
 * Smaller images = faster color extraction
 */
export function getSmallestImageUrl(images: Array<{ url: string; width?: number; height?: number }>): string | null {
  if (!images || images.length === 0) return null;
  
  // Sort by size (width) ascending, get smallest
  const sorted = [...images].sort((a, b) => {
    const widthA = a.width || 640;
    const widthB = b.width || 640;
    return widthA - widthB;
  });
  
  return sorted[0].url;
}

/**
 * Clear the color cache (useful for memory management)
 */
export function clearColorCache(): void {
  colorCache.clear();
  console.log('[ColorExtractor] Cache cleared');
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; urls: string[] } {
  return {
    size: colorCache.size,
    urls: Array.from(colorCache.keys())
  };
}

/**
 * Default colors (pink/purple) as fallback
 */
export function getDefaultColors(): AlbumColors {
  return {
    dominant: 'hsla(320, 80%, 50%, 0.6)',
    palette: [
      'hsla(320, 80%, 50%, 0.5)',   // Pink
      'hsla(280, 70%, 45%, 0.45)',  // Purple
      'hsla(340, 75%, 55%, 0.4)',   // Light pink
      'hsla(300, 65%, 40%, 0.35)',  // Magenta
      'hsla(260, 60%, 50%, 0.3)',   // Violet
      'hsla(330, 85%, 60%, 0.4)',   // Bright pink
      'hsla(290, 70%, 55%, 0.35)',  // Light purple
      'hsla(310, 75%, 45%, 0.3)',   // Deep pink
    ],
    raw: {
      dominant: [219, 64, 153],
      palette: [
        [219, 64, 153],
        [128, 64, 191],
        [230, 102, 166],
        [166, 64, 166],
        [115, 77, 191]
      ]
    }
  };
}
