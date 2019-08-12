declare module 'stream-audio-fingerprint' {
    import {Transform, TransformOptions} from 'stream';

    class Codegen extends Transform {
        plot(): any;
    }

    export default Codegen;
  }
