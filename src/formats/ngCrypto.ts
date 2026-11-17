// Rockstar's NG encryption of RPF tables of contents – what OpenIV and CodeWalker use to open and save the sound
// archives. Lets SP Tool build a soundpack exactly like a creator does by hand: replaced files are appended to the
// archive and the table of contents is encrypted again with NG.
//
// Key material: GTA5.exe of the player no longer holds the NG keys in plain form. CodeWalker (MIT licence) ships them
// as `magic.dat`, encrypted with the AES key that IS in GTA5.exe. SP Tool downloads that file on the player's PC
// (pinned to one CodeWalker commit and checked by SHA-256), unlocks it with the AES key from the player's own
// GTA5.exe and keeps the result on this PC only. No Rockstar key is part of SP Tool.
//
// Decryption follows CodeWalker's GTACrypto. Encryption inverts every round directly (meet in the middle on each
// 32-bit word) instead of building CodeWalker's large look-up tables – plenty fast for a table of contents.

// ── The keys in use (loaded by services/ngKeys.ts; null until then) ─────────────────────────────────────────────
let active: NgKeys | null = null;
export const activeNgKeys = () => active;
export function setNgKeys(k: NgKeys | null) { active = k; }

// ── SHA-1 for short inputs (≤ 55 bytes, one block) ───────────────────────────────────────────────────────────────
const W = new Uint32Array(80);
export function sha1Short(m: Uint8Array): string {
  if (m.length > 55) throw new Error('sha1Short: input too long');
  const blk = new Uint8Array(64);
  blk.set(m); blk[m.length] = 0x80;
  const bits = m.length * 8;
  blk[62] = (bits >>> 8) & 0xff; blk[63] = bits & 0xff;
  for (let i = 0; i < 16; i++) W[i] = (blk[i * 4] << 24) | (blk[i * 4 + 1] << 16) | (blk[i * 4 + 2] << 8) | blk[i * 4 + 3];
  for (let i = 16; i < 80; i++) { const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]; W[i] = (x << 1) | (x >>> 31); }
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476, e = 0xc3d2e1f0;
  for (let i = 0; i < 80; i++) {
    const f = i < 20 ? ((b & c) | (~b & d)) + 0x5a827999 : i < 40 ? (b ^ c ^ d) + 0x6ed9eba1 : i < 60 ? ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc : (b ^ c ^ d) + 0xca62c1d6;
    const t = (((a << 5) | (a >>> 27)) + f + e + W[i]) | 0;
    e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
  }
  return [a + 0x67452301, b + 0xefcdab89, c + 0x98badcfe, d + 0x10325476, e + 0xc3d2e1f0].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/** SHA-1 of the 32-byte AES key in GTA5.exe (GTA V Legacy) – the same hash CodeWalker searches for. */
const AES_KEY_SHA1 = 'a0796128a775720ac204d9819f68c172e3952c6d';
/** SHA-1 of the 16-byte AWC key – used to check that magic.dat was unlocked correctly. */
const AWC_KEY_SHA1 = 'c31e0da1c7e5d85502e517290ed07b180a94e911';

/** Finds the 32-byte AES key in a GTA5.exe (8-byte aligned, by SHA-1); null when it is not in there. */
export function findAesKey(exe: Uint8Array): Uint8Array | null {
  for (let p = 0; p + 32 <= exe.length; p += 8) {
    const w = exe.subarray(p, p + 32);
    if (sha1Short(w) === AES_KEY_SHA1) return new Uint8Array(w);
  }
  return null;
}
export const isAesKey = (k: Uint8Array) => k.length === 32 && sha1Short(k) === AES_KEY_SHA1;

// ── CodeWalker's magic.dat ───────────────────────────────────────────────────────────────────────────────────────
/** CodeWalker commit the file is taken from – pinned, so the bytes never change under SP Tool. */
export const MAGIC_URL = 'https://raw.githubusercontent.com/dexyfex/CodeWalker/485d56bec00262ed7fa472261cce7bbc6202b96e/CodeWalker.Core/Resources/magic.dat';
export const MAGIC_SHA256 = 'dc35981f822e892ced3aa81d31e7a96927d573ee28f67417592b5afeaf330832';
const MAGIC_LAYOUT = { keys: 101 * 272, tables: 17 * 16 * 256 * 4, lut: 256, awc: 16 } as const;
export const NG_PAYLOAD_SIZE = MAGIC_LAYOUT.keys + MAGIC_LAYOUT.tables + MAGIC_LAYOUT.lut + MAGIC_LAYOUT.awc;

