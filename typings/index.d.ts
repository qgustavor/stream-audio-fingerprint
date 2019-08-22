declare module 'stream-audio-fingerprint' {
    import {Transform, TransformOptions} from 'stream';

    class Codegen extends Transform {
        constructor(transformOptions?: TransformOptions, codegenOptions?: any);
        plot(): any;
    }

    export default Codegen;
  }
