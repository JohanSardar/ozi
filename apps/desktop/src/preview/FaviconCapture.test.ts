import { expect, it } from "vite-plus/test";

import { sourceDimensions } from "./FaviconCapture.ts";
const SOURCE_PNG = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(SOURCE_PNG);
SOURCE_PNG.writeUInt32BE(1, 16);
SOURCE_PNG.writeUInt32BE(1, 20);

function sourceGif(
  width: number,
  height: number,
  frameWidth = width,
  frameHeight = height,
  additionalFrames: ReadonlyArray<{
    readonly left?: number;
    readonly top?: number;
    readonly width: number;
    readonly height: number;
  }> = [],
): Buffer {
  const frames = [{ width: frameWidth, height: frameHeight }, ...additionalFrames];
  const buffer = Buffer.alloc(13 + frames.length * 12 + 1);
  buffer.write("GIF89a", 0, "ascii");
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  let offset = 13;
  for (const frame of frames) {
    buffer[offset] = 0x2c;
    buffer.writeUInt16LE(frame.left ?? 0, offset + 1);
    buffer.writeUInt16LE(frame.top ?? 0, offset + 3);
    buffer.writeUInt16LE(frame.width, offset + 5);
    buffer.writeUInt16LE(frame.height, offset + 7);
    offset += 10;
    buffer[offset] = 2;
    buffer[offset + 1] = 0;
    offset += 2;
  }
  buffer[offset] = 0x3b;
  return buffer;
}

it.each([
  ["logical pixels", sourceGif(2048, 1024), { width: 2048, height: 1024 }],
  [
    "cumulative frame pixels",
    sourceGif(1024, 1024, 1024, 1024, [{ width: 1024, height: 1024 }]),
    { width: 1024, height: 1024 },
  ],
])("uses the caller's GIF limit for %s while keeping the favicon limit", (_, gif, dimensions) => {
  expect(sourceDimensions(gif)).toBeNull();
  expect(sourceDimensions(gif, 8_388_608)).toEqual(dimensions);
});
