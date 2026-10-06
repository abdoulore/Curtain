import "server-only";
import { head, put } from "@vercel/blob";
import { getAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import {
  checkDescription,
  checkPoster,
  descriptionHash,
  mediaMessage,
  metaPath,
  NO_POSTER,
  posterHash,
  posterPath,
  type PosterType,
  type ShowMedia,
} from "@/lib/show-media";
import { RelayError } from "./relay";

export type MediaStore = {
  putPoster: (path: string, bytes: Uint8Array, type: string) => Promise<string>;
  putMeta: (path: string, meta: ShowMedia) => Promise<void>;
  getMeta: (path: string) => Promise<ShowMedia | null>;
};

/** Vercel Blob, public. Metadata is rewritten in place with a short cache; posters are immutable by name. */
export const blobStore: MediaStore = {
  async putPoster(path, bytes, type) {
    const res = await put(path, Buffer.from(bytes), {
      access: "public",
      contentType: type,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return res.url;
  },
  async putMeta(path, meta) {
    await put(path, JSON.stringify(meta), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
  },
  async getMeta(path) {
    try {
      const info = await head(path);
      const res = await fetch(`${info.url}?v=${info.uploadedAt.getTime()}`, { cache: "no-store" });
      return res.ok ? ((await res.json()) as ShowMedia) : null;
    } catch {
      return null;
    }
  },
};

export type MediaUpdate = { poster?: { bytes: Uint8Array; type: string }; description: string; sig: Hex };

/**
 * Stores a show's poster and description when the signature comes from the show's organizer and covers exactly this
 * file and text. Without a new poster, the current one is kept.
 */
export async function saveShowMedia(
  event: Address,
  update: MediaUpdate,
  organizerOf: (event: Address) => Promise<Address>,
  store: MediaStore,
  now = Date.now(),
): Promise<ShowMedia> {
  const descriptionError = checkDescription(update.description);
  if (descriptionError) throw new RelayError(400, "DescriptionTooLong", descriptionError);
  if (update.poster) {
    const posterError = checkPoster(update.poster.type, update.poster.bytes.length);
    if (posterError) throw new RelayError(400, "PosterRejected", posterError);
  }
  const pHash = update.poster ? posterHash(update.poster.bytes) : NO_POSTER;
  const message = mediaMessage(event, pHash, descriptionHash(update.description));
  const signer = await recoverMessageAddress({ message, signature: update.sig }).catch(() => null);
  if (!signer || getAddress(signer) !== getAddress(await organizerOf(event))) {
    throw new RelayError(403, "NotOrganizer", "Only the show's organizer can change its poster and description");
  }

  const current = await store.getMeta(metaPath(event));
  const poster = update.poster
    ? await store.putPoster(posterPath(event, pHash, update.poster.type as PosterType), update.poster.bytes, update.poster.type)
    : (current?.poster ?? null);
  const meta: ShowMedia = { poster, description: update.description, updatedAt: now };
  await store.putMeta(metaPath(event), meta);
  return meta;
}
