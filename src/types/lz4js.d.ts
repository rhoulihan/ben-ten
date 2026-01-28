declare module 'lz4js' {
  /**
   * Compresses data using LZ4 block format.
   *
   * @param input - The data to compress as Uint8Array
   * @returns Compressed data as Uint8Array
   */
  export function compress(input: Uint8Array): Uint8Array;

  /**
   * Decompresses LZ4 block format data.
   *
   * @param input - The compressed data as Uint8Array
   * @returns Decompressed data as Uint8Array
   */
  export function decompress(input: Uint8Array): Uint8Array;
}
