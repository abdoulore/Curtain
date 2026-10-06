import { bytesToHex, getAddress, sha256, toBytes, type Address, type Hex } from "viem";

/** A show's poster and description, stored off-chain and keyed by the show's address. */
export type ShowMedia = { poster: string | null; description: string; updatedAt: number };

export const POSTER_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_POSTER_BYTES = 3 * 1024 * 1024;
export const MAX_DESCRIPTION = 500;
export const NO_POSTER = `0x${"0".repeat(64)}` as Hex;

export type PosterType = (typeof POSTER_TYPES)[number];
export const posterExtension: Record<PosterType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Checks a poster before it leaves the browser and again on the server. */
export function checkPoster(type: string, size: number): string | null {
  if (!POSTER_TYPES.includes(type as PosterType)) return "Choose a JPG, PNG or WEBP image.";
  if (size > MAX_POSTER_BYTES) return "Choose an image of 3 MB or less.";
  if (size === 0) return "That image is empty.";
  return null;
}

export function checkDescription(text: string): string | null {
  return text.length > MAX_DESCRIPTION ? `Keep the description to ${MAX_DESCRIPTION} characters.` : null;
}

export const posterHash = (bytes: Uint8Array): Hex => sha256(bytes);
export const descriptionHash = (text: string): Hex => sha256(toBytes(text));

/**
 * What the show's organizer signs with their passkey account to set the poster and description. It names the show
 * and the exact file and text, so the signature can't be reused for anything else.
 */
export function mediaMessage(event: Address, poster: Hex, description: Hex): string {
  return ["Curtain show details", `Show: ${getAddress(event)}`, `Poster: ${poster}`, `Description: ${description}`].join("\n");
}

/** Blob pathnames for a show. The poster's name carries its hash, so a new poster gets a fresh URL. */
export const metaPath = (event: Address) => `shows/${event.toLowerCase()}/meta.json`;
export const posterPath = (event: Address, hash: Hex, type: PosterType) =>
  `shows/${event.toLowerCase()}/poster-${hash.slice(2, 14)}.${posterExtension[type]}`;

export const toHexBytes = (bytes: Uint8Array): Hex => bytesToHex(bytes);
