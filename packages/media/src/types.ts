/**
 * Where encoded bytes are written.
 *
 * A plain `WritableStream<Uint8Array>` so the package's surface stays free of
 * mediabunny types, and so it accepts the obvious targets directly — an OPFS
 * `FileSystemWritableFileStream`, or the request side of an upload.
 */
export type MediaWriteSink = WritableStream<Uint8Array>

/** Positional file writes, directly compatible with FileSystemWritableFileStream. */
export interface MediaFileWrite {
  type: 'write'
  position: number
  data: Uint8Array<ArrayBuffer>
}
export type MediaFileSink = WritableStream<MediaFileWrite>
