"use client";

import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  isMeraError,
  type WebAuthnClient,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { bytesToHex, getAddress, type Address, type Hex, type LocalAccount } from "viem";
import { RP_ID } from "./chain";
import { CATALOG_EVENTS } from "./events";
import { fetchTicketsOf } from "./indexer";
import { readTicket, ticketsHeldOnChain } from "./reads";
import { creationOptions, ES256, pickDoorKey, recoverDoorKeys, type DoorKey } from "./webauthn";

/**
 * One passkey does two jobs. Mera derives the buyer's account from its PRF output, and its P-256 public key
 * (which Mera does not expose) is what the escrow checks at the door. Our WebAuthn client makes the same calls as
 * Mera's browser client, asks for ES256 only, keeps the public key at registration, and keeps each assertion so a
 * new browser can recover the key from signatures.
 */
export type StoredAccount = {
  address: Address;
  credentialId: string;
  transports?: string[];
  /** The door key. Missing only on a new browser until a ticket or a second signature reveals it. */
  qx?: Hex;
  qy?: Hex;
  /** The two keys one signature could have come from; the next passkey use picks the real one. */
  keyCandidates?: DoorKey[];
  name: string;
  createdAt: number;
};

const STORAGE_KEY = "curtain.account.v1";
const CHANGE_EVENT = "curtain:account";

function extractP256(resp: AuthenticatorAttestationResponse): DoorKey | { error: string } {
  const alg = typeof resp.getPublicKeyAlgorithm === "function" ? resp.getPublicKeyAlgorithm() : ES256;
  if (alg !== ES256) return { error: `This device made a passkey type Curtain cannot use at the door (${alg}).` };
  const spki = typeof resp.getPublicKey === "function" ? resp.getPublicKey() : null;
  if (spki) {
    const point = new Uint8Array(spki).slice(-65);
    if (point[0] === 0x04) return { qx: bytesToHex(point.slice(1, 33)), qy: bytesToHex(point.slice(33)) };
  }
  // Fallback: COSE EC2 key inside attestationObject (-2 is 0x21, -3 is 0x22, each a 32 byte bstr 58 20).
  const ao = new Uint8Array(resp.attestationObject);
  const find = (a: number) => ao.findIndex((v, i) => v === a && ao[i + 1] === 0x58 && ao[i + 2] === 0x20);
  const xi = find(0x21);
  const yi = find(0x22);
  if (xi < 0 || yi < 0) return { error: "Could not read this passkey's public key." };
  return { qx: bytesToHex(ao.slice(xi + 3, xi + 35)), qy: bytesToHex(ao.slice(yi + 3, yi + 35)) };
}

const toBytes = (buf: BufferSource | ArrayLike<number>): Uint8Array =>
  ArrayBuffer.isView(buf)
    ? new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    : new Uint8Array(buf as ArrayBuffer);

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: BufferSource } } };
type Assertion = { authenticatorData: Uint8Array; clientDataJSON: Uint8Array; signature: Uint8Array };

let lastDoorKey: DoorKey | { error: string } | null = null;
let lastAssertion: Assertion | null = null;

