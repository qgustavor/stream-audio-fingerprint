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

import {Transform, Buffer} from 'node';
import {DSP as dsp} from 'dsp.js';

const SAMPLING_RATE = 22050;
// sampling rate in Hz. If you change this, you must adapt WINDOW_DT and PRUNING_DT below to match your needs
// set the Nyquist frequency, SAMPLING_RATE/2, so as to match the max frequencies you want to get landmark fingerprints.

const BPS = 2;
// bytes per sample, 2 for 16 bit PCM. If you change this, you must change readInt16LE methods in the code.

const MNLM = 5;
// maximum number of local maxima for each spectrum. useful to tune the amount of fingerprints at output

const MPPP = 3;
// maximum of hashes each peak can lead to. useful to tune the amount of fingerprints at output

const NFFT = 512;  // size of the FFT window. As we use real signals, the spectra will have nfft/2 points.
// Increasing it will give more spectral precision, less temporal precision.
// It may be good or bad depending on the sounds you want to match and on whether your input is deformed by EQ or noise.

const STEP = NFFT/2; // 50 % overlap
// if SAMPLING_RATE is 22050 Hz, this leads to a sampling frequency
// fs = (SAMPLING_RATE / STEP) /s = 86/s, or dt = 1/fs = 11,61 ms.
// It's not really useful to change the overlap ratio.
const DT = 1 / (SAMPLING_RATE / STEP);

const FFT = new dsp.FFT(NFFT, SAMPLING_RATE);

const HWIN = new Array(NFFT); // prepare the hann window
for (var i=0; i<NFFT; i++) {
	HWIN[i] = 0.5 * (1 - Math.cos(2*Math.PI*i/(NFFT-1)));
}

const MASK_DECAY_LOG = Math.log(0.995); // threshold decay factor between frames.

// frequency window to generate landmark pairs, in units of DF = SAMPLING_RATE / NFFT. Values between 0 and NFFT/2
const IF_MIN = 0; // you can increase this to avoid having fingerprints for low frequencies
const IF_MAX = NFFT/2; // you don't really want to decrease this, better reduce SAMPLING_RATE instead for faster computation.

const WINDOW_DF = 60; // we set this to avoid getting fingerprints linking very different frequencies.
// useful to reduce the amount of fingerprints. this can be maxed at NFFT/2 if you wish.

// time window to generate landmark pairs. time in units of dt (see definition above)
const WINDOW_DT = 96; // a little more than 1 sec.
const PRUNING_DT = 24; // about 250 ms, window to remove previous peaks that are superseded by later ones.
// tune the PRUNING_DT value to match the effects of MASK_DECAY_LOG.
// also, PRUNING_DT controls the latency of the pipeline. higher PRUNING_DT = higher latency

// prepare the values of exponential masks.
const MASK_DF = 3; // mask decay scale in DF units on the frequency axis.
const EWW = new Array(NFFT/2);
for (let i=0; i<NFFT/2; i++) {
	EWW[i] = new Array(NFFT/2);
	for (let j=0; j<NFFT/2; j++) {
		EWW[i][j] = -0.5*Math.pow((j-i)/MASK_DF/Math.sqrt(i+3),2); // gaussian mask is a polynom when working on the log-spectrum. log(exp()) = Id()
		// MASK_DF is multiplied by Math.sqrt(i+3) to have wider masks at higher frequencies
		// see the visualization out-thr.png for better insight of what is happening
	}
}

const VERBOSE = false;

export class Codegen extends Transform {

	constructor(options) {
		if (!options) {
			options = {};
		}

		options = {
			readableObjectMode: true,
			highWaterMark: 10,
			...options, 
		}

		super(options);

		this.buffer = new Buffer(0);
		this.bufferDelta = 0;

		this.stepIndex = 0;
		this.marks = [];
		this.threshold = new Array(NFFT/2);
		for (var i=0; i<NFFT/2; i++) {
			this.threshold[i] = -3;
		}

		// copy constants to be able to reference them in parent modules
		this.DT = DT;
		this.SAMPLING_RATE = SAMPLING_RATE;
		this.BPS = BPS;
	}

