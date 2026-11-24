/**
 * Save growth (24 November 2026): a small, dependency-free raw DEFLATE (RFC 1951) coder and base64, used to store the
 * compact-3 save text compressed (`compact-3-deflate`, `season-storage.ts`). The compact layout repeats short patterns
 * (ledger rows, results, reports) that DEFLATE shrinks about five-fold, so a long career's save grows far more slowly.
 *
 * The output is ordinary DEFLATE (dynamic Huffman blocks), readable by any inflater; the inflater reads any valid DEFLATE
 * stream (stored, fixed and dynamic blocks). Input to `inflateRaw` is untrusted: every table and length is checked and
 * the output never exceeds the size the caller expects.
 */

// Length codes 257-285: base lengths and extra bits; distance codes 0-29: base distances and extra bits.
const LENGTH_BASE = new Uint16Array([3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]);
const LENGTH_EXTRA = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]);
const DIST_BASE = new Uint16Array([1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]);
const DIST_EXTRA = new Uint8Array([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]);
const CODE_LENGTH_ORDER = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

function fail(reason: string): never { throw new Error(`The compressed save data ${reason}.`); }

function reverseBits(code: number, length: number): number {
  let reversed = 0;
  for (let bit = 0; bit < length; bit += 1) { reversed = (reversed << 1) | (code & 1); code >>>= 1; }
  return reversed;
}

/** Canonical codes (RFC 1951 3.2.2) for the given code lengths, bit-reversed for LSB-first writing. */
function canonicalCodes(lengths: Uint8Array, maxBits: number): Uint16Array {
  const count = new Uint16Array(maxBits + 1), next = new Uint16Array(maxBits + 2), codes = new Uint16Array(lengths.length);
  for (const length of lengths) if (length) count[length]! += 1;
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits += 1) { code = (code + count[bits - 1]!) << 1; next[bits] = code; }
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol]!;
    if (length) codes[symbol] = reverseBits(next[length]!++, length);
  }
  return codes;
}

// ---------------------------------------------------------------------------------------------------------------
// Inflate

interface DecodeTable { table: Int32Array; bits: number }

/**
 * A single-level lookup table: index = the next `bits` input bits, value = symbol << 4 | code length (0: invalid).
 * Over-subscribed code sets are refused; incomplete ones only when a single code of length 1 is used (as zlib allows).
 */
function decodeTable(lengths: Uint8Array, what: string): DecodeTable {
  let maxBits = 0, used = 0;
  for (const length of lengths) if (length) { used += 1; if (length > maxBits) maxBits = length; }
  if (!used) return { table: new Int32Array(2), bits: 1 };
  const count = new Uint16Array(16);
  for (const length of lengths) if (length) count[length]! += 1;
  let left = 1;
  for (let bits = 1; bits <= 15; bits += 1) { left = left * 2 - count[bits]!; if (left < 0) fail(`has an over-subscribed ${what} code`); }
  if (left > 0 && !(used === 1 && maxBits === 1)) fail(`has an incomplete ${what} code`);
  const codes = canonicalCodes(lengths, 15), size = 1 << maxBits, table = new Int32Array(size);
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol]!;
    if (!length) continue;
    for (let index = codes[symbol]!; index < size; index += 1 << length) table[index] = (symbol << 4) | length;
  }
  return { table, bits: maxBits };
}

let fixedTables: { literals: DecodeTable; distances: DecodeTable } | undefined;
function fixedDecodeTables() {
  if (!fixedTables) {
    const literals = new Uint8Array(288);
    literals.fill(8, 0, 144); literals.fill(9, 144, 256); literals.fill(7, 256, 280); literals.fill(8, 280, 288);
    fixedTables = { literals: decodeTable(literals, 'literal'), distances: decodeTable(new Uint8Array(32).fill(5), 'distance') };
  }
  return fixedTables;
}

