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
 * The cart belongs to whoever is signed in: a signed-in user's cart lives in the `carts` table
 * (one row per user, owner-only RLS), so it follows them across devices; a guest's cart lives in
 * this browser and is merged into their account when they log in. Logging out shows the guest
 * cart again, never the previous user's.
 */
const GUEST_KEY = "shatably.cart.guest";
const LEGACY_KEY = "shatably.cart.v1";
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

/** Switch the cart to `user` (or the guest), merging a guest cart into the account on login. */
async function switchTo(user: AuthUser | null) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (owner) await saveRemote(owner, lines); // flush the previous owner's pending change
  }
  if (!user) {
    owner = null;
    emit(local(GUEST_KEY));
    return;
  }
  owner = user.id;
  const guest = local(GUEST_KEY);
  const mine = await loadRemote(user.id);
  if (owner !== user.id) return; // switched again meanwhile
  if (guest.length) {
    const merged = merge(mine, guest);
    emit(merged);
    storeLocal(GUEST_KEY, []);
    await saveRemote(user.id, merged);
  } else {
    emit(mine);
  }
}

function init() {
  if (ready || typeof window === "undefined") return;
  // One-time move of the old shared cart into the guest cart.
  const legacy = local(LEGACY_KEY);
  if (legacy.length) {
    storeLocal(GUEST_KEY, merge(local(GUEST_KEY), legacy));
    storeLocal(LEGACY_KEY, []);
  }
  emit(local(GUEST_KEY)); // instant guest cart; replaced once the user is known
  ready = getUser().then(switchTo);
  onAuthChange((user) => void switchTo(user));
}

function write(next: CartLine[]) {
  emit(next);
  if (!owner) return storeLocal(GUEST_KEY, next);
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

/** Adds lines; the same item adds up its quantity. */
export function addToCart(added: CartLine[]) {
  init();
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
