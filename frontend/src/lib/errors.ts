import { isMeraError } from "@category-labs/mera";
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { ApiError, friendlyMessage } from "./api";

/** An error whose message was written for people and can be shown as it is. */
export class PlainError extends Error {}

export const MESSAGES = {
  cancelled: "Cancelled. Try again when you're ready.",
  unsupported:
    "This browser can't use a fingerprint or Face ID passkey. Open Curtain in Chrome on Android or Safari on iPhone.",
  noPrf:
    "Curtain tickets live in Chrome with Google Password Manager on Android and in Safari on iPhone. Continue on your phone.",
  exists: "This phone already has a Curtain passkey. Sign in with it instead.",
  insecure: "Open Curtain over https to continue.",
  offline: "You're offline. Check your connection and try again.",
  slow: "The network is slow right now. Try again in a moment.",
  unknown: "Something went wrong. Please try again.",
} as const;

/** The WebAuthn failure inside an error, if there is one: thrown directly, or wrapped by Mera. */
function webAuthnName(error: unknown): string | undefined {
  for (let e = error, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    if (typeof DOMException !== "undefined" && e instanceof DOMException) return e.name;
    const name = (e as { name?: unknown }).name;
    if (typeof name === "string" && /^(NotAllowed|NotSupported|InvalidState|Security|Abort)Error$/.test(name)) return name;
  }
  return undefined;
}

/**
 * One plain sentence for anything a passkey, the relayer, the contract, the network or a wallet can throw.
 * Never shows a raw technical message.
 */
export function plainError(error: unknown): string {
  if (error instanceof PlainError || error instanceof ApiError) return error.message;

  switch (webAuthnName(error)) {
    case "NotAllowedError":
    case "AbortError":
      return MESSAGES.cancelled;
    case "NotSupportedError":
    case "SecurityError":
      return MESSAGES.unsupported;
    case "InvalidStateError":
      return MESSAGES.exists;
  }

  if (isMeraError(error)) {
    if (error.code === "PRF_UNAVAILABLE") return MESSAGES.noPrf;
    if (error.code === "CRYPTO_UNAVAILABLE") return MESSAGES.insecure;
    if (error.code === "PASSKEY_OPERATION_FAILED") return MESSAGES.cancelled;
    return MESSAGES.unknown;
  }

  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return MESSAGES.cancelled;
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) return friendlyMessage(reverted.data?.errorName);
    return MESSAGES.slow;
  }

  // fetch() rejects with a TypeError when the request never reached the server.
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return typeof navigator !== "undefined" && navigator.onLine === false ? MESSAGES.offline : MESSAGES.slow;
  }

  return MESSAGES.unknown;
}