/** Inflate a raw DEFLATE stream that must expand to exactly `expectedLength` bytes. */
export function inflateRaw(input: Uint8Array, expectedLength: number): Uint8Array {
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0) fail('has an invalid expected size');
  const output = new Uint8Array(expectedLength);
  let out = 0, position = 0, buffer = 0, held = 0;
  const need = (bits: number) => {
    while (held < bits) {
      if (position >= input.length) fail('ends early');
      buffer |= input[position++]! << held; held += 8;
    }
  };
  const take = (bits: number): number => {
    if (!bits) return 0;
    need(bits);
    const value = buffer & ((1 << bits) - 1);
    buffer >>>= bits; held -= bits;
    return value;
  };
  const decode = ({ table, bits }: DecodeTable): number => {
    // Fill as many bits as are available up to the table width; a valid code may be shorter than the width.
    while (held < bits && position < input.length) { buffer |= input[position++]! << held; held += 8; }
    const entry = table[buffer & ((1 << bits) - 1)]!, length = entry & 15;
    if (!length || length > held) fail('has an invalid code');
    buffer >>>= length; held -= length;
    return entry >> 4;
  };
  let final = 0;
  while (!final) {
    final = take(1);
    const type = take(2);
    if (type === 0) {
      // Stored blocks start at a byte boundary: drop the partial byte and give back whole bytes read ahead.
      const partial = held & 7;
      buffer >>>= partial; held -= partial; position -= held >> 3; buffer = 0; held = 0;
      if (position + 4 > input.length) fail('ends early');
      const length = input[position]! | (input[position + 1]! << 8), check = input[position + 2]! | (input[position + 3]! << 8);
      position += 4;
      if ((length ^ 0xffff) !== check) fail('has a damaged stored block');
      if (position + length > input.length) fail('ends early');
      if (out + length > expectedLength) fail('expands beyond its recorded size');
      output.set(input.subarray(position, position + length), out);
      out += length; position += length;
      continue;
    }
    let literals: DecodeTable, distances: DecodeTable;
    if (type === 1) ({ literals, distances } = fixedDecodeTables());
    else if (type === 2) {
      const literalCount = take(5) + 257, distanceCount = take(5) + 1, codeLengthCount = take(4) + 4;
      if (literalCount > 286 || distanceCount > 30) fail('has too many codes');
      const codeLengths = new Uint8Array(19);
      for (let index = 0; index < codeLengthCount; index += 1) codeLengths[CODE_LENGTH_ORDER[index]!] = take(3);
      const lengthTable = decodeTable(codeLengths, 'code length');
      const lengths = new Uint8Array(literalCount + distanceCount);
      for (let index = 0; index < lengths.length;) {
        const symbol = decode(lengthTable);
        if (symbol < 16) { lengths[index++] = symbol; continue; }
        let repeat: number, value = 0;
        if (symbol === 16) { if (!index) fail('repeats a missing code length'); value = lengths[index - 1]!; repeat = 3 + take(2); }
        else if (symbol === 17) repeat = 3 + take(3);
        else repeat = 11 + take(7);
        if (index + repeat > lengths.length) fail('repeats too many code lengths');
        lengths.fill(value, index, index + repeat); index += repeat;
      }
      if (!lengths[256]) fail('has no end-of-block code');
      literals = decodeTable(lengths.subarray(0, literalCount), 'literal');
      distances = decodeTable(lengths.subarray(literalCount), 'distance');
    } else fail('uses an unknown block type');
    for (;;) {
      const symbol = decode(literals);
      if (symbol < 256) {
        if (out >= expectedLength) fail('expands beyond its recorded size');
        output[out++] = symbol;
        continue;
      }
      if (symbol === 256) break;
      const lengthCode = symbol - 257;
      if (lengthCode >= 29) fail('has an invalid length code');
      const length = LENGTH_BASE[lengthCode]! + take(LENGTH_EXTRA[lengthCode]!);
      const distanceCode = decode(distances);
      if (distanceCode >= 30) fail('has an invalid distance code');
      const distance = DIST_BASE[distanceCode]! + take(DIST_EXTRA[distanceCode]!);
      if (distance > out) fail('refers before its start');
      if (out + length > expectedLength) fail('expands beyond its recorded size');
      for (let index = 0; index < length; index += 1, out += 1) output[out] = output[out - distance]!;
    }
  }
  if (out !== expectedLength) fail('does not match its recorded size');
  return output;
}

// ---------------------------------------------------------------------------------------------------------------
// Deflate

