// Globals of the AudioWorkletGlobalScope (not part of lib.dom).
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
declare function registerProcessor(name: string, ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;
declare const sampleRate: number;
declare const currentFrame: number;
declare const currentTime: number;

// Vite turns `?worker&url` imports into the URL of a separately bundled module (used for audio worklets).
declare module '*?worker&url' {
  const url: string;
  export default url;
}