export interface NgKeys {
  /** 101 keys, 17 rounds × 4 words each */
  keys: Uint32Array[];
  /** decrypt tables [round][byte position][value] */
  tables: Uint32Array[][];
  /** lookup for the file-name hash that picks the key */
  lut: Uint8Array;
}

/** System.Random(seed).NextBytes of .NET (Knuth's subtractive generator, the seeded "compat" variant). */
export function dotnetRandomBytes(seed: number, count: number): Uint8Array[] {
  const MBIG = 0x7fffffff, MSEED = 161803398;
  const s = new Int32Array(56);
  const sub = seed === -2147483648 ? MBIG : Math.abs(seed);
  let mj = MSEED - sub;
  s[55] = mj;
  let mk = 1, ii = 0;
  for (let i = 1; i < 55; i++) {
    if ((ii += 21) >= 55) ii -= 55;
    s[ii] = mk;
    mk = mj - mk;
    if (mk < 0) mk += MBIG;
    mj = s[ii];
  }
  for (let k = 1; k < 5; k++) {
    for (let i = 1; i < 56; i++) {
      let n = i + 30;
      if (n >= 55) n -= 55;
      s[i] -= s[1 + n];
      if (s[i] < 0) s[i] += MBIG;
    }
  }
  let inext = 0, inextp = 21;
  const sample = () => {
    if (++inext >= 56) inext = 1;
    if (++inextp >= 56) inextp = 1;
    let r = s[inext] - s[inextp];
    if (r === MBIG) r--;
    if (r < 0) r += MBIG;
    s[inext] = r;
    return r;
  };
  return Array.from({ length: 4 }, () => { const b = new Uint8Array(count); for (let i = 0; i < count; i++) b[i] = sample() & 0xff; return b; });
}

/** Jenkins one-at-a-time hash of bytes (CodeWalker JenkHash.GenHash(byte[])). */
export function jenkBytes(data: Uint8Array): number {
  let h = 0;
  for (let i = 0; i < data.length; i++) { h = (h + data[i]) >>> 0; h = (h + (h << 10)) >>> 0; h = (h ^ (h >>> 6)) >>> 0; }
  h = (h + (h << 3)) >>> 0; h = (h ^ (h >>> 11)) >>> 0; h = (h + (h << 15)) >>> 0;
  return h;
}

/** Unlocks magic.dat with the AES key from GTA5.exe → the raw key payload (keys | tables | lut | awc key). */
export async function unlockMagic(magic: Uint8Array, aesKey: Uint8Array): Promise<Uint8Array> {
  if (!isAesKey(aesKey)) throw new Error('Das ist nicht der AES-Schlüssel aus der GTA5.exe.');
  const [r1, r2, r3, r4] = dotnetRandomBytes(jenkBytes(aesKey) | 0, magic.length);
  const db = new Uint8Array(magic.length);
  for (let i = 0; i < magic.length; i++) db[i] = (magic[i] - r1[i] - r2[i] - r3[i] - r4[i]) & 0xff;
  const plain = aes256EcbDecrypt(db, aesKey);
  const payload = await inflateRaw(plain);
  if (payload.length < NG_PAYLOAD_SIZE) throw new Error('magic.dat ließ sich nicht entschlüsseln (falsche GTA-Version?).');
  const out = payload.slice(0, NG_PAYLOAD_SIZE);
  if (sha1Short(out.subarray(NG_PAYLOAD_SIZE - 16)) !== AWC_KEY_SHA1) throw new Error('magic.dat passt nicht zu dieser GTA5.exe.');
  return out;
}