/** Huffman code lengths of at most `limit` bits; frequencies are halved until the tree fits (rare, slightly suboptimal). */
function codeLengths(frequencies: Uint32Array, limit: number): Uint8Array {
  const symbols = frequencies.length, lengths = new Uint8Array(symbols);
  const freq = Array.from(frequencies);
  for (;;) {
    const leaves: number[] = [];
    for (let symbol = 0; symbol < symbols; symbol += 1) if (freq[symbol]! > 0) leaves.push(symbol);
    lengths.fill(0);
    if (leaves.length === 1) { lengths[leaves[0]!] = 1; return lengths; }
    if (!leaves.length) return lengths;
    // Nodes: leaves first, then internal nodes; a two-queue Huffman construction over leaves sorted by frequency.
    leaves.sort((left, right) => freq[left]! - freq[right]! || left - right);
    const weight: number[] = leaves.map(symbol => freq[symbol]!), parent: number[] = new Array(leaves.length * 2 - 1).fill(-1);
    let leaf = 0, internal = leaves.length, made = leaves.length;
    const pick = () => (leaf < leaves.length && (internal >= made || weight[leaf]! <= weight[internal]!)) ? leaf++ : internal++;
    while (made < leaves.length * 2 - 1) {
      const first = pick(), second = pick();
      weight[made] = weight[first]! + weight[second]!;
      parent[first] = made; parent[second] = made;
      made += 1;
    }
    const depth = new Array<number>(made).fill(0);
    for (let node = made - 2; node >= 0; node -= 1) depth[node] = depth[parent[node]!]! + 1;
    let longest = 0;
    for (let index = 0; index < leaves.length; index += 1) { lengths[leaves[index]!] = depth[index]!; if (depth[index]! > longest) longest = depth[index]!; }
    if (longest <= limit) return lengths;
    for (let symbol = 0; symbol < symbols; symbol += 1) if (freq[symbol]! > 0) freq[symbol] = Math.max(1, freq[symbol]! >> 1);
  }
}

class BitWriter {
  bytes = new Uint8Array(1 << 16);
  length = 0;
  private buffer = 0;
  private held = 0;
  private ensure(extra: number) {
    if (this.length + extra <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + extra) size *= 2;
    const grown = new Uint8Array(size); grown.set(this.bytes.subarray(0, this.length)); this.bytes = grown;
  }
  write(value: number, bits: number) {
    // At most 24 bits at a time keep the buffer within 32 bits.
    this.buffer |= value << this.held; this.held += bits;
    if (this.held >= 16) {
      this.ensure(4);
      while (this.held >= 8) { this.bytes[this.length++] = this.buffer & 0xff; this.buffer >>>= 8; this.held -= 8; }
    }
  }
  finish(): Uint8Array {
    this.ensure(4);
    while (this.held > 0) { this.bytes[this.length++] = this.buffer & 0xff; this.buffer >>>= 8; this.held -= 8; }
    this.held = 0; this.buffer = 0;
    return this.bytes.subarray(0, this.length);
  }
}

const LENGTH_CODE = new Uint16Array(259); // match length 3-258 -> length code index 0-28
for (let code = 0; code < 29; code += 1) {
  const last = code === 28 ? 258 : LENGTH_BASE[code]! + (1 << LENGTH_EXTRA[code]!) - 1;
  for (let length = LENGTH_BASE[code]!; length <= last && length <= 258; length += 1) LENGTH_CODE[length] = code;
}
LENGTH_CODE[258] = 28;
const DIST_CODE_SMALL = new Uint8Array(256), DIST_CODE_LARGE = new Uint8Array(256); // distance 1-256; (distance - 1) >> 7
for (let code = 0; code < 30; code += 1) {
  const last = DIST_BASE[code]! + (1 << DIST_EXTRA[code]!) - 1;
  for (let distance = DIST_BASE[code]!; distance <= last; distance += 1) {
    if (distance <= 256) DIST_CODE_SMALL[distance - 1] = code; else DIST_CODE_LARGE[(distance - 1) >> 7] = code;
  }
}
const distanceCode = (distance: number): number => distance <= 256 ? DIST_CODE_SMALL[distance - 1]! : DIST_CODE_LARGE[(distance - 1) >> 7]!;

const WINDOW = 1 << 15, WINDOW_MASK = WINDOW - 1, HASH_BITS = 15, HASH_SIZE = 1 << HASH_BITS, HASH_MASK = HASH_SIZE - 1;
const MAX_MATCH = 258, MIN_MATCH = 3, MAX_CHAIN = 32, GOOD_MATCH = 8, MAX_LAZY = 16, NICE_MATCH = 128, BLOCK_SYMBOLS = 1 << 15;

