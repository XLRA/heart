// One persistent Web Audio graph per <audio> element. An HTMLMediaElement can
// only ever be captured by ONE MediaElementSourceNode for its lifetime
// (Chrome throws InvalidStateError on a second createMediaElementSource, and
// closing the owning context permanently silences the element). The graph
// (context + source wired to destination) is created once and kept for the
// page's lifetime; analyzers attach to it as side-chains.

export interface ElementAudioGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
}

const graphs = new WeakMap<HTMLMediaElement, ElementAudioGraph>();

export function getOrCreateElementGraph(element: HTMLMediaElement): ElementAudioGraph {
  let graph = graphs.get(element);
  if (!graph) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(element);
    source.connect(ctx.destination);
    graph = { ctx, source };
    graphs.set(element, graph);
  }
  return graph;
}

/** Seconds between the element's currentTime and the moment that audio is
 *  actually heard (processing + output buffering). */
export function elementOutputLatency(element: HTMLMediaElement): number {
  const g = graphs.get(element);
  if (!g) return 0.02;
  return (g.ctx.baseLatency || 0) + (g.ctx.outputLatency || 0);
}
