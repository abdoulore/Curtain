"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Address, Hash } from "viem";
import { curtainFactoryAbi } from "@/lib/abis";
import { signUp, unlock } from "@/lib/account";
import { postJson } from "@/lib/api";
import { CURTAIN_FACTORY } from "@/lib/chain";
import { PASSKEY_PRIVACY } from "@/lib/copy";
import {
  buildShow,
  createShowBody,
  createShowTypedData,
  DEFAULT_PER_PERSON,
  eventStepError,
  SHOW_LENGTH_SECONDS,
  ticketStepError,
  type ShowForm,
} from "@/lib/create-show";
import { plainError } from "@/lib/errors";
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

const field = "mt-1.5 w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-base font-normal outline-none focus:border-velvet";

/** The current time in Unix seconds, read when an action runs. */
const nowSeconds = () => Math.floor(Date.now() / 1000);
const nowMs = () => Date.now();

const STEPS = ["Event", "Tickets", "Review"] as const;
type Step = 0 | 1 | 2;

const longDate = new Intl.DateTimeFormat("en-NG", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="mt-8 flex items-center gap-3 text-sm" aria-label="Steps">
      {STEPS.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="flex items-center gap-3" aria-current={current ? "step" : undefined}>
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                current ? "bg-velvet text-velvet-ink" : done ? "bg-foreground text-background" : "text-muted ring-1 ring-line"
              }`}
            >
              {done ? (
                <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                  <path d="M4.5 10.5l3.5 3.5 7.5-8" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span className={current ? "font-semibold" : "text-muted"}>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
            {i < STEPS.length - 1 && <span aria-hidden className="h-px w-6 bg-line sm:w-10" />}
          </li>
        );
      })}
    </ol>
  );
}

export function CreateShowView() {
  const hydrated = useHydrated();
  const account = useAccount();
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The chosen poster, previewed on the review step; the object URL is freed when it changes.
  const posterUrl = useMemo(() => (poster ? URL.createObjectURL(poster) : null), [poster]);
  useEffect(() => () => {
    if (posterUrl) URL.revokeObjectURL(posterUrl);
  }, [posterUrl]);

  const startsAtSeconds = Math.floor(new Date(startsAt).getTime() / 1000);
  const form: ShowForm = { name, venue, startsAt: startsAtSeconds, priceNaira: price, capacity, perPerson };

  // Each step's heading takes focus, so keyboard and screen-reader users land at the top of the new step.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step]);

  /** Any edit clears the last problem, which was about the old value. */
  function edit(set: (v: string) => void, value: string) {
    set(value);
    setError(null);
  }

  function goTo(next: Step) {
    setError(null);
    setStep(next);
  }

  function continueFrom(current: Step) {
    const problem =
      current === 0 ? eventStepError(form, nowSeconds()) : current === 1 ? ticketStepError(form) : null;
    if (problem) return setError(problem);
    goTo((current + 1) as Step);
  }

  async function create() {
    if (!account) return;
    setError(null);
    const now = nowSeconds();
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
      rememberCreatedShow({ event: res.event, organizer: signer.address, name: built.name, hash: res.hash, at: nowMs() });
      if (poster || description.trim()) {
        // Signed with the same unlocked account, so no second fingerprint prompt.
        setBusy("Adding the poster…");
        await uploadShowMedia(res.event, signer, poster, description.trim()).catch(() => {});
      }
      router.push(`/organizer/${res.event}`);
    } catch (err) {
      setError(plainError(err));
      setBusy(null);
    }
  }

  if (!hydrated) return null;

  if (!account) {
    return (
      <main className="mx-auto max-w-md pt-10 lg:pt-16">
        <h1 className="font-display text-4xl leading-none">Create a show</h1>
        <p className="mt-3 text-muted">
          Organizers sign in with a passkey, the same way buyers do: your fingerprint or Face ID, no password and no
          wallet.
        </p>
        <div className="mt-8">
          <label className="text-sm font-medium" htmlFor="org-name">
            Your name or company
          </label>
          <input id="org-name" value={yourName} onChange={(e) => setYourName(e.target.value)} className={field} />
          <button
            onClick={() => {
              setBusy("Confirm with your fingerprint or Face ID");
              setError(null);
              signUp(yourName.trim() || "Organizer")
                .catch((err) => setError(plainError(err)))
                .finally(() => setBusy(null));
            }}
            disabled={busy !== null}
            className="mt-4 w-full rounded-2xl bg-velvet px-5 py-4 font-semibold text-velvet-ink disabled:opacity-50"
          >
            {busy ?? "Create your organizer passkey"}
          </button>
          <p className="mt-3 text-xs text-muted">{PASSKEY_PRIVACY}</p>
          {error && (
            <p className="mt-2 text-sm text-stop" role="alert">
              {error}
            </p>
          )}
          <div className="mt-5 text-center">
            <SignInButton variant="link" label="I already have a Curtain passkey" />
          </div>
        </div>
      </main>
    );
  }

  const nav = (back: Step | null, next: ReactNode) => (
    <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:items-start sm:justify-between">
      {back !== null ? (
        <button
          type="button"
          onClick={() => goTo(back)}
          disabled={busy !== null}
          className="rounded-2xl px-5 py-4 font-semibold ring-1 ring-line hover:bg-surface disabled:opacity-50"
        >
          Back
        </button>
      ) : (
        <span />
      )}
      {next}
    </div>
  );
  const continueButton = (from: Step) => (
    <button
      type="submit"
      className="rounded-2xl bg-velvet px-8 py-4 text-base font-semibold text-velvet-ink sm:min-w-48"
      onClick={() => continueFrom(from)}
    >
      Continue
    </button>
  );
  const errorLine = error && (
    <p className="mt-4 text-sm text-stop" role="alert">
      {error}
    </p>
  );

  return (
    <main className="mx-auto max-w-2xl pt-6 lg:pt-10">
      <Link href="/organizer" className="text-sm text-muted hover:text-foreground">
        Your shows
      </Link>
      <h1 className="mt-1 font-display text-4xl leading-none lg:text-5xl">Create a show</h1>
      <Stepper step={step} />

      <form
        onSubmit={(e) => e.preventDefault()}
        className="step-in mt-10"
        key={step}
        aria-labelledby={`step-${step}-heading`}
      >
        {step === 0 && (
          <>
            <h2 id="step-0-heading" ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
              The event
            </h2>
            <div className="mt-6 grid grid-cols-1 gap-5">
              <label className="text-sm font-medium">
                Name
                <input value={name} onChange={(e) => edit(setName, e.target.value)} placeholder="Ember Comedy Night" maxLength={80} className={field} />
              </label>
              <label className="text-sm font-medium">
                Venue
                <input value={venue} onChange={(e) => edit(setVenue, e.target.value)} placeholder="The Ember Room, Yaba" maxLength={120} className={field} />
              </label>
              <label className="text-sm font-medium">
                Date and time doors open
                <input type="datetime-local" value={startsAt} onChange={(e) => edit(setStartsAt, e.target.value)} className={field} />
                <span className="mt-1 block text-xs font-normal text-muted">
                  The show runs {SHOW_LENGTH_SECONDS / 3600} hours, and tickets sell until it ends.
                </span>
              </label>
              <PosterFields poster={poster} onPoster={setPoster} description={description} onDescription={setDescription} />
            </div>
            {errorLine}
            {nav(null, continueButton(0))}
          </>
        )}

        {step === 1 && (
          <>
            <h2 id="step-1-heading" ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
              Tickets
            </h2>
            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
              <label className="text-sm font-medium">
                Price
                <div className={`${field} flex items-center`}>
                  <span className="text-muted">₦</span>
                  <input
                    value={price}
                    onChange={(e) => edit(setPrice, e.target.value.replace(/[^\d.,]/g, ""))}
                    inputMode="decimal"
                    aria-label="Price in naira"
                    className="min-w-0 flex-1 bg-transparent pl-1 outline-none"
                  />
                </div>
              </label>
              <label className="text-sm font-medium">
                Capacity
                <input value={capacity} onChange={(e) => edit(setCapacity, e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={field} />
              </label>
              <label className="text-sm font-medium">
                Tickets per person
                <input value={perPerson} onChange={(e) => edit(setPerPerson, e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={field} />
              </label>
            </div>
            <p className="mt-3 text-xs text-muted">Tickets per person counts resale and gifts too.</p>
            {errorLine}
            {nav(0, continueButton(1))}
          </>
        )}

        {step === 2 && (
          <>
            <h2 id="step-2-heading" ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">
              Review
            </h2>
            <div className="mt-6 overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
              {posterUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={posterUrl} alt="" className="aspect-[16/10] w-full bg-stage object-contain" />
              )}
              <div className="p-5 sm:p-6">
                <p className="font-display text-3xl leading-tight">{name.trim()}</p>
                <p className="mt-1 text-muted">
                  {Number.isFinite(startsAtSeconds) ? longDate.format(new Date(startsAtSeconds * 1000)) : ""} · {venue.trim()}
                </p>
                <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-5">
                  <div>
                    <dt className="text-xs text-muted">Price</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">₦{Number(price.replace(/,/g, "")).toLocaleString("en-NG")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Tickets</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">{Number(capacity).toLocaleString("en-NG")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Per person</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">{perPerson}</dd>
                  </div>
                </dl>
                <div className="mt-5 flex gap-4 text-sm">
                  <button type="button" onClick={() => goTo(0)} className="font-medium underline underline-offset-4">
                    Edit the event
                  </button>
                  <button type="button" onClick={() => goTo(1)} className="font-medium underline underline-offset-4">
                    Edit tickets
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3 text-sm">
              <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 text-go" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
                <path d="M10 2.5l6 2.5v4.5c0 3.6-2.6 6.2-6 7.5-3.4-1.3-6-3.9-6-7.5V5z" />
                <path d="M7.2 10l2 2 3.6-4" strokeLinecap="round" />
              </svg>
              <p>
                Ticket money is protected until the show happens. Each ticket is paid to you the moment its holder checks
                in. If fewer than half the tickets sold are checked in, or you cancel, every unscanned ticket is refunded
                automatically.
              </p>
            </div>

            {errorLine}
            {nav(
              1,
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                <button
                  type="button"
                  onClick={create}
                  disabled={busy !== null}
                  className="rounded-2xl bg-velvet px-8 py-4 text-base font-semibold text-velvet-ink disabled:opacity-50 sm:min-w-48"
                >
                  {busy ?? "Create show"}
                </button>
                <p className="text-center text-xs text-muted sm:text-right">
                  You&apos;ll confirm once with your fingerprint. Curtain covers the network fee.
                </p>
              </div>,
            )}
          </>
        )}
      </form>
    </main>
  );
}
