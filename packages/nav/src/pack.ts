const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DECODE = new Int16Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index += 1) DECODE[ALPHABET.charCodeAt(index)] = index;

function decodeChar(text: string, index: number): number {
  const code = text.charCodeAt(index);
  if (code > 127) throw new Error("invalid base64 character");
  const value = DECODE[code];
  if (value < 0) throw new Error("invalid base64 character");
  return value;
}

export function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index];
    const has1 = index + 1 < bytes.length;
    const has2 = index + 2 < bytes.length;
    const b1 = has1 ? bytes[index + 1] : 0;
    const b2 = has2 ? bytes[index + 2] : 0;
    output += ALPHABET[b0 >> 2];
    output += ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    output += has1 ? ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    output += has2 ? ALPHABET[b2 & 63] : "=";
  }
  return output;
}

export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0) throw new Error("base64 length must be a multiple of 4");
  let padding = 0;
  if (text.endsWith("==")) padding = 2;
  else if (text.endsWith("=")) padding = 1;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let offset = 0;
  for (let index = 0; index < text.length; index += 4) {
    const last = index + 4 === text.length;
    const pad2 = text[index + 2] === "=";
    const pad3 = text[index + 3] === "=";
    if (pad2 && !pad3) throw new Error("invalid base64 padding");
    if (pad2 && !last) throw new Error("invalid base64 padding");
    if (pad3 && !last) throw new Error("invalid base64 padding");
    const c0 = decodeChar(text, index);
    const c1 = decodeChar(text, index + 1);
    const c2 = pad2 ? 0 : decodeChar(text, index + 2);
    const c3 = pad3 ? 0 : decodeChar(text, index + 3);
    bytes[offset++] = (c0 << 2) | (c1 >> 4);
    if (!pad2) bytes[offset++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (!pad3) bytes[offset++] = ((c2 & 3) << 6) | c3;
  }
  return bytes;
}

export function encodeInt16Base64(values: ArrayLike<number>): string {
  const bytes = new Uint8Array(values.length * 2);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isInteger(value) || value < -32768 || value > 32767) {
      throw new Error("int16 value out of range at index " + index);
    }
    bytes[index * 2] = value & 255;
    bytes[index * 2 + 1] = (value >> 8) & 255;
  }
  return encodeBase64(bytes);
}

export function decodeInt16Base64(text: string, expectedLength: number): Int16Array {
  const bytes = decodeBase64(text);
  if (bytes.length !== expectedLength * 2) {
    throw new Error("int16 payload length mismatch: " + bytes.length + " != " + expectedLength * 2);
  }
  const output = new Int16Array(expectedLength);
  for (let index = 0; index < expectedLength; index += 1) {
    const value = bytes[index * 2] | (bytes[index * 2 + 1] << 8);
    output[index] = value >= 32768 ? value - 65536 : value;
  }
  return output;
}

export function encodeUint8Base64(values: ArrayLike<number>): string {
  const bytes = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error("uint8 value out of range at index " + index);
    }
    bytes[index] = value;
  }
  return encodeBase64(bytes);
}

export function decodeUint8Base64(text: string, expectedLength: number): Uint8Array {
  const bytes = decodeBase64(text);
  if (bytes.length !== expectedLength) {
    throw new Error("uint8 payload length mismatch: " + bytes.length + " != " + expectedLength);
  }
  return bytes;
}

export function encodeBitmapBase64(flags: ArrayLike<number>): string {
  const bytes = new Uint8Array(Math.ceil(flags.length / 8));
  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index]) bytes[index >> 3] |= 1 << (index & 7);
  }
  return encodeBase64(bytes);
}

export function decodeBitmapBase64(text: string, count: number): Uint8Array {
  const bytes = decodeBase64(text);
  const expected = Math.ceil(count / 8);
  if (bytes.length !== expected) {
    throw new Error("bitmap payload length mismatch: " + bytes.length + " != " + expected);
  }
  const output = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    output[index] = (bytes[index >> 3] >> (index & 7)) & 1;
  }
  return output;
}
