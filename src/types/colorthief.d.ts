declare module 'colorthief' {
  export default class ColorThief {
    /**
     * Gets the dominant color from an image
     * @param img - HTML image element or image path
     * @param quality - Quality setting (1 is highest, 10 is default)
     * @returns RGB array [r, g, b]
     */
    getColor(img: HTMLImageElement | string, quality?: number): [number, number, number];

    /**
     * Gets a color palette from an image
     * @param img - HTML image element or image path
     * @param colorCount - Number of colors to return (default 10)
     * @param quality - Quality setting (1 is highest, 10 is default)
     * @returns Array of RGB arrays [[r, g, b], ...]
     */
    getPalette(
      img: HTMLImageElement | string,
      colorCount?: number,
      quality?: number
    ): [number, number, number][];
  }
}
