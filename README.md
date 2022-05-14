# Audio landmark fingerprinting as a JavaScript module

This module is module that converts a PCM audio signal into a series of audio fingerprints. It works with audio tracks as well as with unlimited audio streams, e.g. broadcast radio.

It's based on [lpolito/stream-audio-fingerprint](https://github.com/lpolito/stream-audio-fingerprint) which is based [adblockradio/stream-audio-fingerprint](https://github.com/adblockradio/stream-audio-fingerprint) which is one of the foundations of the [Adblock Radio project](https://github.com/adblockradio/adblockradio).

## Credits and description

Check [the original project](https://github.com/adblockradio/stream-audio-fingerprint#credits).

## Usage

```sh
npm install @qgustavor/stream-audio-fingerprint
```

The algorithm is in `src/codegen_landmark.ts`.

A demo usage is proposed below. It requires the executable [ffmpeg](https://ffmpeg.org/download.html) and Deno to run.

```javascript
import Codegen from './codegen_landmark.ts'

const decoder = Deno.run({
  cmd: [
    'ffmpeg',
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
})

const fingerprinter = new Codegen()
for await (const audioData of decoder.stdout.readable) {
  const data = fingerprinter.process(audioData)
  for (let i = 0; i < data.tcodes.length; i++) {
    console.log(`time=${data.tcodes[i]} fingerprint=${data.hcodes[i]}`)
  }
}
```

and then we pipe audio data, either a stream or a file

```sh
curl http://radiofg.impek.com/fg | deno run --allow-run=ffmpeg codegen_demo.mjs
deno run --allow-run=ffmpeg codegen_demo.mjs < awesome_music.mp3
```

Type definitions are not included because Deno can load TypeScript files directly and because [this TypeScript issue](https://github.com/microsoft/TypeScript/issues/37582).

## License

See LICENSE file.
