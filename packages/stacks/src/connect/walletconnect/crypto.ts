/** WalletConnect v2 envelope encryption (Type 0 + Type 1) + relay JWT auth */

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { gcm } from "@noble/ciphers/aes.js";
import { base58, base64urlnopad } from "@scure/base";
import { bytesToHex, hexToBytes } from "../../utils/encoding.ts";

const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;
const TYPE_0 = 0x00;
const TYPE_1 = 0x01;

// -- Key generation --

export function generateKeyPair() {
  const privateKey = randomBytes(KEY_LENGTH);
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export function generateSymKey(): Uint8Array {
  return randomBytes(KEY_LENGTH);
}

/** Derive symmetric key from X25519 shared secret via HKDF */
export function deriveSymKey(
  selfPrivate: Uint8Array,
  peerPublic: Uint8Array,
): Uint8Array {
  const shared = x25519.getSharedSecret(selfPrivate, peerPublic);
  return hkdf(sha256, shared, undefined, undefined, KEY_LENGTH);
}

/** Topic = first 32 bytes of SHA-256(symKey) as hex */
export function symKeyToTopic(symKey: Uint8Array): string {
  return bytesToHex(sha256(symKey));
}

// -- Base64 helpers (browser-safe) --

export function encodeBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
  return btoa(binary);
}

export function decodeBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// -- Type 0 envelope (symmetric, pairing) --
// Layout: [0x00][12-byte IV][ciphertext + 16-byte tag]

export function encryptType0(
  symKey: Uint8Array,
  plaintext: string,
): Uint8Array {
  const iv = randomBytes(IV_LENGTH);
  const data = new TextEncoder().encode(plaintext);
  const cipher = gcm(symKey, iv);
  const sealed = cipher.encrypt(data);
  const envelope = new Uint8Array(1 + IV_LENGTH + sealed.length);
  envelope[0] = TYPE_0;
  envelope.set(iv, 1);
  envelope.set(sealed, 1 + IV_LENGTH);
  return envelope;
}

export function decryptType0(
  symKey: Uint8Array,
  envelope: Uint8Array,
): string {
  if (envelope[0] !== TYPE_0) throw new Error("Not a type-0 envelope");
  const iv = envelope.subarray(1, 1 + IV_LENGTH);
  const sealed = envelope.subarray(1 + IV_LENGTH);
  const cipher = gcm(symKey, iv);
  const plain = cipher.decrypt(sealed);
  return new TextDecoder().decode(plain);
}

// -- Type 1 envelope (asymmetric, session proposal) --
// Layout: [0x01][32-byte sender pubkey][12-byte IV][ciphertext + 16-byte tag]

export function encryptType1(
  senderPrivate: Uint8Array,
  receiverPublic: Uint8Array,
  plaintext: string,
): Uint8Array {
  const senderPublic = x25519.getPublicKey(senderPrivate);
  const symKey = deriveSymKey(senderPrivate, receiverPublic);
  const iv = randomBytes(IV_LENGTH);
  const data = new TextEncoder().encode(plaintext);
  const cipher = gcm(symKey, iv);
  const sealed = cipher.encrypt(data);
  const envelope = new Uint8Array(1 + KEY_LENGTH + IV_LENGTH + sealed.length);
  envelope[0] = TYPE_1;
  envelope.set(senderPublic, 1);
  envelope.set(iv, 1 + KEY_LENGTH);
  envelope.set(sealed, 1 + KEY_LENGTH + IV_LENGTH);
  return envelope;
}

export function decryptType1(
  receiverPrivate: Uint8Array,
  envelope: Uint8Array,
): string {
  if (envelope[0] !== TYPE_1) throw new Error("Not a type-1 envelope");
  const senderPublic = envelope.subarray(1, 1 + KEY_LENGTH);
  const iv = envelope.subarray(1 + KEY_LENGTH, 1 + KEY_LENGTH + IV_LENGTH);
  const sealed = envelope.subarray(1 + KEY_LENGTH + IV_LENGTH);
  const symKey = deriveSymKey(receiverPrivate, senderPublic);
  const cipher = gcm(symKey, iv);
  const plain = cipher.decrypt(sealed);
  return new TextDecoder().decode(plain);
}

// -- Unified decrypt --

export function decrypt(
  keyOrPrivate: Uint8Array,
  envelope: Uint8Array,
): string {
  return envelope[0] === TYPE_1
    ? decryptType1(keyOrPrivate, envelope)
    : decryptType0(keyOrPrivate, envelope);
}

// -- Relay JWT auth (Ed25519 + did:key) --

/** Ed25519 multicodec varint prefix */
const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

function encodeDidKey(publicKey: Uint8Array): string {
  const prefixed = new Uint8Array(ED25519_MULTICODEC.length + publicKey.length);
  prefixed.set(ED25519_MULTICODEC);
  prefixed.set(publicKey, ED25519_MULTICODEC.length);
  return `did:key:z${base58.encode(prefixed)}`;
}

function base64urlEncode(data: Uint8Array | string): string {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  return base64urlnopad.encode(bytes);
}

/** Generate a signed JWT for WC relay authentication */
export function createRelayAuthJwt(
  relayUrl: string,
): { jwt: string; clientId: string } {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  const clientId = encodeDidKey(publicKey);

  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const payload = base64urlEncode(
    JSON.stringify({
      iss: clientId,
      sub: bytesToHex(randomBytes(32)),
      aud: relayUrl,
      iat: now,
      exp: now + 86400, // 24 hours
      act: "client_auth",
    }),
  );

  const message = new TextEncoder().encode(`${header}.${payload}`);
  const signature = base64urlEncode(ed25519.sign(message, privateKey));

  return { jwt: `${header}.${payload}.${signature}`, clientId };
}

export { bytesToHex, hexToBytes };
