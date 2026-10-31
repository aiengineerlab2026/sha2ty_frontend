"use client";

import type { CartLine } from "@/lib/cart";
import { lineTotal } from "@/lib/cart";
import { publish } from "@/lib/events";
import { supabase } from "@/lib/supabase/client";

export type Order = { id: string; lines: CartLine[]; total: number; created_at: string };

/** Saves the cart as an order for the signed-in user (orders table, owner-only RLS). */
export async function placeOrder(lines: CartLine[]) {
  const total = lines.reduce((sum, l) => sum + (lineTotal(l) ?? 0), 0);
  const { error } = await supabase().from("orders").insert({ lines, total });
  if (error) throw new Error(error.message);
  publish("order.placed", { lines, total });
}

/** The signed-in user's orders, newest first (empty when signed out or the table is missing). */
export async function fetchOrders(): Promise<Order[]> {
  const { data } = await supabase().from("orders").select("id, lines, total, created_at").order("created_at", { ascending: false });
  return (data ?? []) as Order[];
}
