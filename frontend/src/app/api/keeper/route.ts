import { getAddress, parseAbi, type Address } from "viem";
import { CURTAIN_KEEPER } from "@/lib/chain";
import { publicClient } from "@/server/clients";
import { fail, ok } from "@/server/http";
import { keepShow } from "@/server/keeper";
import { RelayError } from "@/server/relay";

const keeperAbi = parseAbi(["function pending(address[] events) view returns ((address eventAddress, uint8 action)[] jobs)"]);

/** Shows that may still owe a settlement or refunds, from the indexer. */
async function candidateShows(): Promise<Address[]> {
  const url = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL;
  if (!url) return [];
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `{ Show(where: { status: { _in: ["Open", "Cancelled", "NotHeld"] } }, limit: 500) { id } }`,
    }),
  });
  const json = (await res.json()) as { data?: { Show: { id: string }[] } };
  return (json.data?.Show ?? []).map((s) => getAddress(s.id));
}

/** Refund batches each wait for their receipt, so allow more than the default time. */
export const maxDuration = 60;

/**
 * The relayer's keeper, run daily by Vercel Cron as a backstop to the Chainlink workflow: asks CurtainKeeper which
 * shows are due (the same onchain rule the workflow uses), then settles them and pushes their refunds.
 */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      throw new RelayError(401, "Unauthorized", "Cron only");
    }
    const shows = await candidateShows();
    const jobs = shows.length
      ? await publicClient.readContract({ address: CURTAIN_KEEPER, abi: keeperAbi, functionName: "pending", args: [shows] })
      : [];
    const done: { event: Address; hashes: string[]; error?: string }[] = [];
    for (const job of jobs) {
      try {
        done.push({ event: job.eventAddress, hashes: await keepShow(job.eventAddress) });
      } catch (error) {
        done.push({ event: job.eventAddress, hashes: [], error: error instanceof Error ? error.message : String(error) });
      }
    }
    return ok({ checked: shows.length, due: jobs.length, done });
  } catch (error) {
    return fail(error);
  }
}
