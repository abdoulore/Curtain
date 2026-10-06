import Image from "next/image";

/**
 * A show's poster, or Curtain's own when the organizer hasn't added one: the drawn-back curtain on a dark stage.
 * The parent sets the size and aspect ratio.
 */
export function Poster({ src, name, sizes, priority }: { src?: string | null; name: string; sizes: string; priority?: boolean }) {
  if (src) {
    // The whole poster, centred on a blurred copy of itself, so portrait and landscape posters both fit any frame.
    return (
      <div className="relative h-full w-full overflow-hidden bg-[#120d0c]">
        <Image src={src} alt="" aria-hidden fill sizes={sizes} className="scale-110 object-cover opacity-60 blur-2xl" />
        <Image src={src} alt={`${name} poster`} fill sizes={sizes} priority={priority} className="object-contain" />
      </div>
    );
  }
  return (
    <div
      aria-label={`${name} poster`}
      role="img"
      className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_70%,#5a3a1c_0%,#2a1e1b_45%,#120d0c_100%)]"
    >
      <Image src="/logo.png" alt="" width={96} height={96} className="h-1/3 w-auto max-w-[40%] rounded-2xl opacity-90 shadow-lg" />
    </div>
  );
}
