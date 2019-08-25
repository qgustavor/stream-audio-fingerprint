/// <reference types="node" />
import { Transform, TransformOptions } from 'stream';
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
declare class Codegen extends Transform {
    options: CodegenOptions;
    buffer: Buffer;
    bufferDelta: number;
    stepIndex: number;
    marks: Mark[];
    threshold: number[];
    fft: any;
    constructor(transformOptions?: TransformOptions, options?: CodegenUserOpts);
    _transform: Transform['_transform'];
}
export default Codegen;
