// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Copyright (c) 2018 Alexandre Storelli

// Online implementation of the landmark audio fingerprinting algorithm.
// inspired by D. Ellis (2009), "Robust Landmark-Based Audio Fingerprinting"
// http://labrosa.ee.columbia.edu/matlab/fingerprint/
// itself inspired by Wang 2003 paper

// This module exports Codegen, an instance of stream.Transform
// By default, the writable side must be fed with an input signal with the following properties:
// - single channel
// - 16bit PCM
// - 22050 Hz sampling rate
//
// The readable side outputs objects of the form
// { tcodes: [time stamps], hcodes: [fingerprints] }

import {Transform, TransformOptions} from 'stream';
import {Buffer} from 'buffer';
import FFT from './lib/fft';


interface CodegenOptions {
  verbose: boolean;
  samplingRate: number;
  bps: number;
  mnlm: number;
  mppp: number;
  nfft: number;
  step: number;
  dt: number;
  hwin: number[];
  maskDecayLog: number;
  ifMin: number;
  ifMax: number;
  windowDf: number;
  windowDt: number;
  pruningDt: number;
  maskDf: number;
  eww: number[][];
}

interface CodegenUserOpts {
  verbose?: boolean;
  samplingRate?: number;
  bps?: number;
  mnlm?: number;
  mppp?: number;
  nfft?: number;
  step?: number;
  dt?: number;
  hwin?: number[];
  maskDecayLog?: number;
  ifMin?: number;
  ifMax?: number;
  windowDf?: number;
  windowDt?: number;
  pruningDt?: number;
  maskDf?: number;
  eww?: number[][];
}


const buildOptions = (options: CodegenUserOpts): CodegenOptions => {
  const verbose = options.verbose || false;

  // sampling rate in Hz. If you change this, you must adapt windowDt and pruningDt below to match your needs
  // set the Nyquist frequency, SAMPLING_RATE/2,
  // so as to match the max frequencies you want to get landmark fingerprints.
  const samplingRate = options.samplingRate || 22050;

  // bytes per sample, 2 for 16 bit PCM. If you change this, you must change readInt16LE methods in the code.
  const bps = options.bps || 2;

  // maximum number of local maxima for each spectrum. useful to tune the amount of fingerprints at output
  const mnlm = options.mnlm || 5;

  // maximum of hashes each peak can lead to. useful to tune the amount of fingerprints at output
  const mppp = options.mppp || 3;

  // size of the FFT window. As we use real signals, the spectra will have nfft/2 points.
  // Increasing it will give more spectral precision, less temporal precision.
  // It may be good or bad depending on the sounds you want to match,
  // and on whether your input is deformed by EQ or noise.
  const nfft = options.nfft || 512;

  // 50 % overlap
  // if SAMPLING_RATE is 22050 Hz, this leads to a sampling frequency
  // fs = (SAMPLING_RATE / step) /s = 86/s, or dt = 1/fs = 11,61 ms.
  // It's not really useful to change the overlap ratio.
  const step = options.step || (nfft / 2);

  const dt = options.dt || (1 / (samplingRate / step));

  const hwin = options.hwin || (
    Array(nfft).fill(null).map((f, i) => (
      0.5 * (1 - Math.cos(((2 * Math.PI) * i) / (nfft - 1)))
    ))
  );

  // threshold decay factor between frames.
  const maskDecayLog = options.maskDecayLog || Math.log(0.995);

  // frequency window to generate landmark pairs, in units of DF = SAMPLING_RATE / NFFT. Values between 0 and NFFT/2
  // you can increase this to avoid having fingerprints for low frequencies
  const ifMin = options.ifMin || 0;
  // you don't really want to decrease this, better reduce SAMPLING_RATE instead for faster computation.
  const ifMax = options.ifMax || nfft / 2;

  // we set this to avoid getting fingerprints linking very different frequencies.
  // useful to reduce the amount of fingerprints. this can be maxed at NFFT/2 if you wish.
  const windowDf = options.windowDf || 60;

  // time window to generate landmark pairs. time in units of dt (see definition above)
  // a little more than 1 sec.
  const windowDt = options.windowDt || 96;
  // about 250 ms, window to remove previous peaks that are superseded by later ones.
  // tune the pruningDt value to match the effects of maskDecayLog.
  // also, pruningDt controls the latency of the pipeline. higher pruningDt = higher latency
  const pruningDt = options.pruningDt || 24;

  // prepare the values of exponential masks.
  // mask decay scale in DF units on the frequency axis.
  const maskDf = options.maskDf || 3;
  // gaussian mask is a polynom when working on the log-spectrum. log(exp()) = Id()
  // MASK_DF is multiplied by Math.sqrt(i+3) to have wider masks at higher frequencies
  // see the visualization out-thr.png for better insight of what is happening
  const eww = options.eww || (
    Array(nfft / 2).fill(null).map((f, i) => (
      Array(nfft / 2).fill(null).map((f2, j) => (
        // eslint-disable-next-line no-restricted-properties
        -0.5 * Math.pow((j - i) / maskDf / Math.sqrt(i + 3), 2)
      ))
    ))
  );

  return {
    verbose,
    samplingRate,
    bps,
    mnlm,
    mppp,
    nfft,
    step,
    dt,
    hwin,
    maskDecayLog,
    ifMin,
    ifMax,
    windowDf,
    windowDt,
    pruningDt,
    maskDf,
    eww,
  };
};

