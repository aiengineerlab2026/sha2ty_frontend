"use client";

import { tilted } from "@/lib/plan/placementValidation";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Box3, Color, Group, Vector3 } from "three";
import { Edges, Html, useGLTF } from "@react-three/drei";
import { normalizeModel, type Dimensions, type NormalizationReport } from "@/lib/plan/modelNormalization";
import type { PlacedItem } from "@/lib/plan/types";

const DEV = process.env.NODE_ENV !== "production";

export function FurnitureObject({
  item,
  selected,
  showDimensions,
  onSelect,
  onNormalized,
  interactive = true,
}: {
  item: PlacedItem;
  selected: boolean;
  showDimensions?: boolean;
  onSelect: () => void;
  onNormalized?: (report: NormalizationReport) => void;
  /** false in walk mode: clicks pass through, the model can't be selected or picked up. */
  interactive?: boolean;
}) {
  const { scene } = useGLTF(item.glbUrl);
  const placed = useRef<Group>(null);

  // Normalisation depends only on the source and the catalogue size — never on the item's
  // position, rotation, the room or the camera — so dragging/rotating cannot change scale.
  const { object, report } = useMemo(
    () => normalizeModel(scene, { width: item.width_m, height: item.height_m, depth: item.depth_m }, item.modelId),
    [scene, item.width_m, item.height_m, item.depth_m, item.modelId],
  );

  useEffect(() => {
    onNormalized?.(report);
    // report is recomputed only with `object`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

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
      // y = 0: the normalised model already stands on its own floor plane.
      position={[item.x, item.y ?? 0, item.z]}
      rotation={[0, (item.rotation_y * Math.PI) / 180, 0]}
      // Not interactive (walk mode): the model ignores clicks entirely, so nothing can be picked up.
      onClick={
        interactive
          ? (event) => {
              event.stopPropagation();
              onSelect();
            }
          : undefined
      }
    >
      {/* Tilt about the model's own X through its base centre, lifted so no corner goes below the floor. */}
      <group position={[0, tilted(size, item.rotation_x).lift, 0]} rotation={[((item.rotation_x ?? 0) * Math.PI) / 180, 0, 0]}>
        <primitive object={object} />
        {selected ? (
          <SelectionFrame size={size} problem={item.warnings.length > 0} />
        ) : (
          DEV &&
          showDimensions && (
            <mesh position={[0, size.height / 2, 0]}>
              <boxGeometry args={[size.width, size.height, size.depth]} />
              <meshBasicMaterial color={new Color("#d97706")} wireframe transparent opacity={0.6} />
            </mesh>
          )
        )}
        {DEV && showDimensions && <DimensionLabels size={size} />}
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
