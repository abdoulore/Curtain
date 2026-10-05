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
import { bytesToHex, type Address, type Hex, type LocalAccount } from "viem";
import { RP_ID } from "./chain";

/**
 * One passkey does two jobs. Mera derives the buyer's account from its PRF output, and its P-256 public key
 * (which Mera does not expose) is what the escrow checks at the door. This client makes the same WebAuthn
 * calls as Mera's browser client and also keeps that public key from the registration response.
 */
export type StoredAccount = {
  address: Address;
  credentialId: string;
  transports?: string[];
  qx: Hex;
  qy: Hex;
  name: string;
  createdAt: number;
};

const STORAGE_KEY = "curtain.account.v1";
const CHANGE_EVENT = "curtain:account";

type DoorKey = { qx: Hex; qy: Hex } | { error: string };

function extractP256(resp: AuthenticatorAttestationResponse): DoorKey {
  const alg = typeof resp.getPublicKeyAlgorithm === "function" ? resp.getPublicKeyAlgorithm() : -7;
  if (alg !== -7) return { error: `This device made a passkey type Curtain cannot use at the door (${alg}).` };
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

let lastDoorKey: DoorKey | null = null;

const curtainWebAuthnClient: WebAuthnClient = {
  async createCredential(req) {
    const cred = (await navigator.credentials.create({
      publicKey: {
        rp: req.rp,
        user: req.user,
        challenge: req.challenge,
        pubKeyCredParams: req.algorithms.map((alg) => ({ type: "public-key" as const, alg })),
        ...(req.timeout !== undefined ? { timeout: req.timeout } : {}),
        attestation: req.attestation,
        authenticatorSelection: {
          residentKey: req.residentKey,
          requireResidentKey: true,
          userVerification: req.userVerification,
        },
        extensions: { prf: { eval: { first: req.prfSalt } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
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

// The unlocked account lives only in memory, for this page visit.
let live: ReturnType<typeof deriveSession> | null = null;

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
// Sign up, unlock, sign out
// ---------------------------------------------------------------------------

/** Creates the passkey and account. One biometric prompt on devices that return PRF at creation. */
export async function signUp(name: string): Promise<StoredAccount> {
  lastDoorKey = null;
  const created = await createPasskeyWithPrfOutput({
    rp: { id: RP_ID, name: "Curtain" },
    user: { name: name || "Curtain account", displayName: name || "Curtain account" },
    webAuthnClient: curtainWebAuthnClient,
  });
  const doorKey = lastDoorKey as DoorKey | null;
  if (!doorKey || "error" in doorKey) throw new Error(doorKey?.error ?? "Could not read this passkey");
  live?.session.end();
  live = deriveSession(created.prfOutput);
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

/** Returns the signing account, asking for the biometric only if it is not already unlocked. */
export async function unlock(stored: StoredAccount): Promise<LocalAccount> {
  if (live && live.account.address === stored.address) return live.account;
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
  live = next;
  return live.account;
}

export function signOut() {
  live?.session.end();
  live = null;
  saveAccount(null);
}

/** Words a buyer should see for passkey failures. */
export function friendlyPasskeyError(error: unknown): string {
  if (isMeraError(error)) {
    if (error.code === "PRF_UNAVAILABLE") {
      return "This device can't hold a Curtain ticket yet. Use Chrome with Google Password Manager on Android, or Safari on iPhone (iOS 18 or later).";
    }
    if (error.code === "PASSKEY_OPERATION_FAILED") return "Cancelled. Try again when you're ready.";
    if (error.code === "CRYPTO_UNAVAILABLE") return "Open Curtain over https to continue.";
  }
  return error instanceof Error ? error.message : "Something went wrong";
}