function writeBlock(writer: BitWriter, symbols: Uint32Array, count: number, final: boolean) {
  // A symbol is a literal (< 256), or (length code + 257) | extra << 9 | distance << 14 for a match (see deflateRaw).
  const literalFreq = new Uint32Array(286), distanceFreq = new Uint32Array(30);
  for (let index = 0; index < count; index += 1) {
    const symbol = symbols[index]!;
    if (symbol < 256) { literalFreq[symbol]! += 1; continue; }
    literalFreq[symbol & 511]! += 1;
    distanceFreq[distanceCode(symbol >>> 14)]! += 1;
  }
  literalFreq[256] = 1;
  // Keep both codes complete (at least two used symbols) so every inflater accepts them.
  if (literalFreq.reduce((used, value) => used + (value ? 1 : 0), 0) < 2) literalFreq[literalFreq[0] ? 1 : 0] = 1;
  const usedDistances = distanceFreq.reduce((used, value) => used + (value ? 1 : 0), 0);
  if (usedDistances < 2) { if (!distanceFreq[0]) distanceFreq[0] = 1; if (!distanceFreq[1]) distanceFreq[1] = 1; }
  const literalLengths = codeLengths(literalFreq, 15), distanceLengths = codeLengths(distanceFreq, 15);
  let literalCount = 286; while (literalCount > 257 && !literalLengths[literalCount - 1]) literalCount -= 1;
  let distanceCount = 30; while (distanceCount > 1 && !distanceLengths[distanceCount - 1]) distanceCount -= 1;
  // Run-length encode the code lengths (symbols 16-18).
  const all = new Uint8Array(literalCount + distanceCount);
  all.set(literalLengths.subarray(0, literalCount)); all.set(distanceLengths.subarray(0, distanceCount), literalCount);
  const runs: number[] = [], lengthFreq = new Uint32Array(19);
  for (let index = 0; index < all.length;) {
    const value = all[index]!;
    let run = 1;
    while (index + run < all.length && all[index + run] === value) run += 1;
    let left = run;
    if (value === 0) {
      while (left >= 11) { const take = Math.min(138, left); runs.push(18, take - 11); lengthFreq[18]! += 1; left -= take; }
      if (left >= 3) { runs.push(17, left - 3); lengthFreq[17]! += 1; left = 0; }
    } else {
      runs.push(value, -1); lengthFreq[value]! += 1; left -= 1;
      while (left >= 3) { const take = Math.min(6, left); runs.push(16, take - 3); lengthFreq[16]! += 1; left -= take; }
    }
    while (left-- > 0) { runs.push(value, -1); lengthFreq[value]! += 1; }
    index += run;
  }
  if (lengthFreq.reduce((used, value) => used + (value ? 1 : 0), 0) < 2) { if (!lengthFreq[0]) lengthFreq[0] = 1; else lengthFreq[1] = 1; }
  const lengthLengths = codeLengths(lengthFreq, 7), lengthCodes = canonicalCodes(lengthLengths, 7);
  let lengthCount = 19; while (lengthCount > 4 && !lengthLengths[CODE_LENGTH_ORDER[lengthCount - 1]!]) lengthCount -= 1;
  writer.write(final ? 1 : 0, 1); writer.write(2, 2);
  writer.write(literalCount - 257, 5); writer.write(distanceCount - 1, 5); writer.write(lengthCount - 4, 4);
  for (let index = 0; index < lengthCount; index += 1) writer.write(lengthLengths[CODE_LENGTH_ORDER[index]!]!, 3);
  for (let index = 0; index < runs.length; index += 2) {
    const symbol = runs[index]!, extra = runs[index + 1]!;
    writer.write(lengthCodes[symbol]!, lengthLengths[symbol]!);
    if (symbol === 16) writer.write(extra, 2); else if (symbol === 17) writer.write(extra, 3); else if (symbol === 18) writer.write(extra, 7);
  }
  const literalCodes = canonicalCodes(literalLengths, 15), distanceCodes = canonicalCodes(distanceLengths, 15);
  for (let index = 0; index < count; index += 1) {
    const symbol = symbols[index]!;
    if (symbol < 256) { writer.write(literalCodes[symbol]!, literalLengths[symbol]!); continue; }
    const code = symbol & 511, lengthCode = code - 257;
    writer.write(literalCodes[code]!, literalLengths[code]!);
    if (LENGTH_EXTRA[lengthCode]) writer.write((symbol >>> 9) & 31, LENGTH_EXTRA[lengthCode]!);
    const distance = symbol >>> 14, dcode = distanceCode(distance);
    writer.write(distanceCodes[dcode]!, distanceLengths[dcode]!);
    if (DIST_EXTRA[dcode]) writer.write(distance - DIST_BASE[dcode]!, DIST_EXTRA[dcode]!);
  }
  writer.write(literalCodes[256]!, literalLengths[256]!);
}

