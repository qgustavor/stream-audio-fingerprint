declare class FFTNayuki {
    private n;
    private levels;
    private cosTable;
    private sinTable;
    spectrum: number[];
    peakBand: number;
    peak: number;
    /**
     * @param n Buffer size.
     */
    constructor(n: number);
    forward(real: Array<number> | Float64Array, imag: Array<number> | Float64Array): void;
    private calculateSpectrum;
}
export default FFTNayuki;
