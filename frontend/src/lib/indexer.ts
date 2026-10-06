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
      Activity(where: { show_id: { _eq: $id } }, order_by: { timestamp: desc }, limit: 50) {
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

/** Gate devices currently allowed on a show. */
export async function fetchGates(show: Address): Promise<string[]> {
  const data = await query<{ Gate: { gate: string }[] }>(
    `query Gates($id: String!) {
      Gate(where: { show_id: { _eq: $id }, allowed: { _eq: true } }) { gate }
    }`,
    { id: show.toLowerCase() },
  );
  return data.Gate.map((g) => g.gate);
}

export type MyShowRow = { id: string; name: string; venue: string; status: string; sold: number; doorsOpen: string };

/** Shows an organizer created, newest first. */
export async function fetchShowsOf(organizer: Address): Promise<MyShowRow[]> {
  const data = await query<{ Show: MyShowRow[] }>(
    `query MyShows($organizer: String!) {
      Show(where: { organizer: { _eq: $organizer } }, order_by: { createdAt: desc }) {
        id name venue status sold doorsOpen
      }
    }`,
    { organizer: organizer.toLowerCase() },
  );
  return data.Show;
}

/** Tickets on sale for a show, from the indexer. */
export async function fetchListings(show: Address) {
  const data = await query<{ Ticket: { ticketId: string; resalePrice: string; holder: string; state: string }[] }>(
    `query Listings($id: String!) {
      Ticket(where: { show_id: { _eq: $id }, state: { _eq: Active }, resalePrice: { _gt: "0" } }) {
        ticketId resalePrice holder state
      }
    }`,
    { id: show.toLowerCase() },
  );
  return data.Ticket;
}
