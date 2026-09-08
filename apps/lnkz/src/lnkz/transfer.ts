import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { importConversations } from "./import/index.js";
import type { ConversationInput } from "./types.js";

/**
 * Pulling a conversation off another LNKZ instance.
 *
 * A handoff link already returns a complete `lnkz.conversation.v1` packet, and
 * the LNKZ importer already reads that shape. The only thing missing was the
 * fetch, which is why this file is small: transfer between two instances is not
 * a new protocol, it is one HTTP GET wrapped in the checks that make fetching a
 * user-supplied URL safe.
 *
 * Pull rather than push, deliberately. A pushing design needs the receiver to
 * expose an inbound endpoint, accept unsolicited writes from strangers, and be
 * addressable from the outside. Pulling needs none of that: the recipient
 * reaches out, the capability lives in the token, and it works from behind any
 * firewall.
 */

const MAX_PACKET_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export interface TransferResult {
  conversation: ConversationInput;
  origin: { instance: string; url: string; handoffId?: string; conversationId?: string };
  warnings: string[];
}

export class TransferError extends Error {}

/**
 * Fetch a share link and turn it into something the store can save.
 *
 * The conversation keeps its original id in `lineage.originConversationId`
 * rather than as its own id. Two instances that both transferred the same
 * conversation would otherwise collide, and the local id is the recipient's to
 * assign.
 */
export async function fetchTransfer(rawUrl: string, environment: NodeJS.ProcessEnv = process.env): Promise<TransferResult> {
  const url = await safeUrl(rawUrl, environment);

  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new TransferError(
      response.status === 404
        ? "The link is invalid, revoked, exhausted, or expired."
        : `The origin returned HTTP ${response.status}.`,
    );
  }

  const body = await readCapped(response);
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new TransferError("The link did not return a LNKZ packet. Ask for the JSON link, not the Markdown one.");
  }

  const packet = payload as { format?: string; conversation?: { id?: string }; handoff?: { id?: string } };
  if (packet.format !== "lnkz.conversation.v1") {
    throw new TransferError(`Expected a lnkz.conversation.v1 packet, got ${packet.format ?? "an unrecognized shape"}.`);
  }

  const result = importConversations(body, "lnkz");
  const [conversation] = result.conversations;
  if (!conversation) throw new TransferError("The packet contained no conversation.");

  const origin = {
    instance: url.origin,
    url: url.toString(),
    handoffId: packet.handoff?.id,
    conversationId: packet.conversation?.id,
  };

  return {
    conversation: {
      ...conversation,
      id: undefined,
      lineage: {
        ...conversation.lineage,
        originInstance: origin.instance,
        originConversationId: origin.conversationId,
        handoffId: origin.handoffId,
        importedAt: new Date().toISOString(),
      },
    },
    origin,
    warnings: result.warnings,
  };
}

/**
 * The URL is supplied by whoever called the tool, and the server is the one
 * that dials it. That makes this a server-side request forgery surface: without
 * a check, "import this link" becomes "read anything my host can reach",
 * including cloud metadata endpoints and services on the private network.
 *
 * So: http and https only, no credentials in the URL, and every address the
 * hostname resolves to must be public. Loopback and private ranges are refused
 * unless LNKZ_TRANSFER_ALLOW_PRIVATE is set, which is what you turn on to try
 * two instances on one laptop and leave off everywhere else.
 */
export async function safeUrl(rawUrl: string, environment: NodeJS.ProcessEnv = process.env): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TransferError("That is not a URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TransferError("Only http and https links can be transferred.");
  }
  if (url.username || url.password) {
    throw new TransferError("Credentials in the URL are not accepted.");
  }

  const allowPrivate = environment.LNKZ_TRANSFER_ALLOW_PRIVATE === "true";
  for (const address of await resolveAll(url.hostname)) {
    if (isPublicAddress(address)) continue;
    if (allowPrivate) continue;
    throw new TransferError(
      `${url.hostname} resolves to a private address. Set LNKZ_TRANSFER_ALLOW_PRIVATE=true to allow this on a development machine.`,
    );
  }

  return url;
}

async function resolveAll(hostname: string): Promise<string[]> {
  const literal = hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal)) return [literal];
  try {
    const records = await lookup(hostname, { all: true });
    if (!records.length) throw new Error("no records");
    return records.map((record) => record.address);
  } catch {
    throw new TransferError(`${hostname} could not be resolved.`);
  }
}

/** Conservative on purpose: anything not clearly public is treated as private. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address.toLowerCase());
  return false;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;              // link-local, and the cloud metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;                // protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return false;    // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return false;  // benchmarking
  if (a >= 224) return false;                            // multicast and reserved
  return true;
}

function isPublicIpv6(address: string): boolean {
  if (address === "::" || address === "::1") return false;
  if (address.startsWith("fe8") || address.startsWith("fe9") || address.startsWith("fea") || address.startsWith("feb")) return false;
  if (address.startsWith("fc") || address.startsWith("fd")) return false;
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1] as string);
  return true;
}

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

async function fetchWithTimeout(url: URL): Promise<FetchResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      headers: { accept: "application/json" },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new TransferError("The origin did not respond in time.");
    }
    // Redirects are refused rather than followed, because a redirect is how a
    // public hostname becomes a request to a private one after the check ran.
    throw new TransferError("Could not reach the origin, or it redirected the request.");
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response: FetchResponse): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_PACKET_BYTES) throw new TransferError("That packet is too large to import.");

  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_PACKET_BYTES) {
    throw new TransferError("That packet is too large to import.");
  }
  return body;
}
