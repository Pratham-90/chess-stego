// Password-based encryption: scrypt (password -> key) + AES-256-GCM.
//
// Same format as chess_stego/crypto.py, so the two versions can read each
// other's output:
//   salt (16 bytes) || nonce (12 bytes) || ciphertext + GCM tag (16 bytes)
//
// AES-GCM comes from the browser's built-in Web Crypto API. Browsers have no
// built-in scrypt, so that part comes from the audited @noble/hashes library.
import { scryptAsync } from "../vendor/scrypt.js";

const SALT_LEN = 16;
const NONCE_LEN = 12;
const TAG_LEN = 16;

export class DecryptionError extends Error {}

async function deriveKey(password, salt, onProgress) {
  // scrypt is deliberately slow and memory-hungry (N = 2^15 uses about 32 MB),
  // so someone guessing passwords can only try a few per second.
  const raw = await scryptAsync(new TextEncoder().encode(password), salt, {
    N: 2 ** 15, r: 8, p: 1, dkLen: 32, onProgress,
  });
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plaintext, password, onProgress) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN)); // never reused for a key
  const key = await deriveKey(password, salt, onProgress);
  // The result is the ciphertext with the 16-byte authentication tag appended.
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext);
  const blob = new Uint8Array(SALT_LEN + NONCE_LEN + sealed.byteLength);
  blob.set(salt, 0);
  blob.set(nonce, SALT_LEN);
  blob.set(new Uint8Array(sealed), SALT_LEN + NONCE_LEN);
  return blob;
}

export async function decrypt(blob, password, onProgress) {
  if (blob.length < SALT_LEN + NONCE_LEN + TAG_LEN) {
    throw new DecryptionError("These games are too short to hold an encrypted message.");
  }
  const salt = blob.slice(0, SALT_LEN);
  const nonce = blob.slice(SALT_LEN, SALT_LEN + NONCE_LEN);
  const key = await deriveKey(password, salt, onProgress);
  try {
    // GCM recomputes the tag. If one bit of the key or the data is wrong the
    // tags differ and this throws, instead of returning garbage.
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce }, key, blob.slice(SALT_LEN + NONCE_LEN));
    return new Uint8Array(plain);
  } catch {
    throw new DecryptionError("Wrong password, or the games were changed.");
  }
}
