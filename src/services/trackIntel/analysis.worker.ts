// Web Worker wrapper around analyzePcm so a full-song analysis (~1-2 s of
// CPU) never blocks the heart's render loop.
import { analyzePcm, type GrooveModel } from './analysis';

interface Request {
  id: number;
  pcm: Float32Array;
  sampleRate: number;
  bpmHint?: number;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, pcm, sampleRate, bpmHint } = e.data;
  try {
    const model: GrooveModel = analyzePcm(pcm, sampleRate, { bpmHint });
    const buffers = [model.bass, model.mid, model.treble, model.overall, model.centroid, model.flatness, model.onset, model.lowOnset].map((a) => a.buffer as ArrayBuffer);
    scope.postMessage({ id, model }, buffers);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
