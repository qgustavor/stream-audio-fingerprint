# Audio Landmark Fingerprinting as a JavaScript module

This module converts a PCM audio signal into a series of audio fingerprints. It works with limited audio tracks (e.g. recorded audio) as well as with unlimited audio streams (e.g. broadcast radio).

It's based on [lpolito/stream-audio-fingerprint](https://github.com/lpolito/stream-audio-fingerprint) which is based [adblockradio/stream-audio-fingerprint](https://github.com/adblockradio/stream-audio-fingerprint) which is one of the foundations of the [Adblock Radio project](https://github.com/adblockradio/adblockradio).

## Credits and description

Check [the original project](https://github.com/adblockradio/stream-audio-fingerprint#credits) for credits and detailed info on the algorithm used. To be fair, even as the maintainer of this fork, I still don’t fully understand it.

## Usage

A usage demo is shown below. It requires the executable [ffmpeg](https://ffmpeg.org/download.html) and Deno to run.

```javascript
import Fingerprinter from 'npm:@qgustavor/stream-audio-fingerprint'

const decoder = (new Deno.Command('ffmpeg', {
  args: [
    '-i', 'pipe:0',
    '-acodec', 'pcm_s16le',
    '-ar', '22050',
    '-ac', '1',
    '-f', 's16le',
    '-v', 'fatal',
    'pipe:1'
  ],
  stdout: 'piped',
  stdin: 'inherit'
})).spawn()

const fingerprinter = new Fingerprinter()
const { dt } = fingerprinter.options

for await (const audioData of decoder.stdout.readable) {
  const data = fingerprinter.process(audioData)
  for (let i = 0; i < data.tcodes.length; i++) {
    console.log(`time=${data.tcodes[i] * dt} fingerprint=${data.hcodes[i]}`)
  }
}
```

and then we pipe audio data, either a stream or a file

```sh
curl http://radiofg.impek.com/fg | deno run --allow-run=ffmpeg codegen_demo.mjs
deno run --allow-run=ffmpeg codegen_demo.mjs < awesome_music.mp3
```

## Fingerprinter options

One improvement from the [Lucas Polito](https://github.com/lpolito) fork is the ability to customize the fingerprinter options. Those are all the options available:

* `verbose`: whether to print debug information to `console.log`.

* `samplingRate`: the sampling rate of the audio input in Hz. Defaults to `22050`.

  * If you change this, you must also adapt `windowDt` and `pruningDt` to match your needs.
  * For more info, read the comments in the code.

* `bps`: bytes per sample. Defaults to `2` (16-bit PCM).

  * Do not change this without checking the code first.

* `mnlm`: maximum number of local maxima detected in each FFT spectrum. Defaults to `5`.

  * Higher values increase the number of fingerprints produced.

* `mppp`: maximum number of hashes (fingerprints) each peak can generate. Defaults to `3`.

  * Useful for tuning the density of fingerprints.

* `nfft`: size of the FFT window. Defaults to `512`.

  * Larger values improve *spectral precision* (frequency resolution) but reduce *temporal precision*.
  * The FFT spectrum will have `nfft / 2` points.

* `step`: number of samples to advance between successive FFT windows. Defaults to `nfft / 2` (50% overlap).

  * With a sampling rate of 22050 Hz, this yields ~86 windows per second (`dt ≈ 11.61 ms`).
  * Typically you don’t need to change this.

* `dt`: duration of each time step in seconds.

  * Defaults to `1 / (samplingRate / step)`.
  * It's useful to convert `tcodes` into seconds, just multiply `tcodes` by `fingerprinter.options.dt` and you get the time in seconds, as shown in the demos.

* `hwin`: the Hann window applied to each FFT frame. Defaults to a precomputed array of size `nfft`.

  * Adjusting this is rare unless experimenting with different window functions.

* `maskDecayLog`: logarithmic decay factor for the detection threshold between frames. Defaults to `Math.log(0.995)`.

  * Affects how quickly old peaks become irrelevant.

* `ifMin`: minimum frequency bin (in units of `DF = samplingRate / nfft`) to consider when generating fingerprints. Defaults to `0`.

  * Increase this to ignore very low frequencies.

* `ifMax`: maximum frequency bin to consider when generating fingerprints. Defaults to `nfft / 2`.

  * Usually best left unchanged. To reduce processing time, lower `samplingRate` instead.

* `windowDf`: maximum allowed frequency difference between paired peaks. Defaults to `60`.

  * Limits fingerprint generation to peaks within a certain frequency range of each other.
  * Reducing this reduces fingerprint density.

* `windowDt`: maximum time window (in units of `dt`) for generating landmark pairs. Defaults to `96` (~1 second).

  * Controls how far apart peaks can be and still generate fingerprints.

* `pruningDt`: time window (in units of `dt`) used to prune older peaks that are overshadowed by newer ones. Defaults to `24` (~250 ms).

  * Also affects system latency: higher values increase latency.

* `maskDf`: decay scale of the exponential mask on the frequency axis. Defaults to `3`.

  * Wider masks reduce sensitivity to small frequency variations.

* `eww`: precomputed 2D exponential mask (log-domain) matrix of size `(nfft / 2) × (nfft / 2)`. Defaults to a generated Gaussian-like mask based on `maskDf`.

  * Advanced option for customizing the spectral masking behavior.

## Node.js Usage

This code also works in Node.js and is available in NPM via `npm install @qgustavor/stream-audio-fingerprint`.

The previous demo can be rewritten as this:

```javascript
import Fingerprinter from '@qgustavor/stream-audio-fingerprint'
import { spawn } from 'child_process'

const decoder = spawn('ffmpeg', [
  '-i', 'pipe:0',
  '-acodec', 'pcm_s16le',
  '-ar', '22050',
  '-ac', '1',
  '-f', 's16le',
  '-v', 'fatal',
  'pipe:1'
])

const fingerprinter = new Fingerprinter()
const { dt } = fingerprinter.options

for await (const audioData of decoder.stdout) {
  const data = fingerprinter.process(audioData)
  for (let i = 0; i < data.tcodes.length; i++) {
    console.log(`time=${data.tcodes[i] * dt} fingerprint=${data.hcodes[i]}`)
  }
}
```

## TypeScript

This module already includes TypeScript types.

## License

See LICENSE file.
