import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkPoster, descriptionHash, mediaMessage, NO_POSTER, posterHash, type ShowMedia } from "@/lib/show-media";
import { saveShowMedia, type MediaStore } from "./show-media";

const EVENT = "0x5562bF1ccBabcF2f060239f9D241Ba9661217135";
const organizer = privateKeyToAccount(generatePrivateKey());
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function memory(): MediaStore & { files: Map<string, unknown> } {
  const files = new Map<string, unknown>();
  return {
    files,
    async putPoster(path, bytes) {
      files.set(path, bytes);
      return `https://blob.example/${path}`;
    },
    async putMeta(path, meta) {
      files.set(path, meta);
    },
    async getMeta(path) {
      return (files.get(path) as ShowMedia) ?? null;
    },
  };
}
const organizerOf = async () => organizer.address;
const sign = (poster: `0x${string}`, description: string, who = organizer) =>
  who.signMessage({ message: mediaMessage(EVENT, poster, descriptionHash(description)) });

describe("checkPoster", () => {
  it("takes JPG, PNG and WEBP up to 3 MB", () => {
    expect(checkPoster("image/png", 1000)).toBeNull();
    expect(checkPoster("image/webp", 3 * 1024 * 1024)).toBeNull();
    expect(checkPoster("image/gif", 1000)).toMatch(/JPG, PNG or WEBP/);
    expect(checkPoster("image/jpeg", 3 * 1024 * 1024 + 1)).toMatch(/3 MB/);
  });
});

describe("saveShowMedia", () => {
  it("stores the poster and description signed by the organizer", async () => {
    const store = memory();
    const sig = await sign(posterHash(png), "Two hours of stand-up.");
    const meta = await saveShowMedia(EVENT, { poster: { bytes: png, type: "image/png" }, description: "Two hours of stand-up.", sig }, organizerOf, store, 7);
    expect(meta.description).toBe("Two hours of stand-up.");
    expect(meta.poster).toMatch(/^https:\/\/blob\.example\/shows\/0x5562bf1ccbabcf2f060239f9d241ba9661217135\/poster-[0-9a-f]{12}\.png$/);
    expect(meta.updatedAt).toBe(7);
  });

  it("keeps the current poster when only the description changes", async () => {
    const store = memory();
    await saveShowMedia(EVENT, { poster: { bytes: png, type: "image/png" }, description: "a", sig: await sign(posterHash(png), "a") }, organizerOf, store);
    const meta = await saveShowMedia(EVENT, { description: "b", sig: await sign(NO_POSTER, "b") }, organizerOf, store);
    expect(meta.description).toBe("b");
    expect(meta.poster).toContain("poster-");
  });

  it("refuses anyone but the organizer", async () => {
    const stranger = privateKeyToAccount(generatePrivateKey());
    const sig = await sign(NO_POSTER, "hi", stranger);
    await expect(saveShowMedia(EVENT, { description: "hi", sig }, organizerOf, memory())).rejects.toMatchObject({ code: "NotOrganizer" });
  });

  it("refuses a signature over a different file", async () => {
    const sig = await sign(posterHash(new Uint8Array([1])), "hi");
    await expect(
      saveShowMedia(EVENT, { poster: { bytes: png, type: "image/png" }, description: "hi", sig }, organizerOf, memory()),
    ).rejects.toMatchObject({ code: "NotOrganizer" });
  });

  it("refuses a signature over different text", async () => {
    const sig = await sign(NO_POSTER, "original");
    await expect(saveShowMedia(EVENT, { description: "edited", sig }, organizerOf, memory())).rejects.toMatchObject({ code: "NotOrganizer" });
  });

  it("refuses an oversized description or poster", async () => {
    const long = "x".repeat(501);
    await expect(saveShowMedia(EVENT, { description: long, sig: await sign(NO_POSTER, long) }, organizerOf, memory())).rejects.toMatchObject({
      code: "DescriptionTooLong",
    });
    const gif = { bytes: png, type: "image/gif" };
    await expect(saveShowMedia(EVENT, { poster: gif, description: "", sig: "0x" }, organizerOf, memory())).rejects.toMatchObject({
      code: "PosterRejected",
    });
  });
});