interface Mark {
    t: number;
    i: number[];
    v: number[];
}

interface CodegenBuffer {
  tcodes: number[];
  hcodes: number[];
}

declare interface Codegen {
  on(event: 'data', listener: (chunk: CodegenBuffer) => void): this;
  on(event: string, listener: Function): this;
}

class Codegen extends Transform {
    options: CodegenOptions = {} as CodegenOptions;

    buffer: Buffer;

    bufferDelta: number;

    stepIndex: number;

    marks: Mark[];

    threshold: number[];

    fft: FFT;

    constructor(transformOptions?: TransformOptions, options?: CodegenUserOpts) {
      super({
        readableObjectMode: true,
        highWaterMark: 10,
        ...transformOptions || {},
      });

      this.options = buildOptions(options || {});

      this.buffer = Buffer.alloc(0);
      this.bufferDelta = 0;

      this.stepIndex = 0;
      this.marks = [];
      this.threshold = Array(this.options.nfft).fill(null).map(() => -3);

      this.fft = new FFT(this.options.nfft);
    }

    public _transform: Transform['_transform'] = (chunk, enc, next) => {
      const {
        verbose,
        bps,
        mnlm,
        mppp,
        nfft,
        step,
        hwin,
        maskDecayLog,
        ifMin,
        ifMax,
        windowDf,
        windowDt,
        pruningDt,
        eww,
      } = this.options;

      if (verbose) console.log(`t=${Math.round(this.stepIndex / step)} received ${chunk.length} bytes`);

      const tcodes: number[] = [];
      const hcodes: number[] = [];

      this.buffer = Buffer.concat([this.buffer, chunk]);

      while ((this.stepIndex + nfft) * bps < this.buffer.length + this.bufferDelta) {
        const data = new Array(nfft); // window data
        const image = new Array(nfft).fill(0);

        // fill the data, windowed (HWIN) and scaled
        for (let i = 0, limit = nfft; i < limit; i += 1) {
          data[i] = (
            hwin[i]
                    * this.buffer.readInt16LE((this.stepIndex + i) * bps - this.bufferDelta)
          // eslint-disable-next-line no-restricted-properties
          ) / Math.pow(2, 8 * bps - 1);
        }
        this.stepIndex += step;

        this.fft.forward(data, image); // compute FFT

        // log-normal surface
        for (let i = ifMin; i < ifMax; i += 1) {
          // the lower part of the spectrum is damped,
          // the higher part is boosted, leading to a better peaks detection.
          this.fft.spectrum[i] = Math.abs(this.fft.spectrum[i]) * Math.sqrt(i + 16);
        }

        // positive values of the difference between log spectrum and threshold
        const diff = new Array(nfft / 2);
        for (let i = ifMin; i < ifMax; i += 1) {
          diff[i] = Math.max(Math.log(Math.max(1e-6, this.fft.spectrum[i])) - this.threshold[i], 0);
        }

        // find at most MNLM local maxima in the spectrum at this timestamp.
        const iLocMax = new Array(mnlm);
        const vLocMax = new Array(mnlm);
        for (let i = 0; i < mnlm; i += 1) {
          iLocMax[i] = NaN;
          vLocMax[i] = Number.NEGATIVE_INFINITY;
        }
        for (let i = ifMin + 1; i < ifMax - 1; i += 1) {
          if (diff[i] > diff[i - 1]
                    && diff[i] > diff[i + 1]
                    && this.fft.spectrum[i] > vLocMax[mnlm - 1]) { // if local maximum big enough
            // insert the newly found local maximum in the ordered list of maxima
            for (let j = mnlm - 1; j >= 0; j -= 1) {
              // navigate the table of previously saved maxima
              // eslint-disable-next-line no-continue
              if (j >= 1 && this.fft.spectrum[i] > vLocMax[j - 1]) continue;
              for (let k = mnlm - 1; k >= j + 1; k -= 1) {
                iLocMax[k] = iLocMax[k - 1]; // offset the bottom values
                vLocMax[k] = vLocMax[k - 1];
              }
              iLocMax[j] = i;
              vLocMax[j] = this.fft.spectrum[i];
              break;
            }
          }
        }

        // now that we have the MNLM highest local maxima of the spectrum,
        // update the local maximum threshold so that only major peaks are taken into account.
        for (let i = 0; i < mnlm; i += 1) {
          if (vLocMax[i] > Number.NEGATIVE_INFINITY) {
            for (let j = ifMin; j < ifMax; j += 1) {
              this.threshold[j] = (
                Math.max(this.threshold[j], Math.log(this.fft.spectrum[iLocMax[i]]) + eww[iLocMax[i]][j])
              );
            }
          } else {
            vLocMax.splice(i, mnlm - i); // remove the last elements.
            iLocMax.splice(i, mnlm - i);
            break;
          }
        }

        // array that stores local maxima for each time step
        this.marks.push({t: Math.round(this.stepIndex / step), i: iLocMax, v: vLocMax});

        // remove previous (in time) maxima that would be too close and/or too low.
        const nm = this.marks.length;
        const t0 = nm - pruningDt - 1;
        for (let i = nm - 1; i >= Math.max(t0 + 1, 0); i -= 1) {
          // console.log("pruning ntests=" + this.marks[i].v.length);
          for (let j = 0; j < this.marks[i].v.length; j += 1) {
            if (this.marks[i].i[j] !== 0
                            && Math.log(this.marks[i].v[j]) < (
                              this.threshold[this.marks[i].i[j]] + maskDecayLog * (nm - 1 - i)
                            )) {
              this.marks[i].v[j] = Number.NEGATIVE_INFINITY;
              this.marks[i].i[j] = Number.NEGATIVE_INFINITY;
            }
          }
        }

        // generate hashes for peaks that can no longer be pruned. stepIndex:{f1:f2:deltaindex}
        let nFingersTotal = 0;
        if (t0 >= 0) {
          const m = this.marks[t0];

          // eslint-disable-next-line no-restricted-syntax, no-labels
          loopCurrentPeaks:
          for (let i = 0; i < m.i.length; i += 1) {
            let nFingers = 0;

            for (let j = t0; j >= Math.max(0, t0 - windowDt); j -= 1) {
              const m2 = this.marks[j];

              for (let k = 0; k < m2.i.length; k += 1) {
                if (m2.i[k] !== m.i[i] && Math.abs(m2.i[k] - m.i[i]) < windowDf) {
                  tcodes.push(m.t); // Math.round(this.stepIndex/STEP));
                  hcodes.push(m2.i[k] + (nfft / 2) * (m.i[i] + (nfft / 2) * (t0 - j)));
                  nFingers += 1;
                  nFingersTotal += 1;
                  // eslint-disable-next-line no-continue, no-labels
                  if (nFingers >= mppp) continue loopCurrentPeaks;
                }
              }
            }
          }
        }
        if (nFingersTotal > 0 && verbose) {
          console.log(`t=${Math.round(this.stepIndex / step)} generated ${nFingersTotal} fingerprints`);
        }

        this.marks.splice(0, t0 + 1 - windowDt);

        // decrease the threshold for the next iteration
        for (let j = 0; j < this.threshold.length; j += 1) {
          this.threshold[j] += maskDecayLog;
        }
      }

      if (this.buffer.length > 1000000) {
        const delta = this.buffer.length - 20000;
        // console.log("buffer drop " + delta + " bytes");
        this.bufferDelta += delta;
        this.buffer = this.buffer.slice(delta);
      }

      if (tcodes.length > 0) {
        this.push({tcodes, hcodes});
        // this will eventually trigger data events on the read interface
      }

      next();
    }
}

export default Codegen;
