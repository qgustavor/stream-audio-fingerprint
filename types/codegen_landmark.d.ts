import FFT from './fft.ts'
interface CodegenOptions {
  verbose: boolean
  samplingRate: number
  bps: number
  mnlm: number
  mppp: number
  nfft: number
  step: number
  dt: number
  hwin: number[]
  maskDecayLog: number
  ifMin: number
  ifMax: number
  windowDf: number
  windowDt: number
  pruningDt: number
  maskDf: number
  eww: number[][]
}
interface CodegenUserOpts {
  verbose?: boolean
  samplingRate?: number
  bps?: number
  mnlm?: number
  mppp?: number
  nfft?: number
  step?: number
  dt?: number
  hwin?: number[]
  maskDecayLog?: number
  ifMin?: number
  ifMax?: number
  windowDf?: number
  windowDt?: number
  pruningDt?: number
  maskDf?: number
  eww?: number[][]
}
interface Mark {
  t: number
  i: number[]
  v: number[]
}
export interface CodegenBuffer {
  tcodes: number[]
  hcodes: number[]
}
declare class Codegen {
  options: CodegenOptions
  buffer: Uint8Array
  bufferDelta: number
  stepIndex: number
  marks: Mark[]
  threshold: number[]
  fft: FFT
  constructor (options?: CodegenUserOpts);
  process (chunk: Uint8Array): CodegenBuffer;
}
export default Codegen
