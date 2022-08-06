declare class FFTNayuki {
  private readonly n
  private readonly levels
  private readonly cosTable
  private readonly sinTable
  spectrum: number[]
  peakBand: number
  peak: number
  /**
      * @param n Buffer size.
      */
  constructor (n: number);
  forward (real: number[] | Float64Array, imag: number[] | Float64Array): void;
  private readonly calculateSpectrum
}
export default FFTNayuki
