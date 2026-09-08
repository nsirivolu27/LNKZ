import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import type {
  HandoffPacket,
  InstanceIdentityDocument,
  InstanceIdentityRecord,
} from "./types.js";

export const IDENTITY_WELL_KNOWN_PATH = "/.well-known/lnkz.json";
const DEFAULT_INSTANCE_NAME = "LNKZ instance";

type UnsignedHandoffPacket = Omit<HandoffPacket, "signingInstanceId" | "signature">;

export function createInstanceIdentity(displayName = process.env.LNKZ_INSTANCE_NAME): InstanceIdentityRecord {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  return {
    instanceId: instanceIdForPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
    displayName: normalizeDisplayName(displayName),
  };
}

export async function ensureStoredInstanceIdentity(
  load: () => Promise<InstanceIdentityRecord | null>,
  save: (identity: InstanceIdentityRecord) => Promise<void>,
  displayName?: string,
): Promise<InstanceIdentityRecord> {
  const existing = await load();
  if (existing) return existing;

  // The persistence callback inserts with a singleton conflict guard. If two
  // processes start together, only one keypair wins and both reload that key.
  const generated = createInstanceIdentity(displayName);
  await save(generated);
  const persisted = await load();
  if (!persisted) throw new Error("The LNKZ instance identity could not be persisted.");
  return persisted;
}

export function toIdentityDocument(identity: InstanceIdentityRecord): InstanceIdentityDocument {
  return {
    version: 1,
    instanceId: identity.instanceId,
    algorithm: "Ed25519",
    publicKey: identity.publicKeyPem,
    displayName: identity.displayName,
  };
}

export function parseIdentityDocument(value: unknown): InstanceIdentityDocument | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.algorithm !== "Ed25519") return null;
  if (typeof record.instanceId !== "string" || typeof record.publicKey !== "string") return null;
  if (typeof record.displayName !== "string" || !record.displayName.trim()) return null;
  if (record.displayName.length > 120) return null;

  try {
    if (instanceIdForPublicKey(record.publicKey) !== record.instanceId) return null;
    createPublicKey(record.publicKey);
  } catch {
    return null;
  }

  return {
    version: 1,
    instanceId: record.instanceId,
    algorithm: "Ed25519",
    publicKey: record.publicKey,
    displayName: record.displayName.trim(),
  };
}

export function instanceIdForPublicKey(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex");
}

export function signHandoffPacket(
  packet: UnsignedHandoffPacket,
  identity: InstanceIdentityRecord,
): HandoffPacket {
  const payload = canonicalPacketPayload(packet);
  const signature = sign(
    null,
    Buffer.from(payload, "utf8"),
    createPrivateKey(identity.privateKeyPem),
  ).toString("base64url");
  return {
    ...packet,
    signingInstanceId: identity.instanceId,
    signature,
  };
}

export function verifyHandoffPacket(packet: HandoffPacket, publicKeyPem: string): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonicalPacketPayload(packet), "utf8"),
      createPublicKey(publicKeyPem),
      Buffer.from(packet.signature, "base64url"),
    );
  } catch {
    return false;
  }
}

export function canonicalPacketPayload(packet: UnsignedHandoffPacket | HandoffPacket): string {
  const { signingInstanceId: _signingInstanceId, signature: _signature, ...unsigned } =
    packet as HandoffPacket;
  return canonicalJson(unsigned);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}

function normalizeDisplayName(value?: string): string {
  const normalized = value?.trim() || DEFAULT_INSTANCE_NAME;
  if (normalized.length > 120) throw new Error("LNKZ_INSTANCE_NAME must be 120 characters or fewer.");
  return normalized;
}