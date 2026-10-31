"use client";

import { authSession } from "@/lib/auth/client";
import { useT } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppWindow, Armchair, DoorOpen, ChevronUp, Download, Footprints, LayoutGrid, FolderOpen, LoaderCircle, PaintRoller, RectangleHorizontal, TriangleAlert, X } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { API, PlanValidationError, createRoomFromDimensions, createRoomFromImage, exportRoomGlb, listPlans, loadPlan, rebuildFromGeometry, savePlan } from "@/lib/plan/api";
import { downloadBlob } from "@/lib/plan/exportPlan";
import type { CameraView } from "@/lib/plan/coordinateSystem";
import { clampTilt, localWarnings, nearestValidSpot, normalizeYaw, restOnSurfaces } from "@/lib/plan/placementValidation";
import { baseHeight, mountFor } from "@/lib/plan/categories";
import { clearPendingPlan, stashPlan, takePendingPlan } from "@/lib/plan/pendingPlan";
import type { CatalogModel, PlanGeometry, PlacedItem, PlacedDoor, PlacedRug, PlacedWindow, WallPaint } from "@/lib/plan/types";
import type { VendorProfile } from "@/lib/vendor/types";
import { FloorPlanViewer, rotationKey } from "./FloorPlanViewer";
import { ModelSidebar } from "./ModelSidebar";
import { ModelDetails } from "./ModelDetails";
import { PlanEstimate } from "./PlanEstimate";
import { CarpetPicker, PaintPicker, WindowPicker, brushFor, type Brush } from "./PaintPicker";
import { FinishDetails, type Finish } from "./FinishDetails";
import { finishUsage } from "@/lib/plan/pricing";
import type { Carpet, DoorItem, WindowItem } from "@/lib/vendor/types";
import { PlacementWarnings } from "./PlacementWarnings";
import { PlanActions, ViewportToolbar } from "./PlanToolbar";
import { RoomCreationDialog } from "./RoomCreationDialog";
import { PlanCorrection } from "./PlanCorrection";
import { DebugImages } from "./DebugImages";
import { catalogDimensions, type Dimensions } from "@/lib/plan/modelNormalization";

const LAST_PLAN = "shatably.lastPlan";

/** Remember the open plan (URL ?plan= and this browser) so coming back reopens it. */
function rememberPlan(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_PLAN, id);
    else localStorage.removeItem(LAST_PLAN);
  } catch {
    // storage blocked: the ?plan= link still works
  }
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("plan", id);
  else url.searchParams.delete("plan");
  window.history.replaceState(null, "", url);
}

/** Same library finish (by id; older snapshots without one compare by look). */
function samePaint(a: WallPaint, b: WallPaint) {
  if (a.paint_id || b.paint_id) return a.paint_id === b.paint_id;
  return a.name === b.name && a.color === b.color && a.texture_url === b.texture_url;
}

/** What a save stores. Detection debug images are diagnostics only: they are not persisted. */
function planGeometry(geometry: PlanGeometry): PlanGeometry {
  const { debug_images: _debug, ...rest } = geometry;
  return rest;
}

type Snapshot = { items: PlacedItem[]; geometry: PlanGeometry | null };
const HISTORY_MERGE_MS = 450;

