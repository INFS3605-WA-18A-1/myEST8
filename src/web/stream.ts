// A response body from bytes already in memory, sent as a stream. Vercel limits a
// buffered response to 4.5 MB; a streamed one has no such limit, and photos can be bigger.

const CHUNK = 64 * 1024;

export function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.byteLength; i += CHUNK) controller.enqueue(new Uint8Array(bytes.subarray(i, i + CHUNK)));
      controller.close();
    },
  });
}
