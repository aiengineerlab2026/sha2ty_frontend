"use client";

import { useSyncExternalStore } from "react";
import { getUser, onAuthChange, type AuthUser } from "@/lib/auth/client";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
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

/**
 * Only signed-in users have a cart. It lives in the `carts` table (one row per user, owner-only RLS),
 * so it follows them across devices. Guests see an empty cart, and adding to it sends them to log
 * in. Logging out empties the cart on screen, never showing the previous user's.
 */
const OLD_KEYS = ["shatably.cart.v1", "shatably.cart.guest"]; // browser carts from before; dropped
const userKey = (id: string) => `shatably.cart.${id}`; // fallback while the carts table is missing
const SAVE_DELAY = 400;

const listeners = new Set<() => void>();
const EMPTY: CartLine[] = [];
let lines: CartLine[] = EMPTY;
let owner: string | null = null; // user id, or null for the guest cart
let ready: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let tableMissing = false;

function local(key: string): CartLine[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as CartLine[];
  } catch {
    return [];
  }
}

function storeLocal(key: string, value: CartLine[]) {
  try {
    if (value.length) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    // private mode / blocked storage: the cart still works for this page view
  }
}

function emit(next: CartLine[]) {
  lines = next;
  listeners.forEach((l) => l());
}

async function loadRemote(id: string): Promise<CartLine[]> {
  if (!supabaseConfigured() || tableMissing) return local(userKey(id));
  const { data, error } = await supabase().from("carts").select("lines").eq("user_id", id).maybeSingle();
  if (error) {
    tableMissing = true; // migration not applied yet (backend/supabase/carts.sql): keep it per user locally
    return local(userKey(id));
  }
  return (data?.lines as CartLine[] | undefined) ?? [];
}

async function saveRemote(id: string, value: CartLine[]) {
  if (!supabaseConfigured() || tableMissing) return storeLocal(userKey(id), value);
  const { error } = await supabase().from("carts").upsert({ user_id: id, lines: value, updated_at: new Date().toISOString() });
  if (error) {
    tableMissing = true;
    storeLocal(userKey(id), value);
  }
}

function merge(base: CartLine[], extra: CartLine[]): CartLine[] {
  const next = new Map(base.map((l) => [l.key, { ...l }]));
  for (const line of extra) {
    const hit = next.get(line.key);
    if (hit) hit.quantity = round(hit.quantity + line.quantity);
    else next.set(line.key, { ...line, quantity: round(line.quantity) });
  }
  return [...next.values()];
}

/** Switch the cart to `user`; signed out, the cart is empty. */
async function switchTo(user: AuthUser | null) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (owner) await saveRemote(owner, lines); // flush the previous owner's pending change
  }
  owner = user?.id ?? null;
  if (!user) return emit(EMPTY);
  const mine = await loadRemote(user.id);
  if (owner === user.id) emit(mine); // unless switched again meanwhile
}

function init() {
  if (ready || typeof window === "undefined") return;
  OLD_KEYS.forEach((key) => storeLocal(key, []));
  ready = getUser().then(switchTo);
  onAuthChange((user) => void switchTo(user));
}

function write(next: CartLine[]) {
  if (!owner) return;
  emit(next);
  const id = owner;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveRemote(id, next);
  }, SAVE_DELAY);
}

export function useCart() {
  return useSyncExternalStore(
    (l) => {
      init();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => lines,
    () => EMPTY,
  );
}

/** Adds lines (the same item adds up its quantity). Signed out: goes to log in, then back here. */
export async function addToCart(added: CartLine[]) {
  init();
  await ready;
  if (!owner) {
    window.location.href = `/vendor/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  write(merge(lines, added));
}

export function setCartQuantity(key: string, quantity: number) {
  write(lines.flatMap((l) => (l.key !== key ? [l] : quantity > 0 ? [{ ...l, quantity: round(quantity) }] : [])));
}

export function clearCart() {
  write([]);
}

export const lineTotal = (l: CartLine) => (l.price == null ? null : l.price * l.quantity);

const round = (n: number) => Math.round(n * 100) / 100;