export function PlanLayout() {
  const t = useT();
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [geometry, setGeometry] = useState<PlanGeometry | null>(null);
  const [items, setItems] = useState<PlacedItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<CameraView>("2d");
  const [showGrid, setShowGrid] = useState(true);
  // Undo / redo cover the whole design: furniture and the geometry (paints, carpets, windows…).
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState("Untitled plan");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowInvalid, setAllowInvalid] = useState(false);
  const [draft, setDraft] = useState<PlanGeometry | null>(null);
  const [scaleNote, setScaleNote] = useState(false); // the upload's scale was estimated, not printed
  const [unreadable, setUnreadable] = useState<PlanGeometry | null>(null); // upload that failed validation
  const [showRoomSizes, setShowRoomSizes] = useState(false);
  const [showRoomNames, setShowRoomNames] = useState(false);
  const [hideWalls, setHideWalls] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [buildErrors, setBuildErrors] = useState<string[]>([]);
  const [placing, setPlacing] = useState<CatalogModel | null>(null);
  // Catalogue item whose details card is open; "Show in my apartment" starts placing it.
  const [detail, setDetail] = useState<CatalogModel | null>(null);
  // Paint / floor finish / carpet whose details are open; "Apply to apartment" starts using it.
  const [finish, setFinish] = useState<Finish | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [tab, setTab] = useState<"models" | "paints" | "carpets" | "windows" | "doors">("models");
  // Window being placed on a wall (new, or a placed one picked up: `restore` puts it back on Esc).
  const [windowDraft, setWindowDraft] = useState<{ win: Omit<PlacedWindow, "wall_id" | "side" | "along" | "y">; restore?: PlacedWindow } | null>(null);
  // Door being fitted: the next click on a doorway that fits puts it there (picked-up doors keep `restore`).
  const [doorDraft, setDoorDraft] = useState<{ door: Omit<PlacedDoor, "opening_id">; restore?: PlacedDoor } | null>(null);
  const [brush, setBrush] = useState<Brush | null>(null);
  // Carpet being laid (new from the sidebar, or a placed one picked up: `restore` puts it back on Esc).
  const [rugDraft, setRugDraft] = useState<{ rug: Omit<PlacedRug, "x" | "z">; restore?: PlacedRug } | null>(null);
  const [dimensionLines, setDimensionLines] = useState(false);
  // Dismissing hides the current set of warnings; a new or changed warning shows the toast again.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "failed" | null>(null);
  const [opening, setOpening] = useState(false);
  // Saving is explicit (Save → name dialog). savedSnapshot is what was last stored, so the header
  // can show "Unsaved changes"; saveChain keeps saves in order so a new plan's id is reused.
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  // Set while a guest is sent to log in with their design stashed: no "leave page?" prompt then.
  const leavingToSave = useRef(false);
  // Walk: pick the room to start in first, then the camera flies into it.
  // Room picking before a walk: the view we came from, to return to on cancel (null = not picking).
  const [walkPicker, setWalkPicker] = useState<CameraView | null>(null);
  const [walkRoomId, setWalkRoomId] = useState<string | null>(null);
  // Phones: the catalogue drawer; picking anything closes it so the plan is visible again.
  const [catalogOpen, setCatalogOpen] = useState(false);
  // Ruler: null = off, else the 0–2 models picked; a third pick starts a new measurement.
  const [measureIds, setMeasureIds] = useState<string[] | null>(null);
  // Pan tool: on = cancel the current action and let start-drag pan the view.
  const [panning, setPanning] = useState(false);
  const planIdRef = useRef<string | null>(null);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  const openPlan = useCallback(async (id: string) => {
    setOpening(true);
    setError(null);
    try {
      const plan = await loadPlan(id);
      setSavedSnapshot(JSON.stringify([plan.name, plan.geometry, plan.items]));
      planIdRef.current = plan.id;
      setPlanId(plan.id);
      setPlanName(plan.name);
      // eslint-disable-next-line react-hooks/immutability -- a ref flag read by the history effect, never rendered
      quiet.current = true; // opening a plan is a fresh start, not an undo step
      setGeometry(plan.geometry);
      setItems(plan.items ?? []);
      setHistory([]);
      setFuture([]);
      setDraft(null);
      setSaveStatus("saved");
      rememberPlan(plan.id);
    } catch (caught) {
      rememberPlan(null); // deleted or not ours: start fresh instead of retrying every visit
      setError(caught instanceof Error ? t("Could not reopen your last plan: {error}", { error: caught.message }) : t("Could not reopen your last plan."));
    } finally {
      setOpening(false);
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void authSession()
      .then(async ({ data }) => {
        // Guests can design; only saving needs an account.
        setSignedIn(Boolean(data.session));
        if (!data.session) return;
        const profile = await supabase().from("vendors").select("*").eq("id", data.session.user.id).maybeSingle();
        setVendor(profile.data);
        // Back from logging in to save a guest design: restore it and ask for its name.
        const pending = takePendingPlan();
        if (pending) {
          setGeometry(pending.geometry);
          setItems(pending.items);
          setPlanName(pending.name);
          setPlanId(null);
          planIdRef.current = null;
          setSavedSnapshot(null);
          setView("2d");
          setSaveOpen(true);
          return;
        }
        // Coming back: reopen the plan in the link, else the one last worked on in this browser.
        let last: string | null = null;
        try {
          last = localStorage.getItem(LAST_PLAN);
        } catch {
          last = null;
        }
        const id = new URLSearchParams(window.location.search).get("plan") ?? last;
        if (id) void openPlan(id);
      });
  }, [openPlan]);

  // History is recorded automatically from every change (see the effect below), so this just sets.
  const pushHistory = (next: PlacedItem[]) => setItems(next);

  // Automatic history: each change pushes the state before it. A burst of changes (a drag, R taps)
  // within HISTORY_MERGE_MS is one step. Undo/redo, opening a plan and size refreshes are not steps.
  const lastSnap = useRef<Snapshot | null>(null);
  const lastChangeAt = useRef(0);
  const quiet = useRef(false); // set before a change that must not be recorded
  useEffect(() => {
    const now: Snapshot = { items, geometry };
    const prev = lastSnap.current;
    lastSnap.current = now;
    if (quiet.current || !prev || !prev.geometry || !geometry) {
      // eslint-disable-next-line react-hooks/immutability -- a ref flag read by the history effect, never rendered
      quiet.current = false;
      return;
    }
    const t = Date.now();
    const newStep = t - lastChangeAt.current > HISTORY_MERGE_MS;
    lastChangeAt.current = t;
    if (!newStep) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory((h) => [...h.slice(-60), prev]);
    setFuture([]);
  }, [items, geometry]);

  const restore = (snap: Snapshot) => {
    // eslint-disable-next-line react-hooks/immutability -- a ref flag read by the history effect, never rendered
    quiet.current = true;
    setItems(snap.items);
    setGeometry(snap.geometry);
  };
  const undo = () => {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [{ items, geometry }, ...f]);
    restore(prev);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, { items, geometry }]);
    restore(next);
  };

  // ⌘/Ctrl+Z undo, ⌘/Ctrl+Shift+Z or Ctrl+Y redo (not while typing in a field).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // No properties panel: Delete / Backspace removes the selected item.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      setItems(items.filter((item) => item.instanceId !== selectedId));
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selectedId]);

  // Only placement problems that could not be fixed automatically reach the user. Detection notes
  // (printed vs measured room sizes) belong to the correction step and catalogue/GLB proportion
  // notes describe the vendor's data, not the plan: neither is shown here.
  const allWarnings = useMemo(() => items.flatMap((item) => item.warnings), [items]);

  // Every furniture change passes through here: TVs re-seat on the table under them, then warnings refresh.
  const applyWarnings = useCallback((input: PlacedItem[], geom: PlanGeometry | null) => {
    const list = restOnSurfaces(input);
    return list.map((item) => ({ ...item, warnings: geom ? localWarnings(item, geom, list) : item.warnings }));
  }, []);

  /** Fix placements instead of reporting them: each listed item that doesn't fit moves to the nearest spot that does. */
  const settle = useCallback(
    (list: PlacedItem[], geom: PlanGeometry | null, ids: string[]) => {
      if (!geom) return list;
      let next = list;
      for (const id of ids) {
        const item = next.find((i) => i.instanceId === id);
        if (!item) continue;
        const spot = nearestValidSpot(item, geom, next);
        if (spot && (spot.x !== item.x || spot.z !== item.z)) next = next.map((i) => (i.instanceId === id ? { ...i, ...spot } : i));
      }
      return applyWarnings(next, geom);
    },
    [applyWarnings],
  );

  const startPlacing = (model: CatalogModel) => {
    // The catalogue size bounds the physical size. Never invent one: without it a model cannot be placed.
    if (!catalogDimensions(model)) {
      setError(t("{name} has no width/height/depth in the catalogue. Add its dimensions before placing it.", { name: model.title }));
      return;
    }
    setError(null);
    setSelectedId(null);
    setBrush(null);
    setRugDraft(null);
    setFinish(null); // the model's own details stay open while it follows the mouse
    setPlacing(model); // clicking another model just switches the preview
  };

  const placeModel = (model: CatalogModel, x: number, z: number, rotationY: number, size: Dimensions, rotationX = 0) => {
    if (!geometry) return;
    const dims = catalogDimensions(model);
    if (!dims) return;
    const { width, height, depth } = dims;
    const next: PlacedItem = {
      instanceId: crypto.randomUUID(),
      modelId: model.id,
      title: model.title,
      company: model.company,
      glbUrl: model.glb_url,
      width_m: width,
      height_m: height,
      depth_m: depth,
      size,
      category: model.category ?? "furniture",
      mount: mountFor(model.category),
      // L-shaped corner unit: width × depth is its bounding box (wall A × wall B), arm_m each arm's depth.
      shape: model.shape ?? "straight",
      arm_m: model.shape && model.shape !== "straight" && model.depth_m ? Number(model.depth_m) : undefined,
      price: model.price ?? null,
      price_unit: model.price_unit ?? "item",
      x,
      y: baseHeight(mountFor(model.category), geometry.height, size.height),
      z,
      rotation_y: rotationY,
      rotation_x: rotationX,
      warnings: [],
    };
    pushHistory(applyWarnings([...items, next], geometry));
    setSelectedId(next.instanceId);
    setPlacing(null); // back to normal selection
  };

  const applyPaint = (field: "wall_paints" | "floor_paints", key: string) => {
    if (!brush) return;
    setGeometry((g) => {
      if (!g) return g;
      const next = { ...g[field] };
      const current = next[key];
      // Floors toggle: clicking a floor that already has this finish takes it off again.
      const same = field === "floor_paints" && current && brush.paint && samePaint(current, brush.paint);
      if (brush.paint && !same) next[key] = brush.paint;
      else delete next[key];
      return { ...g, [field]: next };
    });
  };

  const cancelWindow = () => {
    const restore = windowDraft?.restore;
    if (restore) setGeometry((g) => (g ? { ...g, placed_windows: [...(g.placed_windows ?? []), restore] } : g));
    setWindowDraft(null);
  };

  const cancelDoor = () => {
    const restore = doorDraft?.restore;
    if (restore) setGeometry((g) => (g ? { ...g, placed_doors: [...(g.placed_doors ?? []), restore] } : g));
    setDoorDraft(null);
  };

  const startDoor = (door: DoorItem) => {
    cancelDoor();
    cancelWindow();
    cancelRug();
    setPlacing(null);
    setBrush(null);
    setDoorDraft({
      door: { id: crypto.randomUUID(), doorId: door.id, name: door.name, image_url: door.image_url, width: Number(door.width_m), height: Number(door.height_m), price: door.price == null ? null : Number(door.price), price_unit: door.price_unit ?? "item" },
    });
  };

  useEffect(() => {
    if (!doorDraft) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "Escape") cancelDoor();
      if (doorDraft.restore && (event.key === "Delete" || event.key === "Backspace")) setDoorDraft(null); // picked-up door: delete it
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doorDraft]);

  useEffect(() => {
    // Something was picked from the catalogue (or a placement started): show the plan on phones.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (detail || finish || placing) setCatalogOpen(false);
  }, [detail, finish, placing]);

  useEffect(() => {
    if (!measureIds) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMeasureIds(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [measureIds]);

  // Switching catalogue type drops whatever was being applied or placed.
  const chooseTab = (t: typeof tab) => {
    setTab(t);
    setBrush(null);
    setPlacing(null);
    cancelRug();
    cancelWindow();
    cancelDoor();
  };

  // Start placing a window: the next click on a wall face puts it there (from the details panel).
  const startWindow = (win: WindowItem) => {
    cancelWindow();
    cancelRug();
    setPlacing(null);
    setBrush(null);
    setWindowDraft({
      win: {
        id: crypto.randomUUID(),
        windowId: win.id,
        name: win.name,
        image_url: win.image_url,
        width: Number(win.width_m),
        height: Number(win.height_m),
        price: win.price == null ? null : Number(win.price),
        price_unit: win.price_unit ?? "item",
      },
    });
  };

  useEffect(() => {
    if (!windowDraft) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "Escape") cancelWindow();
      if (windowDraft.restore && (event.key === "Delete" || event.key === "Backspace")) setWindowDraft(null); // picked-up window: delete it
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // cancelWindow only reads windowDraft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDraft]);

  // Start laying a carpet: it follows the cursor until a floor click lays it (from the details panel).
  const startRug = (carpet: Carpet) => {
    cancelRug();
    setPlacing(null);
    setBrush(null);
    setRugDraft({
      rug: {
        id: crypto.randomUUID(),
        carpetId: carpet.id,
        name: carpet.name,
        image_url: carpet.image_url,
        width: Number(carpet.width_m),
        length: Number(carpet.length_m),
        rotation: 0,
        price: carpet.price == null ? null : Number(carpet.price),
        price_unit: carpet.price_unit ?? "item",
      },
    });
  };

  const setRugs = (update: (rugs: PlacedRug[]) => PlacedRug[]) => setGeometry((g) => (g ? { ...g, rugs: update(g.rugs ?? []) } : g));

  const cancelRug = () => {
    const restore = rugDraft?.restore;
    if (restore) setRugs((rugs) => [...rugs, restore]);
    setRugDraft(null);
  };

  useEffect(() => {
    if (!brush && !rugDraft) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "Escape") {
        setBrush(null);
        cancelRug();
      }
      const turn = rugDraft ? rotationKey(event) : null;
      if (rugDraft && turn) {
        const rug = rugDraft.rug;
        setRugDraft({
          ...rugDraft,
          rug: turn.axis === "y" ? { ...rug, rotation: normalizeYaw(rug.rotation + turn.step) } : { ...rug, tilt: clampTilt((rug.tilt ?? 0) + turn.step) },
        });
      }
      if (rugDraft?.restore && (event.key === "Delete" || event.key === "Backspace")) setRugDraft(null); // picked-up carpet: delete it
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // cancelRug only reads rugDraft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brush, rugDraft]);

  const togglePan = () => {
    if (panning) {
      setPanning(false);
      return;
    }
    setPlacing(null); // stop placing / painting / laying / measuring; a carried model goes back (viewer)
    setBrush(null);
    cancelRug();
    cancelWindow();
    setMeasureIds(null);
    setSelectedId(null);
    setPanning(true);
  };

  // Starting any action leaves the pan tool.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (placing || brush || rugDraft || windowDraft || doorDraft || measureIds) setPanning(false);
  }, [placing, brush, rugDraft, windowDraft, doorDraft, measureIds]);

  // H toggles the pan tool (not while typing; not while walking).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "h" || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (view === "walk" || !geometry) return;
      togglePan();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const snapshot = geometry ? JSON.stringify([planName, planGeometry(geometry), items]) : null;
  const dirty = Boolean(snapshot && snapshot !== savedSnapshot);

  // Saves run one after another, so a new plan's id is used by every later save.
  const store = (name: string, allow: boolean) => {
    if (!geometry) return Promise.resolve();
    const body = { name, source: geometry.source, geometry: planGeometry(geometry), items, warnings: allWarnings, allow_invalid: allow };
    const stored = JSON.stringify([body.name, body.geometry, body.items]);
    const run = saveChain.current.then(async () => {
      const saved = await savePlan(body, planIdRef.current ?? undefined);
      planIdRef.current = saved.id;
      setSavedSnapshot(stored);
      setPlanId(saved.id);
      rememberPlan(saved.id);
    });
    saveChain.current = run.catch(() => undefined);
    return run;
  };

  /** From the Save dialog: store under the chosen name. Returns an error message, or null on success. */
  const save = async (name: string, allow: boolean): Promise<string | null> => {
    if (!geometry) return t("Nothing to save yet.");
    setSaveStatus("saving");
    setError(null);
    setPlanName(name);
    try {
      await store(name, allow);
      clearPendingPlan();
      setSaveStatus("saved");
      return null;
    } catch (caught) {
      setSaveStatus("failed");
      return caught instanceof Error ? caught.message : String(caught);
    }
  };

  // Leaving with unsaved work: let the browser ask first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!leavingToSave.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const exportGlb = async () => {
    setBusy(t("Exporting…"));
    try {
      if (planId) {
        const blob = await exportRoomGlb(planId);
        downloadBlob(blob, `${planName}-room.glb`);
      }
      // Room GLB from the API is dimensionally accurate. Furnished export is the in-browser scene when available.
      setBusy(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(null);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-slate-100">
      <Header
        vendor={vendor}
        actions={
          geometry ? (
            <PlanActions
              planName={planName}
              onPlanName={setPlanName}
              busy={busy}
              saveStatus={saveStatus === "saving" || saveStatus === "failed" ? saveStatus : dirty ? "dirty" : saveStatus}
              onSave={() => {
                if (signedIn) {
                  // The name is asked once, on the first save; later saves just save (rename in the title).
                  if (!planId) {
                    setSaveOpen(true);
                    return;
                  }
                  void save(planName.trim() || t("Untitled plan"), allowInvalid).then((problem) => {
                    if (problem) {
                      setError(problem);
                      setSaveOpen(true); // e.g. issues need "Save anyway": the dialog offers it
                    }
                  });
                  return;
                }
                // Guest: keep the design, log in, come back here and finish the save.
                if (!geometry || !stashPlan({ name: planName, geometry, items })) {
                  setError(t("This design is too large to keep while you log in. Log in first, then build it again."));
                  return;
                }
                leavingToSave.current = true;
                window.location.href = `/vendor/login?next=${encodeURIComponent("/plan?resume=1")}`;
              }}
              onExport={() => void exportGlb()}
              onNew={() => {
                setGeometry(null);
                setDraft(null);
                setItems([]);
                setPlanId(null);
                setPlanName("Untitled plan");
                planIdRef.current = null;
                setSavedSnapshot(null);
                setSaveStatus(null);
                rememberPlan(null);
              }}
            />
          ) : undefined
        }
      />
      {saveOpen && geometry && (
        <SavePlanDialog
          initialName={planName === "Untitled plan" && !planId ? "" : planName}
          existing={Boolean(planId)}
          warnings={allWarnings}
          allowInvalid={allowInvalid}
          onAllowInvalid={setAllowInvalid}
          onClose={() => setSaveOpen(false)}
          onSave={save}
        />
      )}
      {draft && !geometry ? (
        // Fits the window: the editor's footer (Generate 3D) must never fall below the fold.
        <main className="flex min-h-0 flex-1 flex-col items-center overflow-auto px-4 py-4">
          {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
          <PlanCorrection
            geometry={draft}
            busy={busy}
            errors={buildErrors}
            onCancel={() => setDraft(null)}
            onConfirm={async (state) => {
              setBusy(t("Building 3D…"));
              setBuildErrors([]);
              try {
                const rebuilt = await rebuildFromGeometry(state, draft.height ?? 2.7);
                setGeometry({ ...rebuilt, preview_image: draft.preview_image, debug_images: draft.debug_images });
                setView("2d"); // a freshly converted plan opens in 2D
                setDraft(null);
                setBusy(null);
              } catch (caught) {
                // The backend refuses invalid geometry instead of inventing a fallback box: show why.
                if (caught instanceof PlanValidationError) setBuildErrors(caught.errors);
                else setError(caught instanceof Error ? caught.message : String(caught));
                setBusy(null);
              }
            }}
          />
        </main>
      ) : !geometry ? (
        <main className="min-h-0 flex-1 overflow-auto bg-[#f7f6f3]">
          {(error || opening) && (
            <div className="mx-auto w-full max-w-[1400px] px-4 pt-6 sm:px-6">
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <p>{error}</p>
                  {unreadable && (
                    <button type="button" className="mt-2 font-semibold underline underline-offset-2" onClick={() => { setDraft(unreadable); setUnreadable(null); setError(null); }}>
                      {t("Open it in the wall editor anyway")}
                    </button>
                  )}
                </div>
              )}
              {opening && (
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden /> {t("Reopening your plan…")}
                </p>
              )}
            </div>
          )}
          <RoomCreationDialog
            busy={busy}
            onDimensions={async (width, depth, height, thickness) => {
              setBusy(t("Creating room…"));
              try {
                const room = await createRoomFromDimensions({ width, depth, height, wall_thickness: thickness });
                setGeometry(room);
                setView("2d"); // a freshly converted plan opens in 2D
                setBusy(null);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught));
                setBusy(null);
              }
            }}
            onImage={async (file, height) => {
              setBusy(t("Analyzing · {p}%", { p: 0 }));
              setError(null);
              setUnreadable(null);
              try {
                const room = await createRoomFromImage(file, height, ({ stage, percent }) => setBusy(`${t(stage)} · ${percent}%`));
                // Fully automatic: a readable plan opens in 3D straight away. One that fails validation is
                // reported (never shown as a finished apartment); the wall editor is offered, not required.
                if (room.validation?.ok) {
                  setGeometry(room);
                  setView("iso"); // the finished apartment, elevated and framed whole, looking into the rooms
                  setScaleNote(Boolean(room.scale?.estimated));
                } else {
                  setUnreadable(room);
                  const offline = room.warnings.find((w) => w.startsWith("The vision model was unavailable"));
                  setError(
                    [offline && t(offline), t("This floor plan could not be read reliably: {errors}", { errors: (room.validation?.errors ?? []).join(" ") })].filter(Boolean).join(" "),
                  );
                }
                setBusy(null);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught));
                setBusy(null);
              }
            }}
          />
          {signedIn && !opening && (
            <div className="mx-auto w-full max-w-[1400px] px-4 pb-10 sm:px-6">
              <SavedPlans onOpen={(id) => void openPlan(id)} />
            </div>
          )}
        </main>
      ) : (
        <div className="relative flex min-h-0 flex-1">
          {/* Phones: the catalogue is a slide-in drawer over the plan (open with the Catalogue button). */}
          {catalogOpen && <div className="fixed inset-0 z-30 bg-slate-900/30 md:hidden" onClick={() => setCatalogOpen(false)} aria-hidden />}
          <div
            className={`relative flex w-72 shrink-0 flex-col border-e border-slate-200 bg-white max-md:fixed max-md:inset-y-0 max-md:start-0 max-md:z-40 max-md:w-[min(20rem,88vw)] max-md:shadow-2xl max-md:transition-transform max-md:duration-200 ${
              catalogOpen ? "" : "max-md:-translate-x-full rtl:max-md:translate-x-full"
            }`}
          >
            {view === "walk" && (
              // Walking is look-only: nothing can be picked from the catalogue or the plan until you leave it.
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/85 p-6 text-center backdrop-blur-[2px]">
                <Footprints className="size-6 text-brand-amber" aria-hidden />
                <p className="text-sm font-semibold text-brand-navy">{t("You're walking through the plan")}</p>
                <p className="text-xs text-slate-500">{t("Models can't be selected while walking. Switch to another view to add or move items.")}</p>
                <button type="button" onClick={() => setView("perspective")} className="rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy-hover">
                  {t("Leave walk mode")}
                </button>
              </div>
            )}
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 md:hidden">
              <span className="text-sm font-semibold text-brand-navy">{t("Catalogue")}</span>
              <button
                type="button"
                aria-label={t("Close catalogue")}
                onClick={() => setCatalogOpen(false)}
                className="flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-brand-navy"
              >
                <X className="size-5" />
              </button>
            </div>
            {/* Catalogue type: a radio group (2 × 2) so all four always fit; arrow keys move between them. */}
            <div
              role="radiogroup"
              aria-label={t("Catalogue")}
              className="m-3 mb-0 grid shrink-0 grid-cols-2 gap-1.5"
              onKeyDown={(event) => {
                const order = ["models", "paints", "carpets", "windows", "doors"] as const;
                const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const next = order[(order.indexOf(tab) + step + order.length) % order.length];
                chooseTab(next);
                (event.currentTarget.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
              }}
            >
              {(
                [
                  ["models", "Furniture", Armchair],
                  ["paints", "Paint", PaintRoller],
                  ["carpets", "Carpets", RectangleHorizontal],
                  ["windows", "Windows", AppWindow],
                  ["doors", "Doors", DoorOpen],
                ] as const
              ).map(([id, label, Icon]) => {
                const on = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-tab={id}
                    tabIndex={on ? 0 : -1}
                    onClick={() => chooseTab(id)}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-start text-[13px] font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-amber/40 ${
                      on ? "border-brand-amber/60 bg-brand-amber-soft/60 text-brand-navy shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${on ? "border-brand-amber bg-brand-amber" : "border-slate-300 bg-white"}`} aria-hidden>
                      {on && <span className="size-1.5 rounded-full bg-white" />}
                    </span>
                    <Icon className={`size-4 shrink-0 ${on ? "text-brand-amber" : "text-slate-400"}`} aria-hidden />
                    <span className="truncate">{t(label)}</span>
                  </button>
                );
              })}
            </div>
            {tab === "models" ? (
              <ModelSidebar
                activeId={placing?.id ?? detail?.id ?? null}
                onPick={(model) => {
                  setPlacing(null);
                  setFinish(null);
                  setDetail(model);
                }}
              />
            ) : tab === "paints" ? (
              <PaintPicker
                active={brush}
                detailId={finish?.kind === "paint" ? finish.paint.id : null}
                onPick={(b) => {
                  setFinish(null);
                  setBrush(b);
                }}
                onDetails={(paint) => {
                  setBrush(null);
                  setDetail(null);
                  setFinish({ kind: "paint", paint });
                }}
              />
            ) : tab === "carpets" ? (
              <CarpetPicker
                activeId={rugDraft?.rug.carpetId ?? (finish?.kind === "carpet" ? finish.carpet.id : null)}
                onPick={(carpet) => {
                  cancelRug();
                  setPlacing(null);
                  setDetail(null);
                  setFinish({ kind: "carpet", carpet });
                }}
              />
            ) : tab === "doors" ? (
              <WindowPicker
                doors
                activeId={doorDraft?.door.doorId ?? null}
                onPick={(door) => {
                  setDetail(null);
                  setFinish(null);
                  startDoor(door);
                }}
              />
            ) : (
              <WindowPicker
                activeId={windowDraft?.win.windowId ?? (finish?.kind === "window" ? finish.window.id : null)}
                onPick={(win) => {
                  cancelWindow();
                  setPlacing(null);
                  setDetail(null);
                  setFinish({ kind: "window", window: win });
                }}
              />
            )}
          </div>
          {/* Workspace: the viewport fills everything; tools and panels float over it. */}
          <main className="relative min-w-0 flex-1 overflow-hidden">
            <div className="absolute inset-0">
              <FloorPlanViewer
                roomSizes={showRoomSizes}
                roomNames={showRoomNames}
                hideWalls={hideWalls}
                selectedRoomId={roomId}
                onSelectRoom={geometry.source === "image" ? setRoomId : undefined}
                geometry={geometry}
                items={items}
                selectedId={selectedId}
                view={view}
                showGrid={showGrid}
                onSelect={setSelectedId}
                placing={placing}
                onPlace={placeModel}
                onCancelPlacing={() => setPlacing(null)}
                paintSurface={brush?.surface ?? null}
                onPaintWall={(key) => applyPaint("wall_paints", key)}
                onPaintFloor={(id) => applyPaint("floor_paints", id)}
                rugDraft={rugDraft?.rug ?? null}
                doorDraft={doorDraft?.door ?? null}
                onPlaceDoor={(placed) => {
                  setGeometry((g) => (g ? { ...g, placed_doors: [...(g.placed_doors ?? []).filter((d) => d.opening_id !== placed.opening_id), placed] } : g));
                  setDoorDraft(null);
                }}
                onPickDoor={(placed) => {
                  if (brush || placing || rugDraft || windowDraft || doorDraft) return;
                  setGeometry((g) => (g ? { ...g, placed_doors: (g.placed_doors ?? []).filter((d) => d.id !== placed.id) } : g));
                  const { opening_id: _o, ...door } = placed;
                  setDoorDraft({ door, restore: placed });
                }}
                windowDraft={windowDraft?.win ?? null}
                onPlaceWindow={(placed) => {
                  setGeometry((g) => (g ? { ...g, placed_windows: [...(g.placed_windows ?? []), placed] } : g));
                  setWindowDraft(null);
                }}
                onPickWindow={(placed) => {
                  if (brush || placing || rugDraft || windowDraft) return;
                  setGeometry((g) => (g ? { ...g, placed_windows: (g.placed_windows ?? []).filter((w) => w.id !== placed.id) } : g));
                  const { wall_id: _w, side: _s, along: _a, y: _y, ...win } = placed;
                  setWindowDraft({ win, restore: placed });
                }}
                onPlaceRug={(x, z) => {
                  if (!rugDraft) return;
                  setRugs((rugs) => [...rugs, { ...rugDraft.rug, x, z }]);
                  setRugDraft(null);
                }}
                onPickRug={(rug) => {
                  if (brush || placing || rugDraft) return;
                  setRugs((rugs) => rugs.filter((r) => r.id !== rug.id));
                  const { x: _x, z: _z, ...rest } = rug;
                  setRugDraft({ rug: rest, restore: rug });
                }}
                dimensionLines={dimensionLines}
                walkRoomId={walkRoomId}
                measureIds={view === "walk" ? null : measureIds}
                panning={panning && view !== "walk"}
                onMeasurePick={(id) => setMeasureIds((m) => (!m ? m : m.length >= 2 ? [id] : m[0] === id ? m : [...m, id]))}
                onPickRoom={
                  walkPicker
                    ? (id) => {
                        setWalkRoomId(id);
                        setWalkPicker(null);
                        setView("walk");
                      }
                    : undefined
                }
                onRotate={(id, rotation) => {
                  if (!geometry) return;
                  setItems((list) => applyWarnings(list.map((item) => (item.instanceId === id ? { ...item, ...rotation } : item)), geometry));
                }}
                onMove={(id, x, z) => {
                  if (!geometry) return;
                  setItems((list) => applyWarnings(list.map((item) => (item.instanceId === id ? { ...item, x, z } : item)), geometry));
                }}
                onItemNormalized={(id, report) => {
                  // Rendered size (proportions kept) drives collisions; refresh it for loaded plans too, and
                  // re-fit the item if its real size no longer fits where it stands.
                  if (report.warnings.length && process.env.NODE_ENV !== "production") console.debug("[catalogue size]", id, report.warnings);
                  // eslint-disable-next-line react-hooks/immutability -- a ref flag read by the history effect, never rendered
                  quiet.current = true; // a loaded model reporting its real size is not an undo step
                  setItems((list) =>
                    settle(
                      list.map((item) =>
                        item.instanceId === id ? { ...item, size: report.finalSize, y: baseHeight(item.mount, geometry.height, report.finalSize.height) } : item,
                      ),
                      geometry,
                      [id],
                    ),
                  );
                }}
                onDrop={(id) => setItems((list) => settle(list, geometry, [id]))}
              />
            </div>

            <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-col items-center gap-2 px-3 max-md:top-16">
              <ViewportToolbar
                view={view}
                showGrid={showGrid}
                showDebug={showDebug}
                dimensions={dimensionLines}
                onToggleDimensions={() => setDimensionLines((v) => !v)}
                measuring={measureIds !== null}
                panning={panning}
                onTogglePan={view === "walk" ? undefined : togglePan}
                onToggleMeasure={
                  view === "walk"
                    ? undefined
                    : () => {
                        setMeasureIds((m) => (m ? null : []));
                        setPlacing(null);
                        setBrush(null);
                        cancelRug();
                        cancelWindow();
                        setSelectedId(null);
                      }
                }
                canUndo={history.length > 0}
                canRedo={future.length > 0}
                onView={(next) => {
                  if (next === "walk") {
                    setMeasureIds(null);
                    setPanning(false);
                    setDetail(null); // nothing can be selected or placed while walking
                    setFinish(null);
                    // Choose the start room by clicking it on the 2D plan; the walk starts on that click.
                    setSelectedId(null); // walking never keeps a model selected
                    setPlacing(null);
                    setBrush(null);
                    cancelRug();
                    setWalkPicker(view === "walk" ? "2d" : view);
                    setView("2d");
                    return;
                  }
                  setWalkPicker(null);
                  setView(next);
                }}
                onToggleGrid={() => setShowGrid((v) => !v)}
                onToggleDebug={geometry.debug_images ? () => setShowDebug((v) => !v) : undefined}
                onUndo={undo}
                onRedo={redo}
              />
              {error && (
                <p className="pointer-events-auto max-w-xl rounded-lg border border-red-200 bg-red-50/95 px-3 py-2 text-sm text-red-700 shadow-sm backdrop-blur">{error}</p>
              )}
              {geometry.source === "image" && (
                <div className="pointer-events-auto flex items-center gap-2">
                  {(
                    [
                      ["Room names", showRoomNames, setShowRoomNames],
                      ["Room sizes", showRoomSizes, setShowRoomSizes],
                      ["Hide walls", hideWalls, setHideWalls],
                    ] as const
                  ).map(([label, on, set]) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set((v) => !v)}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur transition-colors ${on ? "border-brand-navy bg-brand-navy text-white" : "border-slate-200 bg-white/90 text-slate-700 hover:bg-white"}`}
                    >
                      {t(label)}
                    </button>
                  ))}
                  {(["glb_url", "dxf_url"] as const).map((key) =>
                    geometry[key] ? (
                      <a
                        key={key}
                        href={`${API}${geometry[key]}`}
                        download
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-white"
                      >
                        <Download className="size-3.5" aria-hidden />
                        {key === "glb_url" ? "GLB" : "DXF"}
                      </a>
                    ) : null,
                  )}
                  {geometry.preview_image && (
                    <details className="group relative">
                      <summary className="cursor-pointer list-none rounded-lg border border-slate-200 bg-white/90 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-white">{t("Original plan")}</summary>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the upload */}
                      <img src={geometry.preview_image} alt={t("Original plan")} className="absolute start-0 top-9 z-20 w-80 max-w-[80vw] rounded-lg border border-slate-200 bg-white shadow-lg" />
                    </details>
                  )}
                </div>
              )}
              {(() => {
                const room = roomId ? (geometry.zones?.length ? geometry.zones : geometry.rooms).find((a) => a.id === roomId) : null;
                if (!room) return null;
                const xs = room.polygon.map((p) => p[0]);
                const zs = room.polygon.map((p) => p[1]);
                const w = room.dimensions?.width || Math.max(...xs) - Math.min(...xs);
                const l = room.dimensions?.length || Math.max(...zs) - Math.min(...zs);
                const area = "area_m2" in room && room.area_m2 ? room.area_m2 : w * l;
                const printed = "dimension_source" in room && room.dimension_source === "printed";
                const approx = printed ? "" : "≈ ";
                return (
                  <div className="pointer-events-auto w-56 rounded-lg border border-amber-200 bg-white/95 px-3 py-2 text-sm text-slate-700 shadow-sm backdrop-blur">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-semibold text-brand-navy">{room.name}</span>
                      <button type="button" aria-label={t("Dismiss")} onClick={() => setRoomId(null)} className="text-slate-400 hover:text-slate-700">
                        <X className="size-4" />
                      </button>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-2 tabular-nums">
                      <dt>{t("Width")}</dt>
                      <dd>{approx}{w.toFixed(2)} m</dd>
                      <dt>{t("Length")}</dt>
                      <dd>{approx}{l.toFixed(2)} m</dd>
                      <dt>{t("Area")}</dt>
                      <dd>{approx}{area.toFixed(2)} m²</dd>
                    </dl>
                    <p className="mt-1 text-xs text-slate-500">{t(printed ? "Read from the plan's dimensions" : "Estimated from the drawing's scale")}</p>
                  </div>
                );
              })()}
              {scaleNote && (
                <div role="status" className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-lg border border-sky-200 bg-sky-50/95 px-3 py-2 text-sm text-sky-800 shadow-sm backdrop-blur">
                  <span>{t("Dimensions automatically estimated from your floor plan. Measurements are approximate.")}</span>
                  {geometry.walls_px && items.length === 0 && geometry.geometry_source !== "vision" && (
                    <button
                      type="button"
                      className="shrink-0 font-semibold underline underline-offset-2 hover:text-sky-950"
                      onClick={() => {
                        setDraft(geometry);
                        setGeometry(null);
                        setScaleNote(false);
                      }}
                    >
                      {t("Adjust")}
                    </button>
                  )}
                  <button type="button" aria-label={t("Dismiss")} onClick={() => setScaleNote(false)} className="shrink-0 text-sky-600 hover:text-sky-900">
                    <X className="size-4" />
                  </button>
                </div>
              )}
              {showDebug && geometry.debug_images && (
                <div className="pointer-events-auto max-h-[40%] w-full max-w-4xl overflow-auto rounded-xl border border-white/60 bg-white/80 shadow-lg backdrop-blur-md">
                  <DebugImages images={geometry.debug_images} />
                </div>
              )}
            </div>

            {(() => {
              // Shown only for what auto-fix could not resolve (e.g. a piece wider than any room).
              const key = JSON.stringify(allWarnings);
              const total = allWarnings.length;
              if (!total || dismissed === key || view === "walk") return null; // walk guide owns the bottom
              const label = t(total === 1 ? "{n} item doesn't fit" : "{n} items don't fit", { n: total });
              // Collapsed: a small pill in the corner. Expanded: a drawer that grows upward from it.
              return (
                <div role="status" className="absolute bottom-4 start-4 z-10 w-[min(24rem,calc(100%-2rem))]">
                  <div
                    className={`overflow-hidden rounded-2xl border border-amber-200/70 bg-white/90 shadow-lg shadow-slate-900/10 backdrop-blur-md transition-all duration-200 ${
                      issuesOpen ? "" : "w-fit"
                    }`}
                  >
                    {issuesOpen && (
                      <div className="max-h-56 space-y-2.5 overflow-auto border-b border-slate-100 px-4 pb-3 pt-3.5 text-xs">
                        <PlacementWarnings warnings={allWarnings} />
                        {total > 0 && (
                          <label className="flex items-center gap-2 pt-1 text-slate-500">
                            <input type="checkbox" className="accent-brand-navy" checked={allowInvalid} onChange={(event) => setAllowInvalid(event.target.checked)} />
                            {t("Save anyway and record these warnings")}
                          </label>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1 p-1.5">
                      <button
                        type="button"
                        aria-expanded={issuesOpen}
                        onClick={() => setIssuesOpen((v) => !v)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1 text-start transition-colors hover:bg-amber-50"
                      >
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                          <TriangleAlert className="size-3.5" aria-hidden />
                        </span>
                        <span className="truncate text-sm font-medium text-slate-700">{label}</span>
                        <ChevronUp className={`ms-auto size-4 shrink-0 text-slate-400 transition-transform ${issuesOpen ? "" : "rotate-180"}`} aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={t("Dismiss")}
                        onClick={() => {
                          setDismissed(key);
                          setIssuesOpen(false);
                        }}
                        className="flex size-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            <button
              type="button"
              onClick={() => setCatalogOpen(true)}
              className="absolute start-3 top-3 z-20 inline-flex h-10 items-center gap-2 rounded-full border border-white/70 bg-white/90 px-3.5 text-sm font-semibold text-brand-navy shadow-lg backdrop-blur md:hidden"
            >
              <LayoutGrid className="size-4 text-brand-amber" aria-hidden /> {t("Catalogue")}
            </button>
            {/* Hidden while walking: the walk key guide uses the bottom of the view. */}
            {/* Hidden while a key guide or hint owns the bottom of the view (walking, placing, measuring…). */}
            {view !== "walk" && !measureIds && !placing && !rugDraft && !windowDraft && !doorDraft && !brush && <PlanEstimate geometry={geometry} items={items} />}
            {walkPicker && (
              <WalkRoomBanner
                onCancel={() => {
                  setView(walkPicker);
                  setWalkPicker(null);
                }}
              />
            )}
          </main>
          {/* Docked beside the canvas (never over it): the plan shrinks instead of being covered. */}
          {detail && <ModelDetails key={detail.id} model={detail} onClose={() => setDetail(null)} onShow={() => startPlacing(detail)} />}
          {!detail && finish && (
            <FinishDetails
              key={finish.kind === "paint" ? finish.paint.id : finish.kind === "carpet" ? finish.carpet.id : finish.window.id}
              item={finish}
              usage={finish.kind === "paint" ? finishUsage(geometry, finish.paint.id) : undefined}
              applying={
                finish.kind === "paint"
                  ? brush?.paint?.paint_id === finish.paint.id
                  : finish.kind === "carpet"
                    ? rugDraft?.rug.carpetId === finish.carpet.id
                    : windowDraft?.win.windowId === finish.window.id
              }
              onClose={() => {
                setFinish(null);
                setBrush(null);
                cancelRug();
                cancelWindow();
              }}
              onApply={() => {
                // The panel stays open: its usage table updates as floors and walls are finished.
                if (finish.kind === "paint") setBrush(brushFor(finish.paint));
                else if (finish.kind === "carpet") startRug(finish.carpet);
                else startWindow(finish.window);
              }}
              onStop={() => {
                setBrush(null);
                cancelRug();
                cancelWindow();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** "Your plans" on the start screen: reopen any saved plan. */
function SavedPlans({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useT();
  const [plans, setPlans] = useState<{ id: string; name: string; updated_at: string }[] | null>(null);
  useEffect(() => {
    void listPlans()
      .then((r) => setPlans(r.plans))
      .catch(() => setPlans([]));
  }, []);
  if (!plans?.length) return null;
  return (
    <section className="w-full">
      <h2 className="mb-3 text-sm font-semibold text-brand-navy">{t("Your plans")}</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <li key={plan.id}>
            <button
              type="button"
              onClick={() => onOpen(plan.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-start shadow-sm transition hover:-translate-y-px hover:border-slate-300 hover:shadow-md"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-amber-soft text-brand-navy">
                <FolderOpen className="size-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-brand-navy">{plan.name}</span>
                <span className="text-xs text-slate-500">{t("Edited")} {new Date(plan.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Save asks for the plan's name every time (prefilled), so nothing is stored without the user's say. */
function SavePlanDialog({
  initialName,
  existing,
  warnings,
  allowInvalid,
  onAllowInvalid,
  onClose,
  onSave,
}: {
  initialName: string;
  existing: boolean;
  warnings: string[];
  allowInvalid: boolean;
  onAllowInvalid: (v: boolean) => void;
  onClose: () => void;
  onSave: (name: string, allow: boolean) => Promise<string | null>;
}) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const blocked = warnings.length > 0 && !allowInvalid;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setProblem(t("Give your plan a name."));
      return;
    }
    setBusy(true);
    const failed = await onSave(name.trim(), allowInvalid);
    setBusy(false);
    if (failed) setProblem(failed);
    else onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{existing ? t("Save plan") : t("Save your plan")}</DialogTitle>
            <DialogDescription>{t("Saved plans reopen when you come back, and are listed under Your plans.")}</DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5">
            <span className="text-[13px] font-semibold text-slate-700">{t("Plan name")}</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setProblem(null);
              }}
              placeholder={t("e.g. Zamalek apartment — living room")}
              maxLength={120}
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-amber focus:bg-white focus:ring-4 focus:ring-brand-amber/15"
            />
          </label>
          {warnings.length > 0 && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
              <p className="font-semibold">
                {warnings.length} placement {warnings.length === 1 ? "issue" : "issues"} in this plan
              </p>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-brand-navy" checked={allowInvalid} onChange={(e) => onAllowInvalid(e.target.checked)} />
                {t("Save anyway and record them")}
              </label>
            </div>
          )}
          {problem && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>}
          <DialogFooter>
            <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {t("Cancel")}
            </button>
            <button
              type="submit"
              disabled={busy || blocked}
              title={blocked ? t("Tick “Save anyway” or fix the issues first") : undefined}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-navy px-5 text-sm font-semibold text-white hover:bg-brand-navy-hover disabled:opacity-50"
            >
              {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              {busy ? t("Saving…") : t("Save")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shown while picking the walk's start room on the plan (rooms glow on hover; click one). */
function WalkRoomBanner({ onCancel }: { onCancel: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 z-20 flex justify-center px-3">
      <div role="status" className="pointer-events-auto flex animate-in slide-in-from-top-2 fade-in items-center gap-3 rounded-full bg-brand-navy py-1.5 ps-2 pe-1.5 text-sm text-white shadow-xl duration-200">
        <span className="flex size-7 items-center justify-center rounded-full bg-brand-amber text-brand-navy">
          <Footprints className="size-4" aria-hidden />
        </span>
        <span className="font-medium">{t("Click a room to start walking")}</span>
        <button type="button" onClick={onCancel} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium transition-colors hover:bg-white/20">
          {t("Cancel · Esc")}
        </button>
      </div>
    </div>
  );
}
