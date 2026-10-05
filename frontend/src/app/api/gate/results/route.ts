import { z } from "zod";
import { checkGateAccessCode } from "@/server/gate-token";
import { gateLog } from "@/server/gate-log";
import { address, fail, ok, parse } from "@/server/http";

const body = z.object({ event: address, code: z.string().min(1) });

/** The gate screen's feed of recent check-in attempts, green and red, newest first. */
export async function POST(request: Request) {
  try {
    const { event, code } = await parse(request, body);
    checkGateAccessCode(code);
    return ok({ results: await gateLog().recent(event) });
  } catch (error) {
    return fail(error);
  }
}
