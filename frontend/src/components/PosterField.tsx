"use client";

import { useEffect, useMemo, useState } from "react";
import { checkPoster, MAX_DESCRIPTION, POSTER_TYPES } from "@/lib/show-media";

/** Poster picker with a preview, and the show's description. Both optional. */
export function PosterFields({
  poster,
  onPoster,
  description,
  onDescription,
  currentPoster,
}: {
  poster: File | null;
  onPoster: (f: File | null) => void;
  description: string;
  onDescription: (d: string) => void;
  currentPoster?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (poster ? URL.createObjectURL(poster) : null), [poster]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const shown = poster ? preview : currentPoster;

  return (
    <>
      <div className="text-sm font-medium sm:col-span-2">
        Poster <span className="font-normal text-muted">(optional)</span>
        <label className="mt-1 flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-line bg-background p-3 hover:border-velvet">
          <span className="relative aspect-[4/5] w-20 shrink-0 overflow-hidden rounded-lg bg-surface">
            {shown ? (
              // A local preview (object URL) or the stored poster; next/image can't optimise object URLs.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown} alt="Poster preview" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-2xl text-muted">+</span>
            )}
          </span>
          <span className="text-sm font-normal">
            <span className="block font-medium">{shown ? "Change the poster" : "Add a poster"}</span>
            <span className="block text-xs text-muted">JPG, PNG or WEBP, up to 3 MB. Landscape looks best.</span>
          </span>
          <input
            type="file"
            accept={POSTER_TYPES.join(",")}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              e.target.value = "";
              if (!file) return;
              const problem = checkPoster(file.type, file.size);
              setError(problem);
              if (!problem) onPoster(file);
            }}
          />
        </label>
        {error && <span className="mt-1 block text-xs font-normal text-stop">{error}</span>}
      </div>
      <label className="text-sm font-medium sm:col-span-2">
        Description <span className="font-normal text-muted">(optional)</span>
        <textarea
          value={description}
          onChange={(e) => onDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
          rows={4}
          maxLength={MAX_DESCRIPTION}
          placeholder="Who's performing, what to expect, dress code."
          className="mt-1 w-full rounded-xl border border-line bg-background px-3 py-2.5 font-normal outline-none focus:border-velvet"
        />
        <span className="mt-1 block text-right text-xs font-normal text-muted">
          {description.length} / {MAX_DESCRIPTION}
        </span>
      </label>
    </>
  );
}
