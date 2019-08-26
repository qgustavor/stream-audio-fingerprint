/* eslint-disable no-mixed-operators, max-len, no-bitwise, no-plusplus, @typescript-eslint/no-use-before-define, no-param-reassign, no-throw-literal */
// Original from: https://www.nayuki.io/page/free-small-fft-in-multiple-languages
// Modified by Chris Cannam: https://code.soundsoftware.ac.uk/projects/js-dsp-test/repository/entry/fft/nayuki-obj/fft.js

/*
 * Free FFT and convolution (JavaScript)
 *
 * Copyright (c) 2014 Project Nayuki
 * http://www.nayuki.io/page/free-small-fft-in-multiple-languages
 *
 * (MIT License)
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 *
 * Original slightly restructured by Chris Cannam, cannam@all-day-breakfast.com
 * Restructured again to use the Typescript variant by Lucas Polito, https://github.com/lpolito
 * Typescript from: https://www.nayuki.io/res/free-small-fft-in-multiple-languages/fft.ts
 */


/*
 * Construct an object for calculating the discrete Fourier transform (DFT) of size n, where n is a power of 2.
 */
class FFTNayuki {
    private n: number;

    private levels: number;

    private cosTable: number[];

    private sinTable: number[];

    public spectrum: number[];

    public peakBand = 0;

    public peak = 0;

    /**
     * @param n Buffer size.
     */
    constructor(n: number) {
      this.n = n;

      this.levels = -1;
      for (let i = 0; i < 32; i++) {
        if (1 << i === n) { this.levels = i; } // Equal to log2(n)
      }
      if (this.levels === -1) {
        throw 'Length is not a power of 2';
      }

      // Trigonometric tables
      this.cosTable = new Array(n / 2);
      this.sinTable = new Array(n / 2);
      for (let i = 0; i < n / 2; i++) {
        this.cosTable[i] = Math.cos(2 * Math.PI * i / n);
        this.sinTable[i] = Math.sin(2 * Math.PI * i / n);
      }
    }

    /*
     * Computes the discrete Fourier transform (DFT) of the given complex vector, storing the result back into the vector.
     * The vector's length must be equal to the size n that was passed to the object constructor, and this must be a power of 2. Uses the Cooley-Tukey decimation-in-time radix-2 algorithm.
     */
    public forward(real: Array<number>|Float64Array, imag: Array<number>|Float64Array): void {
      // Bit-reversed addressing permutation
      for (let i = 0; i < this.n; i++) {
        const j: number = reverseBits(i, this.levels);
        if (j > i) {
          let temp: number = real[i];
          real[i] = real[j];
          real[j] = temp;
          temp = imag[i];
          imag[i] = imag[j];
          imag[j] = temp;
        }
      }

      // Cooley-Tukey decimation-in-time radix-2 FFT
      for (let size = 2; size <= this.n; size *= 2) {
        const halfsize: number = size / 2;
        const tablestep: number = this.n / size;
        for (let i = 0; i < this.n; i += size) {
          for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
            const l: number = j + halfsize;
            const tpre: number = real[l] * this.cosTable[k] + imag[l] * this.sinTable[k];
            const tpim: number = -real[l] * this.sinTable[k] + imag[l] * this.cosTable[k];
            real[l] = real[j] - tpre;
            imag[l] = imag[j] - tpim;
            real[j] += tpre;
            imag[j] += tpim;
          }
        }
      }

      // Returns the integer whose value is the reverse of the lowest 'bits' bits of the integer 'x'.
      function reverseBits(x: number, bits: number): number {
        let y = 0;
        for (let i = 0; i < bits; i++) {
          y = (y << 1) | (x & 1);
          x >>>= 1;
        }
        return y;
      }
    }
}

export default FFTNayuki;