export function parseNgPayload(p: Uint8Array): NgKeys {
  if (p.length !== NG_PAYLOAD_SIZE) throw new Error('Ungültige NG-Schlüsseldaten.');
  const buf = p.slice().buffer;
  const keys = Array.from({ length: 101 }, (_, i) => new Uint32Array(buf, i * 272, 68));
  const t0 = MAGIC_LAYOUT.keys;
  const tables = Array.from({ length: 17 }, (_, r) => Array.from({ length: 16 }, (_, j) => new Uint32Array(buf, t0 + (r * 16 + j) * 1024, 256)));
  const lut = new Uint8Array(buf, t0 + MAGIC_LAYOUT.tables, 256);
  return { keys, tables, lut };
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  void w.write(data as unknown as BufferSource).then(() => w.close()).catch(() => { /* reported by the reader */ });
  const chunks: Uint8Array[] = [];
  const r = ds.readable.getReader();
  let total = 0;
  for (;;) {
    let res: ReadableStreamReadResult<Uint8Array>;
    try { res = await r.read(); } catch { break; } // .NET padding after the deflate stream – the data is complete
    if (res.done) break;
    chunks.push(res.value); total += res.value.length;
  }
  const out = new Uint8Array(total);
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ── AES-256 ECB decrypt (only what magic.dat needs; trailing partial block stays as is, like CodeWalker) ───────────
const SBOX = new Uint8Array(256), INV = new Uint8Array(256);
(() => {
  let p = 1, q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >>> 7)) ^ ((q << 2) | (q >>> 6)) ^ ((q << 3) | (q >>> 5)) ^ ((q << 4) | (q >>> 4));
    SBOX[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i++) INV[SBOX[i]] = i;
})();
const xt = (b: number) => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;
const mul = (a: number, b: number) => { let r = 0; while (b) { if (b & 1) r ^= a; a = xt(a); b >>= 1; } return r; };

function expandKey256(key: Uint8Array): Uint8Array {
  const w = new Uint8Array(240);
  w.set(key);
  let rcon = 1;
  for (let i = 32; i < 240; i += 4) {
    let t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
    if (i % 32 === 0) {
      const tmp = t0; t0 = SBOX[t1] ^ rcon; t1 = SBOX[t2]; t2 = SBOX[t3]; t3 = SBOX[tmp];
      rcon = xt(rcon);
    } else if (i % 32 === 16) { t0 = SBOX[t0]; t1 = SBOX[t1]; t2 = SBOX[t2]; t3 = SBOX[t3]; }
    w[i] = w[i - 32] ^ t0; w[i + 1] = w[i - 31] ^ t1; w[i + 2] = w[i - 30] ^ t2; w[i + 3] = w[i - 29] ^ t3;
  }
  return w;
}

export function aes256EcbDecrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error('AES-256 braucht 32 Byte Schlüssel.');
  const rk = expandKey256(key);
  const out = new Uint8Array(data);
  const s = new Uint8Array(16), t = new Uint8Array(16);
  const m9 = new Uint8Array(256), m11 = new Uint8Array(256), m13 = new Uint8Array(256), m14 = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { m9[i] = mul(i, 9); m11[i] = mul(i, 11); m13[i] = mul(i, 13); m14[i] = mul(i, 14); }
  const len = data.length - (data.length % 16);
  for (let o = 0; o < len; o += 16) {
    for (let i = 0; i < 16; i++) s[i] = out[o + i] ^ rk[224 + i];
    for (let round = 13; round >= 0; round--) {
      // InvShiftRows + InvSubBytes
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) t[c * 4 + r] = INV[s[((c - r + 4) % 4) * 4 + r]];
      for (let i = 0; i < 16; i++) t[i] ^= rk[round * 16 + i];
      if (round > 0) {
        for (let c = 0; c < 4; c++) {
          const a0 = t[c * 4], a1 = t[c * 4 + 1], a2 = t[c * 4 + 2], a3 = t[c * 4 + 3];
          s[c * 4] = m14[a0] ^ m11[a1] ^ m13[a2] ^ m9[a3];
          s[c * 4 + 1] = m9[a0] ^ m14[a1] ^ m11[a2] ^ m13[a3];
          s[c * 4 + 2] = m13[a0] ^ m9[a1] ^ m14[a2] ^ m11[a3];
          s[c * 4 + 3] = m11[a0] ^ m13[a1] ^ m9[a2] ^ m14[a3];
        }
      } else s.set(t);
    }
    out.set(s, o);
  }
  return out;
}

// ── NG cipher ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Rockstar's file-name hash that picks one of the 101 keys (CodeWalker GTA5Hash.CalculateHash). */
export function ngNameHash(name: string, lut: Uint8Array): number {
  let result = 0;
  for (let i = 0; i < name.length; i++) {
    const temp = Math.imul(1025, (lut[name.charCodeAt(i) & 0xff] + result) >>> 0) >>> 0;
    result = ((temp >>> 6) ^ temp) >>> 0;
  }
  const r9 = Math.imul(9, result) >>> 0;
  return Math.imul(32769, ((r9 >>> 11) ^ r9) >>> 0) >>> 0;
}

/** The key for an archive: depends on its file name and its total size in bytes. */
export function ngKeyFor(k: NgKeys, name: string, archiveSize: number): Uint32Array {
  const idx = Number((BigInt(ngNameHash(name, k.lut)) + BigInt(archiveSize >>> 0) + 61n) % 0x1_0000_0000n % 101n);
  return k.keys[idx];
}

