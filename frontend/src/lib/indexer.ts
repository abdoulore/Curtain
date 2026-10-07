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

export type MyShowRow = {
  id: string;
  name: string;
  venue: string;
  status: string;
  sold: number;
  checkedIn: number;
  doorsOpen: string;
  endTime: string;
  released: string;
  withdrawn: string;
};

/** Shows an organizer created, newest first. */
export async function fetchShowsOf(organizer: Address): Promise<MyShowRow[]> {
  const data = await query<{ Show: MyShowRow[] }>(
    `query MyShows($organizer: String!) {
      Show(where: { organizer: { _eq: $organizer } }, order_by: { createdAt: desc }) {
        id name venue status sold checkedIn doorsOpen endTime released withdrawn
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

export type OpenShowRow = {
  id: string;
  name: string;
  venue: string;
  price: string;
  capacity: string;
  sold: number;
  doorsOpen: string;
  endTime: string;
  status: string;
};

/** Shows still open for sale; the caller drops ended and sold-out ones. */
export async function fetchOpenShows(): Promise<OpenShowRow[]> {
  const data = await query<{ Show: OpenShowRow[] }>(
    `query Open {
      Show(where: { status: { _eq: Open } }, order_by: { doorsOpen: asc }, limit: 60) {
        id name venue price capacity sold doorsOpen endTime status
      }
    }`,
    {},
  );
  return data.Show;
}

/** Every ticket of a show and its sales and check-in history, for the organizer's door list and chart. */
export async function fetchDoor(show: Address) {
  const data = await query<{
    Ticket: { ticketId: string; state: string; boughtAt: string; checkedInAt: string | null }[];
    Activity: { kind: string; timestamp: string }[];
  }>(
    `query Door($id: String!) {
      Ticket(where: { show_id: { _eq: $id } }, order_by: { ticketId: desc }, limit: 500) {
        ticketId state boughtAt checkedInAt
      }
      Activity(where: { show_id: { _eq: $id }, kind: { _in: [Purchased, CheckedIn] } }, order_by: { timestamp: asc }, limit: 1000) {
        kind timestamp
      }
    }`,
    { id: show.toLowerCase() },
  );
  return {
    tickets: data.Ticket.map((t) => ({
      ticketId: Number(t.ticketId),
      state: t.state,
      boughtAt: Number(t.boughtAt),
      checkedInAt: t.checkedInAt === null ? null : Number(t.checkedInAt),
    })),
    activity: data.Activity.map((a) => ({ kind: a.kind, timestamp: Number(a.timestamp) })),
  };
}