const curtainWebAuthnClient: WebAuthnClient = {
  async createCredential(req) {
    const cred = (await navigator.credentials.create({ publicKey: creationOptions(req) })) as PublicKeyCredential | null;
    if (!cred) throw new Error("No passkey was created");
    const resp = cred.response as AuthenticatorAttestationResponse;
    lastDoorKey = extractP256(resp);
    const prf = (cred.getClientExtensionResults() as PrfResults).prf;
    const first = prf?.results?.first;
    const transports = typeof resp.getTransports === "function" ? resp.getTransports() : undefined;
    return {
      credentialId: new Uint8Array(cred.rawId),
      ...(transports ? { transports } : {}),
      prfEnabled: prf?.enabled === true,
      ...(first ? { prfOutput: toBytes(first) } : {}),
    };
  },
  async getCredential(req) {
    const allow = req.allowCredential;
    const cred = (await navigator.credentials.get({
      publicKey: {
        rpId: req.rpId,
        challenge: req.challenge,
        ...(req.timeout !== undefined ? { timeout: req.timeout } : {}),
        userVerification: req.userVerification,
        extensions: { prf: { eval: { first: req.prfSalt } } } as AuthenticationExtensionsClientInputs,
        // No allowCredentials means "any Curtain passkey on this device": sign-in on a new browser.
        ...(allow
          ? {
              allowCredentials: [
                {
                  type: "public-key" as const,
                  id: allow.credentialId,
                  ...(allow.transports ? { transports: allow.transports as AuthenticatorTransport[] } : {}),
                },
              ],
            }
          : {}),
      },
    })) as PublicKeyCredential | null;
    if (!cred) throw new Error("No passkey was used");
    const resp = cred.response as AuthenticatorAssertionResponse;
    lastAssertion = {
      authenticatorData: new Uint8Array(resp.authenticatorData),
      clientDataJSON: new Uint8Array(resp.clientDataJSON),
      signature: new Uint8Array(resp.signature),
    };
    const first = (cred.getClientExtensionResults() as PrfResults).prf?.results?.first;
    return { credentialId: new Uint8Array(cred.rawId), ...(first ? { prfOutput: toBytes(first) } : {}) };
  },
};

function deriveSession(prfOutput: Uint8Array) {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  if (!node.privateKey) throw new Error("Could not derive your account");
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  return { session, account: toViemAccount(session) as LocalAccount };
}

// The unlocked account and its PRF output live only in memory, for this page visit.
let live: ReturnType<typeof deriveSession> | null = null;
let livePrf: Uint8Array | null = null;

/** The unlocked passkey's PRF output, used to derive per-ticket claim keys. Null until unlocked. */
export function unlockedPrf(address: Address): Uint8Array | null {
  return live && live.account.address === address ? livePrf : null;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export function readAccountRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function parseAccount(raw: string | null): StoredAccount | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAccount;
  } catch {
    return null;
  }
}

