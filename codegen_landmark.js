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

'use strict';

import { Transform, Buffer } from 'node';
import { FFT } from 'dsp.js';


const buildOptions = (options) => {
	const verbose = options.verbose || false;

	// sampling rate in Hz. If you change this, you must adapt windowDt and pruningDt below to match your needs
	// set the Nyquist frequency, SAMPLING_RATE/2, so as to match the max frequencies you want to get landmark fingerprints.
	const samplingRate = options.samplingRate || 22050;

	// bytes per sample, 2 for 16 bit PCM. If you change this, you must change readInt16LE methods in the code.
	const bps = options.bps || 2;

	// maximum number of local maxima for each spectrum. useful to tune the amount of fingerprints at output
	const mnlm = options.mnlm || 5;

	// maximum of hashes each peak can lead to. useful to tune the amount of fingerprints at output
	const mppp = options.mppp || 3;

	// size of the FFT window. As we use real signals, the spectra will have nfft/2 points.
	// Increasing it will give more spectral precision, less temporal precision.
	// It may be good or bad depending on the sounds you want to match and on whether your input is deformed by EQ or noise.
	const nfft = options.nfft || 512;

	// 50 % overlap
	// if SAMPLING_RATE is 22050 Hz, this leads to a sampling frequency
	// fs = (SAMPLING_RATE / step) /s = 86/s, or dt = 1/fs = 11,61 ms.
	// It's not really useful to change the overlap ratio.
	const step = options.step || (nfft / 2);

	const dt = options.dt || (1 / (samplingRate / step));

	const fft = options.fft || new FFT(nfft, samplingRate);
	const hwin = options.hwin || (
		Array(nfft).map((f, i) => (
			0.5 * (1 - Math.cos(2 * Math.PI * i / (nfft - 1)))
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
			Array(nfft / 2).fill(null).map((f, j) => (
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
		fft,
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

export class Codegen extends Transform {
	constructor(transformOptions = {}, options) {
		super({
			readableObjectMode: true,
			highWaterMark: 10,
			...transformOptions,
		});

		this.options = buildOptions(options);

		this.buffer = new Buffer(0);
		this.bufferDelta = 0;

		this.stepIndex = 0;
		this.marks = [];
		this.threshold = Array(this.options.nfft).fill(null).map(() => -3);
	}

	_write(chunk, enc, next) {
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

		if (verbose) console.log("t=" + Math.round(this.stepIndex / step) + " received " + chunk.length + " bytes");

		let tcodes = [];
		let hcodes = [];

		this.buffer = Buffer.concat([this.buffer, chunk]);

		while ((this.stepIndex + nfft) * bps < this.buffer.length + this.bufferDelta) {
			let data = new Array(nfft); // window data

			// check range. for debugging only
			//var loLimit = (this.stepIndex + 0) * bps - this.bufferDelta;
			//if (loLimit < 0) log("fp: loLimit too low: " + loLimit + " sI=" + this.stepIndex + " bPS=" + bps + " sB=" + this.skipBytes + " bD=" + this.bufferDelta + " bL=" + buf.length + " pDB=" + this.practicalDecodedBytes);

			//var hiLimit = (this.stepIndex + nfft-1) * bps - this.bufferDelta
			//if (hiLimit >= this.buffer.length) log("fp: hiLimit too high: " + hiLimit + " vs " + this.buffer.length + " sI=" + this.stepIndex + " nF=" + nfft + " bPS=" + bps + " sB=" + this.skipBytes + " bD=" + this.bufferDelta + " bL=" + buf.length + " pDB=" + this.practicalDecodedBytes);

			// fill the data, windowed (hwin) and scaled
			for (let i = 0, limit = nfft; i < limit; i++) {
				data[i] = hwin[i] * this.buffer.readInt16LE((this.stepIndex + i) * bps - this.bufferDelta) / Math.pow(2, 8 * bps - 1);
			}
			this.stepIndex += step;
			//console.log("params stepIndex=" + this.stepIndex + " bufD=" + this.bufferDelta);

			FFT.forward(data); 	// compute FFT

			// log-normal surface
			for (let i = ifMin; i < ifMax; i++) {
				// the lower part of the spectrum is damped, the higher part is boosted, leading to a better peaks detection.
				FFT.spectrum[i] = Math.abs(FFT.spectrum[i]) * Math.sqrt(i + 16);
			}

			// positive values of the difference between log spectrum and threshold
			let diff = new Array(nfft / 2);
			for (let i = ifMin; i < ifMax; i++) {
				diff[i] = Math.max(Math.log(Math.max(1e-6, FFT.spectrum[i])) - this.threshold[i], 0);
			}

			// find at most mnlm local maxima in the spectrum at this timestamp.
			let iLocMax = new Array(mnlm);
			let vLocMax = new Array(mnlm);
			for (let i = 0; i < mnlm; i++) {
				iLocMax[i] = NaN;
				vLocMax[i] = Number.NEGATIVE_INFINITY;
			}
			for (let i = ifMin + 1; i < ifMax - 1; i++) {
				//console.log("checking local maximum at i=" + i + " data[i]=" + data[i] + " vLoc[last]=" + vLocMax[mnlm-1] );
				if (diff[i] > diff[i - 1] && diff[i] > diff[i + 1] && FFT.spectrum[i] > vLocMax[mnlm - 1]) { // if local maximum big enough
					// insert the newly found local maximum in the ordered list of maxima
					for (let j = mnlm - 1; j >= 0; j--) {
						// navigate the table of previously saved maxima
						if (j >= 1 && FFT.spectrum[i] > vLocMax[j - 1]) continue;
						for (let k = mnlm - 1; k >= j + 1; k--) {
							iLocMax[k] = iLocMax[k - 1];	// offset the bottom values
							vLocMax[k] = vLocMax[k - 1];
						}
						iLocMax[j] = i;
						vLocMax[j] = FFT.spectrum[i];
						break;
					}
				}
			}

			// now that we have the mnlm highest local maxima of the spectrum,
			// update the local maximum threshold so that only major peaks are taken into account.
			for (let i = 0; i < mnlm; i++) {
				if (vLocMax[i] > Number.NEGATIVE_INFINITY) {
					for (let j = ifMin; j < ifMax; j++) {
						this.threshold[j] = Math.max(this.threshold[j], Math.log(FFT.spectrum[iLocMax[i]]) + eww[iLocMax[i]][j]);
					}
				} else {
					vLocMax.splice(i, mnlm - i); // remove the last elements.
					iLocMax.splice(i, mnlm - i);
					break;
				}
			}

			// array that stores local maxima for each time step
			this.marks.push({ "t": Math.round(this.stepIndex / step), "i": iLocMax, "v": vLocMax });

			// remove previous (in time) maxima that would be too close and/or too low.
			let nm = this.marks.length;
			let t0 = nm - pruningDt - 1;
			for (let i = nm - 1; i >= Math.max(t0 + 1, 0); i--) {
				//console.log("pruning ntests=" + this.marks[i].v.length);
				for (let j = 0; j < this.marks[i].v.length; j++) {
					//console.log("pruning " + this.marks[i].v[j] + " <? " + this.threshold[this.marks[i].i[j]] + " * " + Math.pow(this.mask_decay, lenMarks-1-i));
					if (this.marks[i].i[j] != 0 && Math.log(this.marks[i].v[j]) < this.threshold[this.marks[i].i[j]] + maskDecayLog * (nm - 1 - i)) {
						this.marks[i].v[j] = Number.NEGATIVE_INFINITY;
						this.marks[i].i[j] = Number.NEGATIVE_INFINITY;
					}
				}
			}

			// generate hashes for peaks that can no longer be pruned. stepIndex:{f1:f2:deltaindex}
			let nFingersTotal = 0;
			if (t0 >= 0) {
				let m = this.marks[t0];

				loopCurrentPeaks:
				for (let i = 0; i < m.i.length; i++) {
					let nFingers = 0;

					for (let j = t0; j >= Math.max(0, t0 - windowDt); j--) {

						let m2 = this.marks[j];

						for (let k = 0; k < m2.i.length; k++) {
							if (m2.i[k] != m.i[i] && Math.abs(m2.i[k] - m.i[i]) < windowDf) {
								tcodes.push(m.t); //Math.round(this.stepIndex/step));
								// in the hash: dt=(t0-j) has values between 0 and windowDt, so for <65 6 bits each
								//				f1=m2.i[k] , f2=m.i[i] between 0 and nfft/2-1, so for <255 8 bits each.
								hcodes.push(m2.i[k] + nfft / 2 * (m.i[i] + nfft / 2 * (t0 - j)));
								nFingers += 1;
								nFingersTotal += 1;
								if (nFingers >= mppp) continue loopCurrentPeaks;
							}
						}
					}
				}
			}
			if (nFingersTotal > 0 && verbose) {
				console.log("t=" + Math.round(this.stepIndex / step) + " generated " + nFingersTotal + " fingerprints");
			}

			this.marks.splice(0, t0 + 1 - windowDt);

			// decrease the threshold for the next iteration
			for (let j = 0; j < this.threshold.length; j++) {
				this.threshold[j] += maskDecayLog;
			}
		}

		if (this.buffer.length > 1000000) {
			const delta = this.buffer.length - 20000;
			//console.log("buffer drop " + delta + " bytes");
			this.bufferDelta += delta;
			this.buffer = this.buffer.slice(delta);
		}

		if (verbose) {
			console.log("fp processed " + (this.practicalDecodedBytes - this.decodedBytesSinceCallback) + " while threshold is " + (0.99 * this.thresholdBytes));
		}

		if (tcodes.length > 0) {
			this.push({ tcodes: tcodes, hcodes: hcodes });
			// this will eventually trigger data events on the read interface
		}

		next();
	}
}
