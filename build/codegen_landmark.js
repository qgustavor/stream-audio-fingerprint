"use strict";
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
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
var stream_1 = require("stream");
var buffer_1 = require("buffer");
var dsp_js_1 = require("dsp.js");
var buildOptions = function (options) {
    var verbose = options.verbose || false;
    // sampling rate in Hz. If you change this, you must adapt windowDt and pruningDt below to match your needs
    // set the Nyquist frequency, SAMPLING_RATE/2,
    // so as to match the max frequencies you want to get landmark fingerprints.
    var samplingRate = options.samplingRate || 22050;
    // bytes per sample, 2 for 16 bit PCM. If you change this, you must change readInt16LE methods in the code.
    var bps = options.bps || 2;
    // maximum number of local maxima for each spectrum. useful to tune the amount of fingerprints at output
    var mnlm = options.mnlm || 5;
    // maximum of hashes each peak can lead to. useful to tune the amount of fingerprints at output
    var mppp = options.mppp || 3;
    // size of the FFT window. As we use real signals, the spectra will have nfft/2 points.
    // Increasing it will give more spectral precision, less temporal precision.
    // It may be good or bad depending on the sounds you want to match,
    // and on whether your input is deformed by EQ or noise.
    var nfft = options.nfft || 512;
    // 50 % overlap
    // if SAMPLING_RATE is 22050 Hz, this leads to a sampling frequency
    // fs = (SAMPLING_RATE / step) /s = 86/s, or dt = 1/fs = 11,61 ms.
    // It's not really useful to change the overlap ratio.
    var step = options.step || (nfft / 2);
    var dt = options.dt || (1 / (samplingRate / step));
    var hwin = options.hwin || (Array(nfft).fill(null).map(function (f, i) { return (0.5 * (1 - Math.cos(((2 * Math.PI) * i) / (nfft - 1)))); }));
    // threshold decay factor between frames.
    var maskDecayLog = options.maskDecayLog || Math.log(0.995);
    // frequency window to generate landmark pairs, in units of DF = SAMPLING_RATE / NFFT. Values between 0 and NFFT/2
    // you can increase this to avoid having fingerprints for low frequencies
    var ifMin = options.ifMin || 0;
    // you don't really want to decrease this, better reduce SAMPLING_RATE instead for faster computation.
    var ifMax = options.ifMax || nfft / 2;
    // we set this to avoid getting fingerprints linking very different frequencies.
    // useful to reduce the amount of fingerprints. this can be maxed at NFFT/2 if you wish.
    var windowDf = options.windowDf || 60;
    // time window to generate landmark pairs. time in units of dt (see definition above)
    // a little more than 1 sec.
    var windowDt = options.windowDt || 96;
    // about 250 ms, window to remove previous peaks that are superseded by later ones.
    // tune the pruningDt value to match the effects of maskDecayLog.
    // also, pruningDt controls the latency of the pipeline. higher pruningDt = higher latency
    var pruningDt = options.pruningDt || 24;
    // prepare the values of exponential masks.
    // mask decay scale in DF units on the frequency axis.
    var maskDf = options.maskDf || 3;
    // gaussian mask is a polynom when working on the log-spectrum. log(exp()) = Id()
    // MASK_DF is multiplied by Math.sqrt(i+3) to have wider masks at higher frequencies
    // see the visualization out-thr.png for better insight of what is happening
    var eww = options.eww || (Array(nfft / 2).fill(null).map(function (f, i) { return (Array(nfft / 2).fill(null).map(function (f2, j) { return (
    // eslint-disable-next-line no-restricted-properties
    -0.5 * Math.pow((j - i) / maskDf / Math.sqrt(i + 3), 2)); })); }));
    return {
        verbose: verbose,
        samplingRate: samplingRate,
        bps: bps,
        mnlm: mnlm,
        mppp: mppp,
        nfft: nfft,
        step: step,
        dt: dt,
        hwin: hwin,
        maskDecayLog: maskDecayLog,
        ifMin: ifMin,
        ifMax: ifMax,
        windowDf: windowDf,
        windowDt: windowDt,
        pruningDt: pruningDt,
        maskDf: maskDf,
        eww: eww,
    };
};
var Codegen = /** @class */ (function (_super) {
    __extends(Codegen, _super);
    function Codegen(transformOptions, options) {
        var _this = _super.call(this, __assign({ readableObjectMode: true, highWaterMark: 10 }, transformOptions || {})) || this;
        _this.options = {};
        _this._transform = function (chunk, enc, next) {
            var _a = _this.options, verbose = _a.verbose, bps = _a.bps, mnlm = _a.mnlm, mppp = _a.mppp, nfft = _a.nfft, step = _a.step, hwin = _a.hwin, maskDecayLog = _a.maskDecayLog, ifMin = _a.ifMin, ifMax = _a.ifMax, windowDf = _a.windowDf, windowDt = _a.windowDt, pruningDt = _a.pruningDt, eww = _a.eww;
            if (verbose)
                console.log("t=" + Math.round(_this.stepIndex / step) + " received " + chunk.length + " bytes");
            var tcodes = [];
            var hcodes = [];
            _this.buffer = buffer_1.Buffer.concat([_this.buffer, chunk]);
            while ((_this.stepIndex + nfft) * bps < _this.buffer.length + _this.bufferDelta) {
                var data = new Array(nfft); // window data
                // fill the data, windowed (HWIN) and scaled
                for (var i = 0, limit = nfft; i < limit; i += 1) {
                    data[i] = (hwin[i]
                        * _this.buffer.readInt16LE((_this.stepIndex + i) * bps - _this.bufferDelta)
                    // eslint-disable-next-line no-restricted-properties
                    ) / Math.pow(2, 8 * bps - 1);
                }
                _this.stepIndex += step;
                _this.fft.forward(data); // compute FFT
                // log-normal surface
                for (var i = ifMin; i < ifMax; i += 1) {
                    // the lower part of the spectrum is damped,
                    // the higher part is boosted, leading to a better peaks detection.
                    _this.fft.spectrum[i] = Math.abs(_this.fft.spectrum[i]) * Math.sqrt(i + 16);
                }
                // positive values of the difference between log spectrum and threshold
                var diff = new Array(nfft / 2);
                for (var i = ifMin; i < ifMax; i += 1) {
                    diff[i] = Math.max(Math.log(Math.max(1e-6, _this.fft.spectrum[i])) - _this.threshold[i], 0);
                }
                // find at most MNLM local maxima in the spectrum at this timestamp.
                var iLocMax = new Array(mnlm);
                var vLocMax = new Array(mnlm);
                for (var i = 0; i < mnlm; i += 1) {
                    iLocMax[i] = NaN;
                    vLocMax[i] = Number.NEGATIVE_INFINITY;
                }
                for (var i = ifMin + 1; i < ifMax - 1; i += 1) {
                    if (diff[i] > diff[i - 1]
                        && diff[i] > diff[i + 1]
                        && _this.fft.spectrum[i] > vLocMax[mnlm - 1]) { // if local maximum big enough
                        // insert the newly found local maximum in the ordered list of maxima
                        for (var j = mnlm - 1; j >= 0; j -= 1) {
                            // navigate the table of previously saved maxima
                            // eslint-disable-next-line no-continue
                            if (j >= 1 && _this.fft.spectrum[i] > vLocMax[j - 1])
                                continue;
                            for (var k = mnlm - 1; k >= j + 1; k -= 1) {
                                iLocMax[k] = iLocMax[k - 1]; // offset the bottom values
                                vLocMax[k] = vLocMax[k - 1];
                            }
                            iLocMax[j] = i;
                            vLocMax[j] = _this.fft.spectrum[i];
                            break;
                        }
                    }
                }
                // now that we have the MNLM highest local maxima of the spectrum,
                // update the local maximum threshold so that only major peaks are taken into account.
                for (var i = 0; i < mnlm; i += 1) {
                    if (vLocMax[i] > Number.NEGATIVE_INFINITY) {
                        for (var j = ifMin; j < ifMax; j += 1) {
                            _this.threshold[j] = (Math.max(_this.threshold[j], Math.log(_this.fft.spectrum[iLocMax[i]]) + eww[iLocMax[i]][j]));
                        }
                    }
                    else {
                        vLocMax.splice(i, mnlm - i); // remove the last elements.
                        iLocMax.splice(i, mnlm - i);
                        break;
                    }
                }
                // array that stores local maxima for each time step
                _this.marks.push({ t: Math.round(_this.stepIndex / step), i: iLocMax, v: vLocMax });
                // remove previous (in time) maxima that would be too close and/or too low.
                var nm = _this.marks.length;
                var t0 = nm - pruningDt - 1;
                for (var i = nm - 1; i >= Math.max(t0 + 1, 0); i -= 1) {
                    // console.log("pruning ntests=" + this.marks[i].v.length);
                    for (var j = 0; j < _this.marks[i].v.length; j += 1) {
                        if (_this.marks[i].i[j] !== 0
                            && Math.log(_this.marks[i].v[j]) < (_this.threshold[_this.marks[i].i[j]] + maskDecayLog * (nm - 1 - i))) {
                            _this.marks[i].v[j] = Number.NEGATIVE_INFINITY;
                            _this.marks[i].i[j] = Number.NEGATIVE_INFINITY;
                        }
                    }
                }
                // generate hashes for peaks that can no longer be pruned. stepIndex:{f1:f2:deltaindex}
                var nFingersTotal = 0;
                if (t0 >= 0) {
                    var m = _this.marks[t0];
                    // eslint-disable-next-line no-restricted-syntax, no-labels
                    loopCurrentPeaks: for (var i = 0; i < m.i.length; i += 1) {
                        var nFingers = 0;
                        for (var j = t0; j >= Math.max(0, t0 - windowDt); j -= 1) {
                            var m2 = _this.marks[j];
                            for (var k = 0; k < m2.i.length; k += 1) {
                                if (m2.i[k] !== m.i[i] && Math.abs(m2.i[k] - m.i[i]) < windowDf) {
                                    tcodes.push(m.t); // Math.round(this.stepIndex/STEP));
                                    hcodes.push(m2.i[k] + (nfft / 2) * (m.i[i] + (nfft / 2) * (t0 - j)));
                                    nFingers += 1;
                                    nFingersTotal += 1;
                                    // eslint-disable-next-line no-continue, no-labels
                                    if (nFingers >= mppp)
                                        continue loopCurrentPeaks;
                                }
                            }
                        }
                    }
                }
                if (nFingersTotal > 0 && verbose) {
                    console.log("t=" + Math.round(_this.stepIndex / step) + " generated " + nFingersTotal + " fingerprints");
                }
                _this.marks.splice(0, t0 + 1 - windowDt);
                // decrease the threshold for the next iteration
                for (var j = 0; j < _this.threshold.length; j += 1) {
                    _this.threshold[j] += maskDecayLog;
                }
            }
            if (_this.buffer.length > 1000000) {
                var delta = _this.buffer.length - 20000;
                // console.log("buffer drop " + delta + " bytes");
                _this.bufferDelta += delta;
                _this.buffer = _this.buffer.slice(delta);
            }
            if (tcodes.length > 0) {
                _this.push({ tcodes: tcodes, hcodes: hcodes });
                // this will eventually trigger data events on the read interface
            }
            next();
        };
        _this.options = buildOptions(options || {});
        _this.buffer = buffer_1.Buffer.alloc(0);
        _this.bufferDelta = 0;
        _this.stepIndex = 0;
        _this.marks = [];
        _this.threshold = Array(_this.options.nfft).fill(null).map(function () { return -3; });
        _this.fft = new dsp_js_1.FFT(_this.options.nfft, _this.options.samplingRate);
        return _this;
    }
    return Codegen;
}(stream_1.Transform));
exports.default = Codegen;
