/**
 * The words Curtain uses with people. One vocabulary everywhere: Protected, Paid to organizer, Refunded,
 * Checked in, Gate, Fingerprint or Face ID. Technical words stay in the README and on explorer links.
 */
export const BUYER_PROMISE =
  "Your money is held until the show happens. When you walk in, it's paid to the organizer at the door. If the show doesn't happen, it comes back to you automatically.";

export const ORGANIZER_PROMISE =
  "Ticket money reaches you as people walk in. Once the show is confirmed, the rest follows. If it doesn't happen, buyers are refunded automatically.";

export const PASSKEY_PRIVACY = "Your fingerprint or Face ID never leaves your phone. Curtain only receives a secure confirmation.";

export const WORDS = {
  protected: "Protected",
  paid: "Paid to organizer",
  refunded: "Refunded",
  checkedIn: "Checked in",
  gate: "Gate",
  biometric: "Fingerprint or Face ID",
} as const;

/** The protection rules an organizer agrees to, shown on Create Show without any inputs. */
export const PROTECTION_RULES = [
  "Ticket money is protected until the show happens.",
  "Each ticket's money is paid to you the moment its holder checks in at your gate.",
  "After the show, if at least half of the tickets sold were checked in, the show is confirmed and the rest is paid to you.",
  "If fewer than half checked in, or you cancel, every unscanned ticket is refunded automatically.",
  "Resale is capped at face value, and each person can hold up to the limit you set.",
] as const;