	_write(chunk, enc, next) {

		if (VERBOSE) console.log("t=" + Math.round(this.stepIndex/STEP) + " received " + chunk.length + " bytes");

		let tcodes = [];
		let hcodes = [];

		this.buffer = Buffer.concat([this.buffer,chunk]);

		while ((this.stepIndex + NFFT) * BPS < this.buffer.length + this.bufferDelta) {
			let data = new Array(NFFT); // window data


			// check range. for debugging only
			//var loLimit = (this.stepIndex + 0) * BPS - this.bufferDelta;
			//if (loLimit < 0) log("fp: loLimit too low: " + loLimit + " sI=" + this.stepIndex + " bPS=" + BPS + " sB=" + this.skipBytes + " bD=" + this.bufferDelta + " bL=" + buf.length + " pDB=" + this.practicalDecodedBytes);

			//var hiLimit = (this.stepIndex + NFFT-1) * BPS - this.bufferDelta
			//if (hiLimit >= this.buffer.length) log("fp: hiLimit too high: " + hiLimit + " vs " + this.buffer.length + " sI=" + this.stepIndex + " nF=" + NFFT + " bPS=" + BPS + " sB=" + this.skipBytes + " bD=" + this.bufferDelta + " bL=" + buf.length + " pDB=" + this.practicalDecodedBytes);

			// fill the data, windowed (HWIN) and scaled
			for (let i=0,limit = NFFT; i<limit; i++) {
				data[i] = HWIN[i] * this.buffer.readInt16LE((this.stepIndex + i) * BPS - this.bufferDelta) / Math.pow(2, 8*BPS-1);
			}
			this.stepIndex += STEP;
			//console.log("params stepIndex=" + this.stepIndex + " bufD=" + this.bufferDelta);

			FFT.forward(data); 	// compute FFT

			// log-normal surface
			for (let i=IF_MIN; i<IF_MAX; i++) {
				// the lower part of the spectrum is damped, the higher part is boosted, leading to a better peaks detection.
				FFT.spectrum[i] = Math.abs(FFT.spectrum[i])*Math.sqrt(i+16);
			}

			// positive values of the difference between log spectrum and threshold
			let diff = new Array(NFFT/2);
			for (let i=IF_MIN; i<IF_MAX; i++) {
				diff[i] = Math.max(	Math.log(Math.max(1e-6,FFT.spectrum[i])) - this.threshold[i] , 0);
			}

			// find at most MNLM local maxima in the spectrum at this timestamp.
			let iLocMax = new Array(MNLM);
			let vLocMax = new Array(MNLM);
			for (let i=0; i<MNLM; i++) {
				iLocMax[i] = NaN;
				vLocMax[i] = Number.NEGATIVE_INFINITY;
			}
			for (let i=IF_MIN+1; i<IF_MAX-1; i++) {
				//console.log("checking local maximum at i=" + i + " data[i]=" + data[i] + " vLoc[last]=" + vLocMax[MNLM-1] );
				if (diff[i] > diff[i-1] && diff[i] > diff[i+1] && FFT.spectrum[i] > vLocMax[MNLM-1]) { // if local maximum big enough
					// insert the newly found local maximum in the ordered list of maxima
					for (let j=MNLM-1; j>=0; j--) {
						// navigate the table of previously saved maxima
						if (j >= 1 && FFT.spectrum[i] > vLocMax[j-1]) continue;
						for (let k=MNLM-1; k>=j+1; k--) {
							iLocMax[k] = iLocMax[k-1];	// offset the bottom values
							vLocMax[k] = vLocMax[k-1];
						}
						iLocMax[j] = i;
						vLocMax[j] = FFT.spectrum[i];
						break;
					}
				}
			}

			// now that we have the MNLM highest local maxima of the spectrum,
			// update the local maximum threshold so that only major peaks are taken into account.
			for (let i=0; i<MNLM; i++) {
				if (vLocMax[i] > Number.NEGATIVE_INFINITY) {
					for (let j=IF_MIN; j<IF_MAX; j++) {
						this.threshold[j] = Math.max(this.threshold[j], Math.log(FFT.spectrum[iLocMax[i]]) + EWW[iLocMax[i]][j]);
					}
				} else {
					vLocMax.splice(i,MNLM-i); // remove the last elements.
					iLocMax.splice(i,MNLM-i);
					break;
				}
			}

			// array that stores local maxima for each time step
			this.marks.push({"t": Math.round(this.stepIndex/STEP), "i":iLocMax, "v":vLocMax});

			// remove previous (in time) maxima that would be too close and/or too low.
			let nm = this.marks.length;
			let t0 = nm-PRUNING_DT-1;
			for (let i=nm-1; i>=Math.max(t0+1,0); i--) {
				//console.log("pruning ntests=" + this.marks[i].v.length);
				for (let j=0; j<this.marks[i].v.length; j++) {
					//console.log("pruning " + this.marks[i].v[j] + " <? " + this.threshold[this.marks[i].i[j]] + " * " + Math.pow(this.mask_decay, lenMarks-1-i));
					if (this.marks[i].i[j] != 0 && Math.log(this.marks[i].v[j]) < this.threshold[this.marks[i].i[j]] + MASK_DECAY_LOG * (nm-1-i)) {
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
				for (let i=0; i < m.i.length; i++) {
					let nFingers = 0;

					for (let j=t0; j>=Math.max(0,t0-WINDOW_DT); j--) {

						let m2 = this.marks[j];

						for (let k=0; k<m2.i.length; k++) {
							if (m2.i[k] != m.i[i] && Math.abs(m2.i[k] - m.i[i]) < WINDOW_DF) {
								tcodes.push(m.t); //Math.round(this.stepIndex/STEP));
								// in the hash: dt=(t0-j) has values between 0 and WINDOW_DT, so for <65 6 bits each
								//				f1=m2.i[k] , f2=m.i[i] between 0 and NFFT/2-1, so for <255 8 bits each.
								hcodes.push(m2.i[k] + NFFT/2 * (m.i[i] + NFFT/2 * (t0-j)));
								nFingers += 1;
								nFingersTotal += 1;
								if (nFingers >= MPPP) continue loopCurrentPeaks;
							}
						}
					}
				}
			}
			if (nFingersTotal > 0 && VERBOSE) {
				console.log("t=" + Math.round(this.stepIndex/STEP) + " generated " + nFingersTotal + " fingerprints");
			}
			
			this.marks.splice(0,t0+1-WINDOW_DT);

			// decrease the threshold for the next iteration
			for (let j=0; j<this.threshold.length; j++) {
				this.threshold[j] += MASK_DECAY_LOG;
			}
		}

		if (this.buffer.length > 1000000) {
			const delta = this.buffer.length - 20000;
			//console.log("buffer drop " + delta + " bytes");
			this.bufferDelta += delta;
			this.buffer = this.buffer.slice(delta);
		}

		if (VERBOSE) {
			console.log("fp processed " + (this.practicalDecodedBytes - this.decodedBytesSinceCallback) + " while threshold is " + (0.99*this.thresholdBytes));
		}

		if (tcodes.length > 0) {
			this.push({ tcodes: tcodes, hcodes: hcodes });
			// this will eventually trigger data events on the read interface
		}

		next();
	}
}
