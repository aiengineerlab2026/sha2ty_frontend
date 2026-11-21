"use client";

import { assetUrl } from "@/lib/api";
import { tilted } from "@/lib/plan/placementValidation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box3, Color, Group, Mesh, Vector3, type Object3D } from "three";
import { Edges, Html, useGLTF } from "@react-three/drei";
import { alignLike, normalizeModel, type Dimensions, type NormalizationReport } from "@/lib/plan/modelNormalization";
import type { PlacedItem } from "@/lib/plan/types";
import type { PartInfo } from "@/lib/vendor/parts";
import { Animator, applyPoses, assembliesOf, movableParts, DRAG, hoverHit, partBox, prepare, replayEdits, reseat, SelectionOutline, slotHit, toggleHit, type Slot } from "@/components/vendor/ModelViewer";
import { enabledAnimations, type AnimationConfig } from "@/lib/vendor/animation";

const DEV = process.env.NODE_ENV !== "production";

export function FurnitureObject({
  item,
  selected,
  showDimensions,
  onSelect,
  onNormalized,
  onParts,
  onMeasured,
  editing = false,
  partId = null,
  onPickPart,
  interactive = true,
  onMovable,
}: {
  item: PlacedItem;
  selected: boolean;
  showDimensions?: boolean;
  onSelect: () => void;
  onNormalized?: (report: NormalizationReport) => void;
  onParts?: (id: string, parts: PartInfo[], separated: boolean) => void;
  /** Size after per-mesh edits, plus each part's surface area. Collision uses this size. */
  onMeasured?: (id: string, size: Dimensions, areas: Record<string, number>) => void;
  editing?: boolean;
  partId?: string | null;
  onPickPart?: (id: string) => void;
  /** false in walk mode: clicks pass through, the model can't be selected or picked up. */
  interactive?: boolean;
  /** Movable parts: the configuration checked on this model's meshes, or one opened / closed by a click on it. */
  onMovable?: (change: { config?: AnimationConfig; toggle?: string }) => void;
}) {
  const { scene } = useGLTF(assetUrl(item.glbUrl));
  const placed = useRef<Group>(null);
  const slots = useRef<Slot[]>([]);
  const prepared = useRef<Object3D | null>(null);
  const [slotRev, setSlotRev] = useState(0);
  const [animSlots, setAnimSlots] = useState<Slot[]>([]); // slots.current, for the animation player
  const lit = useRef<Mesh[]>([]);

  // Normalisation depends only on the source and the catalogue size — never on the item's
  // position, rotation, the room or the camera — so dragging/rotating cannot change scale.
  const { object: closed, report } = useMemo(
    () => normalizeModel(scene, { width: item.width_m, height: item.height_m, ...(item.depth_m > 0 ? { depth: item.depth_m } : {}) }, item.modelId),
    [scene, item.width_m, item.height_m, item.depth_m, item.modelId],
  );
  // The open state (a wardrobe): its own file, placed exactly like the closed one (same scale, rotation, origin), so
  // switching never moves or resizes the item. Edits and part poses are by part id, the same in both states.
  const open = item.state === "open" && item.openGlbUrl ? item.openGlbUrl : null;
  const { scene: openScene } = useGLTF(assetUrl(open ?? item.glbUrl)); // the closed file again (cached) when closed
  const object = useMemo(() => (open ? alignLike(openScene, closed) : closed), [open, openScene, closed]);

  useEffect(() => {
    onNormalized?.(report);
    // report is recomputed only with `object`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  // Movable parts play on the closed file (the open-state file is already open).
  // Movable parts as checked on this model's meshes (refine): kept on the item by onMovable.
  const movable = open ? null : item.partDocument?.animation ?? null;
  const animated = !open && (enabledAnimations(item.partDocument?.animation).length > 0 || (item.partDocument?.components?.length ?? 0) > 1);
  const custom = editing || animated || Boolean(item.materialEdits && Object.keys(item.materialEdits).length) || Boolean(item.partPoses && Object.keys(item.partPoses).length) || Boolean(item.removedParts?.length);
  useEffect(() => {
    if (!custom) return;
    if (prepared.current !== object) {
      const next = prepare(object, item.partDocument ?? null); // a customised model keeps its design's part ids
      slots.current = next.slots;
      prepared.current = object;
      // At rest (just prepared): every door and drawer found and checked on the meshes; interiors opened (added to the parts).
      if (!open) {
        // At rest (just prepared): every door and drawer found on the meshes, hinged and with its handles.
        const found = movableParts(item.partDocument?.animation, next.slots, object, item.partDocument);
        if (found && JSON.stringify(found) !== JSON.stringify(item.partDocument?.animation ?? null)) onMovable?.({ config: found });
      }
      onParts?.(
        item.instanceId,
        next.slots.map((slot) => ({ id: slot.id, name: slot.name, nameAr: slot.nameAr, editable: true, ...(slot.naming ? { naming: slot.naming } : {}) })),
        next.slots.length > 1,
      );
      setSlotRev((n) => n + 1);
      setAnimSlots(next.slots);
    }
    let cancel = false;
    void replayEdits(slots.current, item.materialEdits).then(() => {
      if (cancel) return;
      applyPoses(slots.current, item.partPoses, assembliesOf(item.partDocument?.animation)); // handles move with their part
      // A customised model's removed parts are not drawn.
      for (const slot of slots.current) if (item.removedParts?.includes(slot.id)) slot.mesh.visible = false;
      const size = reseat(object);
      const areas: Record<string, number> = {};
      const seen = new Set<Mesh>();
      for (const slot of slots.current) {
        if (seen.has(slot.mesh)) continue;
        seen.add(slot.mesh);
        const box = partBox(slot);
        areas[slot.id] = 2 * (box.width * box.height + box.width * box.depth + box.height * box.depth);
      }
      // The footprint is the closed one: opening doors for a look does not move furniture around it.
      if (!open) onMeasured?.(item.instanceId, size, areas);
    });
    return () => {
      cancel = true;
    };
    // onParts / onMeasured are stable; item.instanceId does not change for this object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custom, object, open, item.materialEdits, item.partPoses, item.removedParts]);

  // eslint-disable-next-line react-hooks/refs -- slots is filled once the GLB loads; slotRev re-renders when it changes
  const picked = editing ? slots.current.find((slot) => slot.id === partId)?.mesh ?? null : null;
  void slotRev;

  useLayoutEffect(() => {
    if (!DEV || !placed.current) return;
    const world = new Box3().setFromObject(placed.current, true).getSize(new Vector3());
    console.debug("[furniture]", item.modelId, {
      original: report.originalSize,
      orientation: report.orientation,
      database: report.target,
      scale: report.scale,
      final: report.finalSize,
      rootTransform: report.rootTransform,
      nestedTransforms: report.nestedTransforms,
      rotationY: item.rotation_y,
      worldAabb: { x: world.x, y: world.y, z: world.z },
      warnings: report.warnings,
    });
  }, [report, item.modelId, item.rotation_y]);

  const size = report.finalSize;
  return (
    <group
      ref={placed}
      name="placed-furniture"
      // y = 0: the normalised model already stands on its own floor plane.
      position={[item.x, item.y ?? 0, item.z]}
      rotation={[0, (item.rotation_y * Math.PI) / 180, 0]}
      // Not interactive (walk mode): the model ignores clicks entirely, so nothing can be picked up.
      // Edit mode: the mesh click below selects a part and does not pick the item up.
      onClick={
        interactive && !editing
          ? (event) => {
              // The selected item: a click on a door, drawer or its handle opens / closes it instead.
              if (selected && toggleHit(animSlots, movable, event, (id) => onMovable?.({ toggle: id }))) return;
              event.stopPropagation();
              onSelect();
            }
          : undefined
      }
      onPointerMove={selected && interactive && !editing && movable ? (event) => hoverHit(animSlots, movable, lit, event) : undefined}
      onPointerOut={movable ? () => hoverHit(animSlots, movable, lit, null) : undefined}
    >
      {/* Tilt about the model's own X through its base centre, lifted so no corner goes below the floor. */}
      <group position={[0, tilted(size, item.rotation_x).lift, 0]} rotation={[((item.rotation_x ?? 0) * Math.PI) / 180, 0, 0]}>
        <primitive
          object={object}
          onClick={
            editing
              ? (event: { stopPropagation: () => void; object: Object3D; delta: number; face?: { materialIndex?: number } | null }) => {
                  if (event.delta > DRAG) return; // turning the view is not a click
                  event.stopPropagation();
                  const mesh = event.object as Mesh;
                  if (!mesh.isMesh) return;
                  const materialIndex = Array.isArray(mesh.material) ? event.face?.materialIndex ?? 0 : 0;
                  const hit = slotHit(slots.current, mesh, materialIndex);
                  if (hit) onPickPart?.(hit.id);
                }
              : undefined
          }
        />
        {animated && <Animator slots={animSlots} root={object} config={movable} target={item.animationOpen ?? movable?.state ?? {}} poses={item.partPoses} />}
        {editing && <SelectionOutline mesh={picked} />}
        {selected && (!picked || item.warnings.length > 0) ? (
          <SelectionFrame size={item.size ?? size} problem={item.warnings.length > 0} />
        ) : (
          DEV &&
          showDimensions && (
            <mesh position={[0, size.height / 2, 0]}>
              <boxGeometry args={[size.width, size.height, size.depth]} />
              <meshBasicMaterial color={new Color("#d97706")} wireframe transparent opacity={0.6} />
            </mesh>
          )
        )}
        {(editing || (DEV && showDimensions)) && <DimensionLabels size={item.size ?? size} />}
      </group>
    </group>
  );
}

/** Labels on the measured box (from the rendered model, not the catalogue). */
function DimensionLabels({ size }: { size: Dimensions }) {
  const tag = "whitespace-nowrap rounded bg-amber-500/90 px-1 text-[10px] font-medium text-black";
  return (
    <>
      <Html position={[0, size.height + 0.02, size.depth / 2]} center>
        <span className={tag}>W {size.width.toFixed(2)} m</span>
      </Html>
      <Html position={[size.width / 2, size.height / 2, size.depth / 2]} center>
        <span className={tag}>H {size.height.toFixed(2)} m</span>
      </Html>
      <Html position={[size.width / 2, size.height + 0.02, 0]} center>
        <span className={tag}>D {size.depth.toFixed(2)} m</span>
      </Html>
    </>
  );
}

/**
 * Selection highlight (editing or measuring): a bold box outline, handle dots on the 8 corners and a
 * soft footprint glow on the floor. Drawn on top (no depth test) so it stays visible inside the model;
 * red when the item has a placement problem.
 */
function SelectionFrame({ size, problem }: { size: Dimensions; problem: boolean }) {
  const ink = problem ? "#dc2626" : "#f2a33a";
  const { width: w, height: h, depth: d } = size;
  const corners: [number, number, number][] = [];
  for (const x of [-w / 2, w / 2]) for (const y of [0, h]) for (const z of [-d / 2, d / 2]) corners.push([x, y, z]);
  const dot = Math.max(0.025, Math.min(0.05, Math.max(w, d) * 0.02));
  return (
    <group renderOrder={10} raycast={() => undefined}>
      <mesh position={[0, h / 2, 0]} raycast={() => undefined}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        <Edges color={ink} lineWidth={2.5} threshold={15} renderOrder={10} depthTest={false} transparent />
      </mesh>
      {/* Footprint glow just above the floor (or the surface the item stands on). */}
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => undefined}>
        <planeGeometry args={[w + 0.08, d + 0.08]} />
        <meshBasicMaterial color={ink} transparent opacity={0.18} depthWrite={false} />
      </mesh>
      {corners.map((p, i) => (
        <group key={i} position={p}>
          <mesh renderOrder={11} raycast={() => undefined}>
            <sphereGeometry args={[dot * 1.35, 16, 12]} />
            <meshBasicMaterial color={ink} depthTest={false} transparent />
          </mesh>
          <mesh renderOrder={12} raycast={() => undefined}>
            <sphereGeometry args={[dot, 16, 12]} />
            <meshBasicMaterial color="#ffffff" depthTest={false} transparent />
          </mesh>
        </group>
      ))}
    </group>
  );
}
