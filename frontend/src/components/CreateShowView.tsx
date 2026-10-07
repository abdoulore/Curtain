"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Address, Hash } from "viem";
import { curtainFactoryAbi } from "@/lib/abis";
import { friendlyPasskeyError, signUp, unlock } from "@/lib/account";
import { ApiError, postJson } from "@/lib/api";
import { CURTAIN_FACTORY } from "@/lib/chain";
import { ORGANIZER_PROMISE, PASSKEY_PRIVACY, PROTECTION_RULES } from "@/lib/copy";
import {
  buildShow,
  createShowBody,
  createShowTypedData,
  DEFAULT_PER_PERSON,
  SHOW_LENGTH_SECONDS,
  type ShowForm,
} from "@/lib/create-show";
import { useAccount, useHydrated } from "@/lib/hooks";
import { rememberCreatedShow } from "@/lib/organizer-local";
import { browserClient } from "@/lib/reads";
import { uploadShowMedia } from "@/lib/use-show-media";
import { PosterFields } from "./PosterField";
import { SignInButton } from "./SignInButton";

/** "2026-10-06T19:30" in local time for a datetime-local input. */
function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const field = "mt-1 w-full rounded-xl border border-line bg-background px-3 py-2.5 outline-none focus:border-velvet";
const section = "rounded-3xl border border-line bg-surface p-5 lg:p-6";

