/**
 * Whether this browser can give Curtain what it needs from a passkey: the PRF extension (Mera derives the account
 * from it) on a platform authenticator. Checked before creating a passkey, so a browser without PRF is sent to the
 * phone instead of ending up with a passkey it can't use.
 */
export type PrfSupport = "yes" | "no" | "unknown";

type Capabilities = Record<string, boolean | undefined>;

/** Pure decision from the browser's reported capabilities (testable without a browser). */
export function prfFromCapabilities(caps: Capabilities | null | undefined): PrfSupport {
  if (!caps) return "unknown";
  if (caps["extension:prf"] === true) return "yes";
  if (caps["extension:prf"] === false || caps.passkeyPlatformAuthenticator === false) return "no";
  return "unknown";
}

export async function detectPrfSupport(): Promise<PrfSupport> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return "no";
  const pkc = window.PublicKeyCredential as typeof PublicKeyCredential & {
    getClientCapabilities?: () => Promise<Capabilities>;
  };
  if (typeof pkc.getClientCapabilities !== "function") return "unknown";
  try {
    return prfFromCapabilities(await pkc.getClientCapabilities());
  } catch {
    return "unknown";
  }
}
