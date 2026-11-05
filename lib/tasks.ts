import type { PartMaterial } from "@/lib/designs/materials";
import { supabase } from "@/lib/supabase/client";

export type TaskStatus = "published" | "awarded" | "in_progress" | "completed" | "cancelled";
export type BidStatus = "submitted" | "withdrawn" | "accepted" | "rejected";

/** A customised model as the request froze it (backend/app/api/marketplace.py spec_from_version). */
export interface DesignSpec {
  design_id: string;
  version_id: string;
  version: number;
  title: string;
  thumbnail_url: string | null;
  glb_url: string | null;
  catalogue_glb_url: string | null;
  source: { model_id: string; title: string; vendor_id?: string | null; width_m?: number | null; height_m?: number | null; depth_m?: number | null };
  dimensions: { width: number; height: number; depth: number } | null;
  resize_mode?: "proportional" | "independent" | null;
  scale?: [number, number, number] | null;
  /** `requested`: the customer wants this part made (absent on requests from before part choice: all). */
  /** `variant`: the vendor's part variant the customer picked (its own shape file and price difference). */
  parts: { id: string; name: string; requested?: boolean; variant?: { id: string; name: string; glb_url: string; price_delta?: number | null } }[];
  whole_model?: boolean;
  materials: { part: string; part_id: string; color?: string; mapUrl?: string; tile?: number; mapping?: string; roughness?: number; metalness?: number; material?: PartMaterial }[];
  /** The customer's estimate for the requested parts' materials; null when one is priced on request. */
  materials_total?: number | null;
}

export interface TaskRow {
  id: string;
  customer_id: string;
  plan_id: string | null;
  title: string;
  scope: string;
  service: string;
  description: string;
  location: string;
  budget_max: number | null;
  status: TaskStatus;
  spec: {
    lines?: { name: string; quantity: number; unit: string; price: number | null; total: number | null }[];
    total?: number;
    note?: string;
    /** Pieces of the model the customer wants made (design requests; older ones mean 1). */
    quantity?: number;
    furniture?: { instanceId: string; modelId: string; title: string; dimensions: { width: number; height: number; depth: number } }[];
    /** A request for one customised model (its frozen version). */
    design?: DesignSpec;
    audience?: "open" | "vendor_exclusive";
    vendor?: { id: string; name: string } | null;
  };
  design_id?: string | null;
  design_version_id?: string | null;
  /** "vendor_exclusive": only the original vendor of the model sees it and bids; "open": every approved vendor. */
  audience?: "open" | "vendor_exclusive";
  exclusive_vendor_id?: string | null;
  deadline?: string | null;
  awarded_bid_id: string | null;
  created_at: string;
}

export interface BidRow {
  id: string;
  task_id: string;
  vendor_id: string;
  price: number;
  days: number;
  note: string;
  status: BidStatus;
  created_at: string;
}

export async function publishTask(input: {
  planId: string;
  title: string;
  description: string;
  location: string;
  spec: TaskRow["spec"];
}) {
  const { data, error } = await supabase()
    .from("freelance_tasks")
    .insert({ plan_id: input.planId, title: input.title, description: input.description, location: input.location, spec: input.spec, scope: "apartment", service: "complete" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function myTasks() {
  const { data, error } = await supabase().from("freelance_tasks").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskRow[];
}

export async function openTasks() {
  const { data, error } = await supabase().from("freelance_tasks").select("*").eq("status", "published").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskRow[];
}

export async function loadTask(id: string) {
  const [{ data, error }, bids] = await Promise.all([
    supabase().from("freelance_tasks").select("*").eq("id", id).maybeSingle(),
    supabase().from("task_bids").select("*").eq("task_id", id).order("price"),
  ]);
  if (error) throw new Error(error.message);
  if (bids.error) throw new Error(bids.error.message);
  return { task: data as TaskRow | null, bids: (bids.data ?? []) as BidRow[] };
}

export async function placeBid(taskId: string, vendorId: string, price: number, days: number, note: string) {
  const { error } = await supabase().from("task_bids").insert({ task_id: taskId, vendor_id: vendorId, price, days, note });
  if (error) throw new Error(error.message);
}

export async function acceptBid(bidId: string) {
  const { error } = await supabase().rpc("accept_task_bid", { bid: bidId });
  if (error) throw new Error(error.message);
}

export async function advanceTask(taskId: string, next: "cancelled" | "in_progress" | "completed") {
  const { error } = await supabase().rpc("advance_task", { task: taskId, next });
  if (error) throw new Error(error.message);
}

// ---- requests from customised models, bids, chat, reviews (supabase/marketplace.sql) ----

async function backend<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: init.body ? { "Content-Type": "application/json" } : undefined });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json.detail === "string" ? json.detail : `Request failed (${response.status}).`);
  return json as T;
}

export interface RequestTarget {
  audience: "open" | "vendor_exclusive";
  vendor: { id: string; name: string } | null;
  available: boolean;
}

/** Who a request for this design goes to: its original vendor only, or every vendor (Sha2ty's own models). */
export const requestTarget = (designId: string) => backend<RequestTarget>(`/api/designs/${designId}/request-target`);

/** Ask vendors to make a saved customised model (its current version is frozen into the request). */
export const requestImplementation = (designId: string, body: { description: string; location: string; budget_max: number | null; deadline: string | null; part_ids: string[] | null; quantity?: number }) =>
  backend<TaskRow>(`/api/designs/${designId}/request`, { method: "POST", body: JSON.stringify(body) });

