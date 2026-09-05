import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";

/** Password parameters are deliberately fixed so hashes are portable and auditable. */
export const PASSWORD_SCRYPT = Object.freeze({
  N: 32_768,
  r: 8,
  p: 1,
  keyLength: 64,
  saltLength: 16,
});

/**
 * Hash a password using Node's asynchronous scrypt implementation.
 *
 * The serialized form is:
 * scrypt$N$r$p$salt-base64$hash-base64
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("Password must not be empty.");
  const salt = randomBytes(PASSWORD_SCRYPT.saltLength);
  const derived = await derive(password, salt);
  return [
    "scrypt",
    PASSWORD_SCRYPT.N,
    PASSWORD_SCRYPT.r,
    PASSWORD_SCRYPT.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verify a serialized password hash. Unsupported algorithms are rejected
 * explicitly rather than being treated as a failed login or silently ignored.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    throw new Error("Unsupported password hash format.");
  }

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (n !== PASSWORD_SCRYPT.N || r !== PASSWORD_SCRYPT.r || p !== PASSWORD_SCRYPT.p) {
    throw new Error("Unsupported password hash parameters.");
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    throw new Error("Invalid password hash encoding.");
  }
  if (salt.length !== PASSWORD_SCRYPT.saltLength || expected.length !== PASSWORD_SCRYPT.keyLength) {
    throw new Error("Invalid password hash encoding.");
  }

  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}

export function hashBearerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, PASSWORD_SCRYPT.keyLength, {
      N: PASSWORD_SCRYPT.N,
      r: PASSWORD_SCRYPT.r,
      p: PASSWORD_SCRYPT.p,
      // OpenSSL accounts for a small amount of bookkeeping beyond 128*N*r.
      maxmem: 128 * PASSWORD_SCRYPT.N * PASSWORD_SCRYPT.r + 16 * 1024 * 1024,
    }, (error, derived) => error ? reject(error) : resolve(derived as Buffer));
  });
}