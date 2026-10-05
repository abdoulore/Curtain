"use client";

import type { Address } from "viem";

/**
 * Envio HyperIndex GraphQL (Hasura). Public read-only endpoint, so it can be called from the browser.
 * Set NEXT_PUBLIC_ENVIO_GRAPHQL_URL to the Envio Cloud deployment's endpoint.
 */
export const ENVIO_URL = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL ?? "";

export type ShowRow = {
  id: string;
  status: "Open" | "Cancelled" | "Held" | "NotHeld";
  price: string;
  capacity: string;
  sold: number;
  checkedIn: number;
  refundedCount: number;
  paidIn: string;
  escrowed: string;
  released: string;
  withdrawn: string;
  refunded: string;
  updatedAt: string;
};

export type ActivityRow = {
  id: string;
  kind: string;
  ticketId: string | null;
  account: string | null;
  amount: string;
  timestamp: string;
  txHash: string;
};

export type TicketRow = { id: string; ticketId: string; state: string; holder: string; boughtAt: string; boughtTx: string; show_id: string };

async function query<T>(gql: string, variables: Record<string, unknown>): Promise<T> {
  if (!ENVIO_URL) throw new Error("The indexer is not configured yet");
  const res = await fetch(ENVIO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: gql, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

export async function fetchBoard(show: Address): Promise<{ show: ShowRow | null; activity: ActivityRow[] }> {
  const id = show.toLowerCase();
  const data = await query<{ Show_by_pk: ShowRow | null; Activity: ActivityRow[] }>(
    `query Board($id: String!) {
      Show_by_pk(id: $id) {
        id status price capacity sold checkedIn refundedCount paidIn escrowed released withdrawn refunded updatedAt
      }
      Activity(where: { show_id: { _eq: $id } }, order_by: { timestamp: desc }, limit: 25) {
        id kind ticketId account amount timestamp txHash
      }
    }`,
    { id },
  );
  return { show: data.Show_by_pk, activity: data.Activity };
}

export async function fetchTicketsOf(holder: Address): Promise<TicketRow[]> {
  const data = await query<{ Ticket: TicketRow[] }>(
    `query Mine($holder: String!) {
      Ticket(where: { holder: { _eq: $holder } }, order_by: { boughtAt: desc }) {
        id ticketId state holder boughtAt boughtTx show_id
      }
    }`,
    { holder: holder.toLowerCase() },
  );
  return data.Ticket;
}
