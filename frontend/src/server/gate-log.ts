import "server-only";

/**
 * One check-in attempt as the gate screen shows it. Refused attempts never reach the chain, so they live here.
 * `gate` is the paired device whose code was scanned; each gate screen shows only its own attempts.
 */
export type GateResult = { at: number; ok: boolean; ticketId: string; gate?: string; code?: string; hash?: string };

/** The attempts made at one gate device, newest first. */
export function forGate(results: GateResult[], gate: string): GateResult[] {
  return results.filter((r) => r.gate?.toLowerCase() === gate.toLowerCase());
}

export interface GateLog {
  push(event: string, result: GateResult): Promise<void>;
  /** Newest first. */
  recent(event: string): Promise<GateResult[]>;
}

const KEEP = 20;
const TTL_SECONDS = 60 * 60;

export function memoryGateLog(): GateLog {
  const lists = new Map<string, GateResult[]>();
  return {
    async push(event, result) {
      const list = lists.get(event) ?? [];
      list.unshift(result);
      lists.set(event, list.slice(0, KEEP));
    },
    async recent(event) {
      return lists.get(event) ?? [];
    },
  };
}

export function upstashGateLog(url: string, token: string): GateLog {
  const run = async (commands: string[][]) => {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Gate log unavailable (${res.status})`);
    return (await res.json()) as { result: unknown }[];
  };
  return {
    async push(event, result) {
      const key = `gate:${event.toLowerCase()}`;
      await run([
        ["LPUSH", key, JSON.stringify(result)],
        ["LTRIM", key, "0", String(KEEP - 1)],
        ["EXPIRE", key, String(TTL_SECONDS)],
      ]);
    },
    async recent(event) {
      const [range] = await run([["LRANGE", `gate:${event.toLowerCase()}`, "0", String(KEEP - 1)]]);
      return ((range?.result as string[] | undefined) ?? []).map((s) => JSON.parse(s) as GateResult);
    },
  };
}

let shared: GateLog | undefined;

export function gateLog(): GateLog {
  if (shared) return shared;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  shared = url && token ? upstashGateLog(url, token) : memoryGateLog();
  return shared;
}