/** A vendor's proposed change to a requested model (supabase/proposals.sql), as a full specification. */
export interface Proposal {
  id: string;
  task_id: string;
  vendor_id: string;
  note: string;
  status: "pending" | "accepted" | "rejected";
  thumbnail_url: string | null;
  created_at: string;
  spec: DesignSpec;
}

/** The requested version a vendor starts editing from. */
export const proposalBase = (taskId: string) =>
  backend<{ item: import("@/lib/designs/schema").ItemDesign; glb_url: string | null; title: string }>(`/api/tasks/${taskId}/proposal-base`);
export const sendProposal = (taskId: string, body: { item: import("@/lib/designs/schema").ItemEdits; glb_url: string | null; thumbnail_url: string | null; note: string; model_url?: string | null }) =>
  backend<Proposal>(`/api/tasks/${taskId}/proposals`, { method: "POST", body: JSON.stringify(body) });
export const listProposals = (taskId: string) => backend<Proposal[]>(`/api/tasks/${taskId}/proposals`);
export const decideProposal = (id: string, accept: boolean) => backend<Proposal>(`/api/proposals/${id}/decision`, { method: "POST", body: JSON.stringify({ accept }) });

/** Revise or withdraw one's own bid (or submit it again after withdrawing) while the task is open. */
export async function reviseBid(bidId: string, patch: { price?: number; days?: number; note?: string; status?: "submitted" | "withdrawn" }) {
  const { error } = await supabase().from("task_bids").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", bidId);
  if (error) throw new Error(error.message);
}

export interface Message {
  id: string;
  task_id: string;
  vendor_id: string;
  sender_id: string;
  body: string;
  attachment_url: string | null;
  created_at: string;
  read_at: string | null;
}

/** Every message of a task the user may see (the customer: all threads; a vendor: their own). */
export async function taskMessages(taskId: string) {
  const { data, error } = await supabase().from("task_messages").select("*").eq("task_id", taskId).order("created_at").limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Message[];
}

export async function sendMessage(taskId: string, vendorId: string, body: string, attachmentUrl: string | null = null) {
  const { data, error } = await supabase().from("task_messages").insert({ task_id: taskId, vendor_id: vendorId, body, attachment_url: attachmentUrl }).select("*").single();
  if (error) throw new Error(error.message);
  return data as Message;
}

export async function markRead(taskId: string, vendorId: string, me: string) {
  await supabase().from("task_messages").update({ read_at: new Date().toISOString() }).eq("task_id", taskId).eq("vendor_id", vendorId).neq("sender_id", me).is("read_at", null);
}

/** New messages of a task as they arrive (Realtime with the user's own token, so row-level security applies).
 * Returns the unsubscribe function. Without a token the chat still works on reload and after sending. */
export function onMessages(taskId: string | null, onMessage: (message: Message) => void): () => void {
  const client = supabase();
  let channel: ReturnType<typeof client.channel> | null = null;
  let closed = false;
  void fetch("/api/auth/realtime", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { token: null }))
    .then(async ({ token }: { token: string | null }) => {
      if (closed || !token) return;
      await client.realtime.setAuth(token);
      // taskId null: every conversation the user is in (the notification bell); RLS decides what arrives.
      channel = client
        .channel(taskId ? `task:${taskId}` : `inbox:${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_messages", ...(taskId ? { filter: `task_id=eq.${taskId}` } : {}) }, (payload) => onMessage(payload.new as Message))
        .subscribe();
    })
    .catch(() => undefined);
  return () => {
    closed = true;
    if (channel) void client.removeChannel(channel);
  };
}

export interface VendorProfileData {
  vendor: { id: string; name: string; location: string; logo_url: string | null; created_at: string };
  stats: { completed_projects: number; active_projects: number; bids: number; rating: number | null; reviews: number };
  listings: { id: string; title: string; glb_url: string | null; width_m: number | null; height_m: number | null; depth_m: number | null; price: number | null; price_unit?: string; source_image_url: string | null; thumbnail_url?: string | null }[];
  projects: { id: string; title: string; status: TaskStatus; created_at: string; thumbnail_url: string | null; days: number | null }[];
  reviews: { id: string; task_id: string; rating: number; comment: string; created_at: string }[];
}

/** Public name and logo of approved vendors, by id; `platform`: Sha2ty's own studio (the admins'). */
export const vendorBrands = (ids: string[]) =>
  ids.length ? backend<{ id: string; name: string; logo_url: string | null; platform?: boolean }[]>(`/api/vendors/brands?ids=${ids.map(encodeURIComponent).join(",")}`) : Promise.resolve([]);
export const vendorProfile = (vendorId: string) => backend<VendorProfileData>(`/api/vendors/${vendorId}/profile`);

export async function myReview(taskId: string) {
  const { data } = await supabase().from("vendor_reviews").select("rating, comment").eq("task_id", taskId).maybeSingle();
  return data as { rating: number; comment: string } | null;
}

export async function reviewVendor(taskId: string, vendorId: string, rating: number, comment: string) {
  const { error } = await supabase().from("vendor_reviews").insert({ task_id: taskId, vendor_id: vendorId, rating, comment });
  if (error) throw new Error(error.message);
}

export type Unread = Message & { task: { title: string; customer_id: string } | null };

/** Messages to the user not read yet, newest first (their own conversations only: row-level security). */
export async function unreadMessages(me: string) {
  const { data, error } = await supabase()
    .from("task_messages")
    .select("*, task:freelance_tasks(title, customer_id)")
    .is("read_at", null)
    .neq("sender_id", me)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as Unread[];
}