export function CreateShowView() {
  const hydrated = useHydrated();
  const account = useAccount();
  const router = useRouter();
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [startsAt, setStartsAt] = useState(() => localInputValue(new Date()));
  const [price, setPrice] = useState("1500");
  const [capacity, setCapacity] = useState("100");
  const [perPerson, setPerPerson] = useState(String(DEFAULT_PER_PERSON));
  const [yourName, setYourName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [poster, setPoster] = useState<File | null>(null);
  const [description, setDescription] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    setError(null);
    const form: ShowForm = {
      name,
      venue,
      startsAt: Math.floor(new Date(startsAt).getTime() / 1000),
      priceNaira: price,
      capacity,
      perPerson,
    };
    const now = Math.floor(Date.now() / 1000);
    const built = buildShow(form, account.address, now);
    if (!built.ok) return setError(built.error);
    try {
      // The passkey prompt opens straight from the tap, before any network call.
      setBusy("Confirm with your fingerprint or Face ID");
      const { signer } = await unlock(account);
      setBusy("Creating your show…");
      const nonce = await browserClient.readContract({
        address: CURTAIN_FACTORY,
        abi: curtainFactoryAbi,
        functionName: "nonces",
        args: [signer.address],
      });
      const deadline = BigInt(now + 15 * 60);
      const sig = await signer.signTypedData(
        createShowTypedData(signer.address, built.name, built.venue, built.params, nonce, deadline) as never,
      );
      const res = await postJson<{ event: Address; hash: Hash }>(
        "/api/relay/create",
        createShowBody(signer.address, built.name, built.venue, built.params, nonce, deadline, sig),
      );
      rememberCreatedShow({ event: res.event, organizer: signer.address, name: built.name, hash: res.hash, at: Date.now() });
      if (poster || description.trim()) {
        // Signed with the same unlocked account, so no second fingerprint prompt.
        setBusy("Adding the poster…");
        await uploadShowMedia(res.event, signer, poster, description.trim()).catch(() => {});
      }
      router.push(`/organizer/${res.event}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : friendlyPasskeyError(err));
      setBusy(null);
    }
  }

  if (!hydrated) return null;

  if (!account) {
    return (
      <main className="mx-auto max-w-md pt-10 lg:pt-16">
        <h1 className="text-2xl font-semibold">Create a show</h1>
        <p className="mt-2 text-muted">
          Organizers sign in with a passkey, the same way buyers do: your fingerprint or Face ID, no password and no
          wallet.
        </p>
        <div className={`mt-6 ${section}`}>
          <label className="text-sm font-medium" htmlFor="org-name">
            Your name or company
          </label>
          <input id="org-name" value={yourName} onChange={(e) => setYourName(e.target.value)} className={field} />
          <button
            onClick={() => {
              setBusy("Confirm with your fingerprint or Face ID");
              setError(null);
              signUp(yourName.trim() || "Organizer")
                .catch((err) => setError(friendlyPasskeyError(err)))
                .finally(() => setBusy(null));
            }}
            disabled={busy !== null}
            className="mt-4 w-full rounded-2xl bg-velvet px-5 py-4 font-semibold text-velvet-ink disabled:opacity-50"
          >
            {busy ?? "Create your organizer passkey"}
          </button>
          <p className="mt-3 text-xs text-muted">{PASSKEY_PRIVACY}</p>
          {error && <p className="mt-2 text-sm text-stop" role="alert">{error}</p>}
          <div className="mt-4 text-center">
            <SignInButton variant="link" label="I already have a Curtain passkey" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl pt-6 lg:pt-10">
      <p className="text-sm text-muted">
        <Link href="/organizer" className="underline">
          Your shows
        </Link>
      </p>
      <h1 className="mt-1 text-2xl font-semibold lg:text-3xl">Create a show</h1>
      <p className="mt-1 text-sm text-muted">{ORGANIZER_PROMISE}</p>

      <form onSubmit={create} className="mt-6 space-y-5">
        <section className={section} aria-labelledby="about-heading">
          <h2 id="about-heading" className="text-lg font-semibold">
            About the show
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium sm:col-span-2">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lagos Laughs" maxLength={80} className={field} />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              Venue
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="Terra Kulture, Victoria Island"
                maxLength={120}
                className={field}
              />
            </label>
            <label className="text-sm font-medium sm:col-span-2">
              Date and time doors open
              <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={field} />
              <span className="mt-1 block text-xs font-normal text-muted">
                The show runs {SHOW_LENGTH_SECONDS / 3600} hours, and tickets sell until it ends.
              </span>
            </label>
            <PosterFields poster={poster} onPoster={setPoster} description={description} onDescription={setDescription} />
          </div>
        </section>

        <section className={section} aria-labelledby="tickets-heading">
          <h2 id="tickets-heading" className="text-lg font-semibold">
            Tickets
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="text-sm font-medium">
              Price
              <div className={`${field} flex items-center`}>
                <span className="text-muted">₦</span>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ""))}
                  inputMode="decimal"
                  aria-label="Price in naira"
                  className="min-w-0 flex-1 bg-transparent pl-1 outline-none"
                />
              </div>
            </label>
            <label className="text-sm font-medium">
              Capacity
              <input
                value={capacity}
                onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                className={field}
              />
            </label>
            <label className="text-sm font-medium">
              Tickets per person
              <input
                value={perPerson}
                onChange={(e) => setPerPerson(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                className={field}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted">Tickets per person counts resale and gifts too.</p>
        </section>

        <section className={section} aria-labelledby="protection-heading">
          <h2 id="protection-heading" className="text-lg font-semibold">
            Protection
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {PROTECTION_RULES.map((rule) => (
              <li key={rule} className="flex gap-2">
                <span aria-hidden className="text-go">
                  ✓
                </span>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </section>

        <div>
          <button
            type="submit"
            disabled={busy !== null}
            className="w-full rounded-2xl bg-velvet px-5 py-4 text-base font-semibold text-velvet-ink disabled:opacity-50"
          >
            {busy ?? "Create the show"}
          </button>
          {error && (
            <p className="mt-2 text-sm text-stop" role="alert">
              {error}
            </p>
          )}
          <p className="mt-2 text-center text-xs text-muted">
            You&apos;ll confirm once with your fingerprint. Curtain covers the network fee.
          </p>
        </div>
      </form>
    </main>
  );
}
