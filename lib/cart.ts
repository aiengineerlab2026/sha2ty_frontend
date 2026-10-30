"use client";

import { useSyncExternalStore } from "react";
import type { PriceUnit } from "./plan/pricing";

/** One cart line. quantity is pieces for item prices, m² for area prices. */
export interface CartLine {
  key: string;
  kind: "model" | "carpet" | "wall" | "floor" | "window";
  refId: string;
  name: string;
  quantity: number;
  unit: PriceUnit;
  price: number | null;
}

// ponytail: the cart lives in this browser only (no orders backend yet); move it to a
// carts table when checkout exists.
const KEY = "shatably.cart.v1";
const listeners = new Set<() => void>();
let cache: CartLine[] | null = null;

function read(): CartLine[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "[]") as CartLine[];
  } catch {
    cache = [];
  }
  return cache;
}

function write(lines: CartLine[]) {
  cache = lines;
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // private mode / blocked storage: the cart still works for this page view
  }
  listeners.forEach((l) => l());
}

const EMPTY: CartLine[] = [];

export function useCart() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}

/** Adds lines; the same item adds up its quantity. */
export function addToCart(lines: CartLine[]) {
  const next = new Map(read().map((l) => [l.key, { ...l }]));
  for (const line of lines) {
    const hit = next.get(line.key);
    if (hit) hit.quantity = round(hit.quantity + line.quantity);
    else next.set(line.key, { ...line, quantity: round(line.quantity) });
  }
  write([...next.values()]);
}

export function setCartQuantity(key: string, quantity: number) {
  write(read().flatMap((l) => (l.key !== key ? [l] : quantity > 0 ? [{ ...l, quantity: round(quantity) }] : [])));
}

export function clearCart() {
  write([]);
}

export const lineTotal = (l: CartLine) => (l.price == null ? null : l.price * l.quantity);

const round = (n: number) => Math.round(n * 100) / 100;
