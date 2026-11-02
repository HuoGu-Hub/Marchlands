import { describe, expect, it } from "vitest";
import {
  decodeBitmapBase64,
  decodeInt16Base64,
  decodeUint8Base64,
  encodeBitmapBase64,
  encodeInt16Base64,
  encodeUint8Base64,
} from "../src";

function bytesOf(values: number[]): Buffer {
  return Buffer.from(values);
}

describe("nav grid packing", () => {
  it("round trips int16 heights in little endian", () => {
    const heights = [-32768, -1, 0, 1, 25, 32767];
    const encoded = encodeInt16Base64(heights);
    expect(encoded).toBe(bytesOf([0x00, 0x80, 0xff, 0xff, 0x00, 0x00, 0x01, 0x00, 0x19, 0x00, 0xff, 0x7f]).toString("base64"));
    expect(Array.from(decodeInt16Base64(encoded, heights.length))).toEqual(heights);
  });

  it("round trips uint8 surfaces", () => {
    const surfaces = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 255];
    const encoded = encodeUint8Base64(surfaces);
    expect(encoded).toBe(bytesOf(surfaces).toString("base64"));
    expect(Array.from(decodeUint8Base64(encoded, surfaces.length))).toEqual(surfaces);
  });

  it("round trips bitmaps whose length is not a multiple of eight", () => {
    const flags = [1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1];
    const encoded = encodeBitmapBase64(flags);
    expect(Array.from(decodeBitmapBase64(encoded, flags.length))).toEqual(flags);
  });

  it("rejects malformed payloads", () => {
    expect(() => decodeInt16Base64("", 1)).toThrow();
    expect(() => decodeUint8Base64(encodeUint8Base64([1, 2]), 1)).toThrow();
    expect(() => decodeBitmapBase64(encodeBitmapBase64([1]), 20)).toThrow();
    expect(() => decodeInt16Base64("!!!!", 2)).toThrow();
    expect(() => encodeInt16Base64([40000])).toThrow();
    expect(() => encodeUint8Base64([-1])).toThrow();
  });
});