// byte positions feeding output word w: round type A uses bytes 4w..4w+3, round type B mixes the columns
const POS_A = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]];
const POS_B = [[0, 7, 10, 13], [1, 4, 11, 14], [2, 5, 8, 15], [3, 6, 9, 12]];
const posFor = (round: number) => (round <= 1 || round === 16 ? POS_A : POS_B);

function decryptBlock(k: NgKeys, key: Uint32Array, block: Uint8Array): void {
  const tmp = new Uint8Array(16);
  for (let round = 0; round < 17; round++) {
    const T = k.tables[round], pos = posFor(round);
    for (let w = 0; w < 4; w++) {
      const [p0, p1, p2, p3] = pos[w];
      const x = (T[p0][block[p0]] ^ T[p1][block[p1]] ^ T[p2][block[p2]] ^ T[p3][block[p3]] ^ key[round * 4 + w]) >>> 0;
      tmp[w * 4] = x & 0xff; tmp[w * 4 + 1] = (x >>> 8) & 0xff; tmp[w * 4 + 2] = (x >>> 16) & 0xff; tmp[w * 4 + 3] = x >>> 24;
    }
    block.set(tmp);
  }
}

/** Decrypts whole 16-byte blocks; a trailing partial block stays as it is (like the game). */
export function ngDecrypt(k: NgKeys, key: Uint32Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data);
  for (let o = 0; o + 16 <= out.length; o += 16) decryptBlock(k, key, out.subarray(o, o + 16));
  return out;
}

/**
 * Inverse of one round's word function f(a,b,c,d) = T0[a]^T1[b]^T2[c]^T3[d]: index of T0[a]^T1[b] by its low 16 bits,
 * then for every (c,d) look up the matching (a,b). Built once per round and word, used for all blocks.
 */
class WordInverse {
  private start = new Uint32Array(65537);
  private vals = new Uint32Array(65536);
  private pairs = new Uint16Array(65536);
  constructor(t0: Uint32Array, t1: Uint32Array, private t2: Uint32Array, private t3: Uint32Array) {
    const count = new Uint32Array(65536);
    for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) count[(t0[a] ^ t1[b]) & 0xffff]++;
    for (let i = 0; i < 65536; i++) this.start[i + 1] = this.start[i] + count[i];
    const fill = this.start.slice(0, 65536);
    for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) {
      const v = (t0[a] ^ t1[b]) >>> 0, at = fill[v & 0xffff]++;
      this.vals[at] = v; this.pairs[at] = (a << 8) | b;
    }
  }
  solve(target: number): [number, number, number, number] {
    for (let c = 0; c < 256; c++) {
      const tc = this.t2[c] ^ target;
      for (let d = 0; d < 256; d++) {
        const need = (tc ^ this.t3[d]) >>> 0, h = need & 0xffff;
        for (let i = this.start[h]; i < this.start[h + 1]; i++) {
          if (this.vals[i] === need) { const ab = this.pairs[i]; return [ab >>> 8, ab & 0xff, c, d]; }
        }
      }
    }
    throw new Error('NG: Runde nicht umkehrbar (falsche Schlüsseldaten).');
  }
}

/** Encrypts whole 16-byte blocks so that ngDecrypt gives `data` back; a trailing partial block stays plain. */
export function ngEncrypt(k: NgKeys, key: Uint32Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data);
  const blocks: Uint8Array[] = [];
  for (let o = 0; o + 16 <= out.length; o += 16) blocks.push(out.subarray(o, o + 16));
  if (!blocks.length) return out;
  const tmp = new Uint8Array(16);
  for (let round = 16; round >= 0; round--) {
    const T = k.tables[round], pos = posFor(round);
    const inv = pos.map(([p0, p1, p2, p3]) => new WordInverse(T[p0], T[p1], T[p2], T[p3]));
    for (const blk of blocks) {
      for (let w = 0; w < 4; w++) {
        const y = (blk[w * 4] | (blk[w * 4 + 1] << 8) | (blk[w * 4 + 2] << 16) | (blk[w * 4 + 3] << 24)) >>> 0;
        const [a, b, c, d] = inv[w].solve((y ^ key[round * 4 + w]) >>> 0);
        const [p0, p1, p2, p3] = pos[w];
        tmp[p0] = a; tmp[p1] = b; tmp[p2] = c; tmp[p3] = d;
      }
      blk.set(tmp);
    }
  }
  return out;
}