export function subscribeAccount(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function saveAccount(account: StoredAccount | null) {
  try {
    if (account) localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// ---------------------------------------------------------------------------
// The door key on a new browser
// ---------------------------------------------------------------------------

/** The key bound to any ticket this account holds: from the indexer, or read straight from each listed escrow. */
async function doorKeyFromTickets(holder: Address): Promise<DoorKey | undefined> {
  try {
    const rows = await fetchTicketsOf(holder);
    const row = rows[0];
    if (row) {
      const t = await readTicket(getAddress(row.show_id), BigInt(row.ticketId));
      return { qx: t.qx, qy: t.qy };
    }
    return undefined;
  } catch {
    const held = await ticketsHeldOnChain(holder, CATALOG_EVENTS).catch(() => []);
    const first = held[0];
    return first ? { qx: first.info.qx, qy: first.info.qy } : undefined;
  }
}

function candidatesFromLastAssertion(): DoorKey[] | undefined {
  if (!lastAssertion) return undefined;
  const keys = recoverDoorKeys(lastAssertion.authenticatorData, lastAssertion.clientDataJSON, lastAssertion.signature);
  return keys.length > 0 ? keys : undefined;
}

export const hasDoorKey = (a: StoredAccount): a is StoredAccount & DoorKey => Boolean(a.qx && a.qy);

// ---------------------------------------------------------------------------
// Sign up, sign in, unlock, sign out
// ---------------------------------------------------------------------------

/** Creates the passkey and account. One biometric prompt on devices that return PRF at creation. */
export async function signUp(name: string): Promise<StoredAccount> {
  lastDoorKey = null;
  const created = await createPasskeyWithPrfOutput({
    rp: { id: RP_ID, name: "Curtain" },
    user: { name: name || "Curtain account", displayName: name || "Curtain account" },
    webAuthnClient: curtainWebAuthnClient,
  });
  const doorKey = lastDoorKey as DoorKey | { error: string } | null;
  if (!doorKey || "error" in doorKey) throw new Error(doorKey?.error ?? "Could not read this passkey");
  live?.session.end();
  live = deriveSession(created.prfOutput);
  livePrf = new Uint8Array(created.prfOutput);
  const account: StoredAccount = {
    address: live.account.address,
    credentialId: created.credentialId,
    transports: created.transports ? [...created.transports] : undefined,
    qx: doorKey.qx,
    qy: doorKey.qy,
    name,
    createdAt: Date.now(),
  };
  saveAccount(account);
  return account;
}

/**
 * Signs in with any Curtain passkey this device can use (for example one synced through iCloud Keychain or Google
 * Password Manager). One biometric prompt. Restores the account and, from its tickets or the signature, the door key.
 */
export async function signIn(): Promise<StoredAccount> {
  lastAssertion = null;
  const got = await getPasskeyPrfOutput({ rpId: RP_ID, webAuthnClient: curtainWebAuthnClient });
  live?.session.end();
  live = deriveSession(got.prfOutput);
  livePrf = new Uint8Array(got.prfOutput);
  const address = live.account.address;
  const candidates = candidatesFromLastAssertion();
  const fromTickets = await doorKeyFromTickets(address);
  const account: StoredAccount = {
    address,
    credentialId: got.credentialId,
    ...(fromTickets ?? { keyCandidates: candidates }),
    name: "",
    createdAt: Date.now(),
  };
  saveAccount(account);
  return account;
}

/**
 * Returns the signing account and the stored account with its door key, asking for the biometric only when the
 * account is locked or the door key still needs a second signature.
 */
export async function unlock(stored: StoredAccount): Promise<{ signer: LocalAccount; account: StoredAccount & DoorKey }> {
  if (live && livePrf && live.account.address === stored.address && hasDoorKey(stored)) {
    return { signer: live.account, account: stored };
  }
  lastAssertion = null;
  const { prfOutput } = await getPasskeyPrfOutput({
    rpId: RP_ID,
    credential: {
      credentialId: stored.credentialId,
      ...(stored.transports ? { transports: stored.transports as never } : {}),
    },
    webAuthnClient: curtainWebAuthnClient,
  });
  const next = deriveSession(prfOutput);
  if (next.account.address !== stored.address) {
    next.session.end();
    throw new Error("That passkey belongs to a different account");
  }
  live?.session.end();
  live = next;
  livePrf = new Uint8Array(prfOutput);

  if (hasDoorKey(stored)) return { signer: live.account, account: stored };
  const picked = stored.keyCandidates && pickDoorKey(stored.keyCandidates, candidatesFromLastAssertion() ?? []);
  if (!picked) throw new Error("We couldn't confirm your door key. Please try again.");
  const updated: StoredAccount & DoorKey = { ...stored, ...picked, keyCandidates: undefined };
  saveAccount(updated);
  return { signer: live.account, account: updated };
}

export function signOut() {
  live?.session.end();
  live = null;
  livePrf = null;
  saveAccount(null);
}

/** True when the browser made or used a passkey but cannot give its PRF output (no Curtain account possible here). */
export function isPrfUnavailable(error: unknown): boolean {
  return isMeraError(error) && error.code === "PRF_UNAVAILABLE";
}

/** Words a buyer should see for passkey failures. */
export function friendlyPasskeyError(error: unknown): string {
  if (isMeraError(error)) {
    if (error.code === "PRF_UNAVAILABLE") {
      return "This browser can't hold a Curtain ticket. Use Chrome with Google Password Manager on Android, Safari on iPhone (iOS 18 or later), or continue on your phone.";
    }
    if (error.code === "PASSKEY_OPERATION_FAILED") return "Cancelled. Try again when you're ready.";
    if (error.code === "CRYPTO_UNAVAILABLE") return "Open Curtain over https to continue.";
  }
  return error instanceof Error ? error.message : "Something went wrong";
}