/** Compress to a raw DEFLATE stream (LZ77 with hash chains and one-step lazy matching, dynamic Huffman blocks). */
export function deflateRaw(input: Uint8Array): Uint8Array {
  const writer = new BitWriter(), size = input.length;
  const head = new Int32Array(HASH_SIZE).fill(-1), previous = new Int32Array(WINDOW);
  const symbols = new Uint32Array(BLOCK_SYMBOLS);
  let count = 0, foundLength = 0, foundDistance = 0;
  const insert = (at: number) => {
    if (at + MIN_MATCH > size) return;
    const hash = ((input[at]! << 10) ^ (input[at + 1]! << 5) ^ input[at + 2]!) & HASH_MASK;
    previous[at & WINDOW_MASK] = head[hash]!; head[hash] = at;
  };
  // The longest earlier match at `at` (before `at` itself is inserted), into foundLength/foundDistance.
  const find = (at: number, chainLimit: number) => {
    let best = 0, distance = 0;
    if (at + MIN_MATCH <= size) {
      const limit = Math.min(MAX_MATCH, size - at);
      let candidate = head[((input[at]! << 10) ^ (input[at + 1]! << 5) ^ input[at + 2]!) & HASH_MASK]!, chain = chainLimit;
      while (candidate >= 0 && at - candidate <= WINDOW && chain-- > 0) {
        if (input[candidate + best] === input[at + best] && input[candidate] === input[at] && input[candidate + 1] === input[at + 1]) {
          let length = 2;
          while (length < limit && input[candidate + length] === input[at + length]) length += 1;
          if (length > best) { best = length; distance = at - candidate; if (length >= NICE_MATCH || length === limit) break; }
        }
        const next = previous[candidate & WINDOW_MASK]!;
        if (next >= candidate) break;
        candidate = next;
      }
    }
    foundLength = best >= MIN_MATCH ? best : 0; foundDistance = distance;
  };
  const push = (symbol: number) => {
    symbols[count++] = symbol;
    if (count === BLOCK_SYMBOLS) { writeBlock(writer, symbols, count, false); count = 0; }
  };
  const pushMatch = (length: number, distance: number) => {
    const code = LENGTH_CODE[length]!;
    push((code + 257) | ((length - LENGTH_BASE[code]!) << 9) | (distance << 14));
  };
  // Lazy matching as zlib does: a match found at the previous byte is used unless this byte starts a longer one.
  let previousLength = 0, previousDistance = 0, available = false, at = 0;
  while (at < size) {
    let length = 0, distance = 0;
    if (previousLength < MAX_LAZY) { find(at, previousLength >= GOOD_MATCH ? MAX_CHAIN >> 2 : MAX_CHAIN); length = foundLength; distance = foundDistance; }
    insert(at);
    if (previousLength >= MIN_MATCH && length <= previousLength) {
      pushMatch(previousLength, previousDistance);
      const end = at - 1 + previousLength;
      for (let position = at + 1; position < end; position += 1) insert(position);
      at = end; available = false; previousLength = 0;
      continue;
    }
    if (available) push(input[at - 1]!);
    previousLength = length; previousDistance = distance; available = true; at += 1;
  }
  if (available) push(input[at - 1]!);
  writeBlock(writer, symbols, count, true);
  return writer.finish();
}

// ---------------------------------------------------------------------------------------------------------------
// Base64 (RFC 4648, with padding)

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DECODE = new Int16Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index += 1) DECODE[ALPHABET.charCodeAt(index)] = index;

export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [], chunk = 0x3000; // a multiple of 3 bytes
  for (let start = 0; start < bytes.length; start += chunk) {
    const end = Math.min(bytes.length, start + chunk), codes: number[] = [];
    for (let index = start; index < end; index += 3) {
      const a = bytes[index]!, b = index + 1 < end ? bytes[index + 1]! : 0, c = index + 2 < end ? bytes[index + 2]! : 0;
      codes.push(ALPHABET.charCodeAt(a >> 2), ALPHABET.charCodeAt(((a & 3) << 4) | (b >> 4)),
        index + 1 < end ? ALPHABET.charCodeAt(((b & 15) << 2) | (c >> 6)) : 61, index + 2 < end ? ALPHABET.charCodeAt(c & 63) : 61);
    }
    parts.push(String.fromCharCode(...codes));
  }
  return parts.join('');
}

export function fromBase64(text: string): Uint8Array {
  if (text.length % 4) fail('has invalid base64 text');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(text.length / 4 * 3 - padding);
  let out = 0;
  for (let index = 0; index < text.length; index += 4) {
    const last = index + 4 === text.length;
    const values = [0, 1, 2, 3].map(offset => {
      const code = text.charCodeAt(index + offset);
      if (code === 61 && last && offset >= 4 - padding) return 0;
      const value = code < 128 ? DECODE[code]! : -1;
      if (value < 0) fail('has invalid base64 text');
      return value;
    });
    const triple = (values[0]! << 18) | (values[1]! << 12) | (values[2]! << 6) | values[3]!;
    bytes[out++] = triple >> 16;
    if (out < bytes.length) bytes[out++] = (triple >> 8) & 255;
    if (out < bytes.length) bytes[out++] = triple & 255;
  }
  return bytes;
}
