"use client";

import { useT } from "@/lib/i18n";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, N8AO } from "@react-three/postprocessing";
import { Grid, Html, Line, MapControls, OrbitControls, OrthographicCamera, useGLTF } from "@react-three/drei";
import {
  DoubleSide,
  MOUSE,
  TOUCH,
  Mesh,
  Plane,
  Raycaster,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  TextureLoader,
  Vector2,
  Vector3,
  type Camera,
  type Texture,
  type Group,
  type Material,
  type MeshStandardMaterial,
  type OrthographicCamera as OrthographicCameraImpl,
} from "three";
import { catalogDimensions, normalizeModel, type Dimensions, type NormalizationReport } from "@/lib/plan/modelNormalization";
import { doorFit, doorways, type Doorway } from "@/lib/plan/doorFit";
import { clampTilt, cornerSnap, fitWindowOnWall, measureBetween, localWarnings, normalizeYaw, rugWarnings, surfaceHeight, tilted } from "@/lib/plan/placementValidation";
import { cameraForView, type CameraView } from "@/lib/plan/coordinateSystem";
import { FACADE, finishFor, tileSize, wallSides, wallTexture } from "@/lib/plan/roomMaterials";
import { WalkControls } from "./WalkControls";
import { baseHeight, mountFor, type Mount } from "@/lib/plan/categories";
import { walkStart } from "@/lib/plan/walkStart";
import type { CatalogModel, PlanGeometry, PlacedDoor, PlacedItem, PlacedRug, PlacedWindow, WallPaint } from "@/lib/plan/types";
import { FurnitureObject } from "./FurnitureObject";
import { PlanAnnotations2D } from "./PlanAnnotations2D";

export function FloorPlanViewer({
  geometry,
  items,
  selectedId,
  view,
  showGrid,
  onSelect,
  placing,
  onPlace,
  onCancelPlacing,
  onMove,
  onRotate,
  onDrop,
  onItemNormalized,
  paintSurface = null,
  onPaintWall,
  onPaintFloor,
  rugDraft = null,
  onPlaceRug,
  onPickRug,
  dimensionLines = false,
  roomSizes = false,
  roomNames = false,
  hideWalls = false,
  selectedRoomId = null,
  onSelectRoom,
  walkRoomId = null,
  onPickRoom,
  windowDraft = null,
  onPlaceWindow,
  onPickWindow,
  doorDraft = null,
  onPlaceDoor,
  onPickDoor,
  measureIds = null,
  onMeasurePick,
  panning = false,
}: {
  geometry: PlanGeometry;
  items: PlacedItem[];
  selectedId: string | null;
  view: CameraView;
  showGrid: boolean;
  onSelect: (id: string | null) => void;
  /** Catalogue model being placed (click-to-place), or null. */
  placing: CatalogModel | null;
  onPlace: (model: CatalogModel, x: number, z: number, rotationY: number, size: Dimensions, rotationX: number) => void;
  onCancelPlacing: () => void;
  onMove: (id: string, x: number, z: number) => void;
  /** Turn (Y) / tilt (X) the furniture being carried, in degrees. */
  onRotate?: (id: string, rotation: { rotation_y: number; rotation_x: number }) => void;
  /** A carried item was dropped: the parent fixes its placement if it doesn't fit there. */
  onDrop?: (id: string) => void;
  onItemNormalized: (id: string, report: NormalizationReport) => void;
  /** Paint brush surface: clicking a wall face calls onPaintWall(`${wallId}:L|R`), a floor onPaintFloor(areaId). */
  paintSurface?: "wall" | "floor" | "any" | null;
  onPaintWall?: (key: string) => void;
  onPaintFloor?: (areaId: string) => void;
  /** Carpet being laid: follows the cursor, next floor click lays it. */
  rugDraft?: Omit<PlacedRug, "x" | "z"> | null;
  onPlaceRug?: (x: number, z: number) => void;
  /** Click on a laid carpet: pick it up to move it. */
  onPickRug?: (rug: PlacedRug) => void;
  /** Perimeter dimension lines in the 2D view. */
  dimensionLines?: boolean;
  /** Room name + size labels floating in the 3D views (sizes are approximate when the scale was estimated). */
  roomSizes?: boolean;
  /** Room name labels floating in the 3D views. */
  roomNames?: boolean;
  /** Hide every wall (floors, doors' thresholds and furniture stay): the layout seen from any angle. */
  hideWalls?: boolean;
  /** Clicked room (zone id): highlighted; a click on a floor calls onSelectRoom, outside a room clears it. */
  selectedRoomId?: string | null;
  onSelectRoom?: (areaId: string | null) => void;
  /** Zone / room the walk starts in (its entrance door); default: the dining room. */
  walkRoomId?: string | null;
  /** Room picking (before walking): rooms highlight on hover and a click calls this with the room id. */
  onPickRoom?: (areaId: string) => void;
  /** Window being placed: hovering a wall face previews it there, a click places it. */
  windowDraft?: Omit<PlacedWindow, "wall_id" | "side" | "along" | "y"> | null;
  onPlaceWindow?: (placed: PlacedWindow) => void;
  /** Click on a placed window: pick it up to move it. */
  onPickWindow?: (placed: PlacedWindow) => void;
  /** Door being fitted: only the plan's doorways take it, coloured by whether its size fits. */
  doorDraft?: Omit<PlacedDoor, "opening_id"> | null;
  onPlaceDoor?: (placed: PlacedDoor) => void;
  /** Click on a fitted door: pick it up to move or delete it. */
  onPickDoor?: (placed: PlacedDoor) => void;
  /** Measuring: the items picked so far (0–2); clicking a model adds it instead of picking it up. */
  measureIds?: string[] | null;
  onMeasurePick?: (id: string) => void;
  /** Pan tool: start-drag pans the view; nothing in the scene reacts to clicks. */
  panning?: boolean;
}) {
  const t = useT();
  const width = geometry.extents?.width ?? span(geometry, 0);
  const depth = geometry.extents?.depth ?? span(geometry, 1);
  const height = geometry.height ?? 3;
  const cam = cameraForView(view, width, depth, height);
  const wrap = useRef<HTMLDivElement>(null);
  // Finishes follow the functional zone (open-plan living/dining/kitchen differ), else the room.
  const areas = useMemo(
    () => (geometry.zones?.length ? geometry.zones : geometry.rooms).map((a) => ({ id: a.id, kind: a.kind ?? "room", polygon: a.polygon })),
    [geometry.zones, geometry.rooms],
  );
  const wallSidesById = useMemo(
    () => new Map(geometry.walls.map((w) => [w.id, wallSides(w.start, w.end, w.thickness, areas)] as const)),
    [geometry.walls, areas],
  );
  // Walk mode starts at the dining room's entrance door, looking into the dining room.
  const walk = useMemo(() => walkStart(geometry, [width / 2, depth / 2], walkRoomId), [geometry, width, depth, walkRoomId]);
  const camera = useRef<Camera | null>(null);
  const [showDimensions, setShowDimensions] = useState(false);
  // Carry mode: click furniture to pick it up, it follows the cursor on the floor, next click drops it.
  const [carrying, setCarrying] = useState<{ id: string; origin: [number, number] } | null>(null);
  // Switching to the pan tool cancels a carry in progress: the item goes back where it was.
  useEffect(() => {
    if (!panning || !carrying) return;
    onMove(carrying.id, carrying.origin[0], carrying.origin[1]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCarrying(null);
  }, [panning, carrying, onMove]);
  const justPicked = useRef(false);
  const is2d = view === "2d";
  const walking = view === "walk";
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  // Window placement: where the window would go on the hovered wall face, or why it can't.
  const [windowHover, setWindowHover] = useState<{ wall: PlanGeometry["walls"][number]; side: "L" | "R"; along: number; y: number; problem: string | null } | null>(null);
  const windowAt = (wall: PlanGeometry["walls"][number], side: "L" | "R", along: number, y: number) => {
    if (!windowDraft) return null;
    const fit = fitWindowOnWall(windowDraft, wall, along, y - (wall.elevation ?? 0));
    return "problem" in fit ? { wall, side, along, y, problem: fit.problem } : { wall, side, along: fit.along, y: fit.y + (wall.elevation ?? 0), problem: null };
  };
  const painting = paintSurface !== null;
  const doorOpenings = useMemo(() => doorways(geometry), [geometry]);
  const [doorHover, setDoorHover] = useState<string | null>(null);
  const doorMessage = (opening: Doorway) => {
    if (!doorDraft) return "";
    const fit = doorFit(doorDraft, opening);
    const size = `${opening.width.toFixed(2)} × ${opening.height.toFixed(2)} m`;
    if (fit.status === "too_big")
      return fit.wide < 0
        ? t("Doesn't fit: {name} is {n} cm wider than this doorway ({size})", { name: doorDraft.name, n: -fit.wide, size })
        : t("Doesn't fit: {name} is {n} cm taller than this doorway ({size})", { name: doorDraft.name, n: -fit.tall, size });
    if (fit.status === "gap") return t("Fits with a gap: the doorway ({size}) is {w} cm wider and {h} cm taller", { size, w: fit.wide, h: fit.tall });
    return t("Fits this doorway ({size}). Click to fit it", { size });
  };
  const paintWalls = paintSurface === "wall" || paintSurface === "any";
  const paintFloors = paintSurface === "floor" || paintSurface === "any";
  // Carpet at its catalogue width × length must fit the room it is laid in.
  const rugProblem = (x: number, z: number) => (rugDraft ? (rugWarnings({ ...rugDraft, x, z }, geometry)[0] ?? null) : null);

  // Placement preview: position lives in a ref (updated per pointer move, read per frame) so moving
  // the mouse never re-renders React or reloads the model. Only validity changes trigger a render.
  const preview = useRef<{ x: number; z: number } | null>(null);
  const previewSize = useRef<Dimensions | null>(null);
  // Height the preview stands at: a table top under a TV, else the floor (read per frame).
  const previewSurface = useRef(0);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [previewTilt, setPreviewTilt] = useState(0);
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);

  const floorAt = (clientX: number, clientY: number) => {
    const canvas = wrap.current?.querySelector("canvas");
    if (!canvas || !camera.current) return null;
    // NDC relative to the canvas itself, not the page or the wrapper.
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    return floorPoint(ndc, camera.current);
  };

  // L-shaped corner units: the catalogue arm depth, and a snap into the nearest room corner.
  const placingL = placing?.shape === "l_left" || placing?.shape === "l_right" ? (placing.shape as "l_left" | "l_right") : null;
  const placingArm = placingL && placing?.depth_m ? Number(placing.depth_m) : null;
  const snapToCorner = (x: number, z: number) => {
    const size = previewSize.current;
    if (!placingL || !size || !placing?.width_m) return null;
    const arm = (placingArm ?? 0.6) * (size.width / Number(placing.width_m));
    return cornerSnap({ shape: placingL, width: size.width, depth: size.depth, arm }, geometry, { x, z });
  };

  const checkPreview = (x: number, z: number, rotation = previewRotation) => {
    if (!placing) return null;
    const size = previewSize.current;
    if (!size) return t("Loading model…");
    const candidate: PlacedItem = {
      instanceId: "__preview__",
      modelId: placing.id,
      title: placing.title,
      company: placing.company,
      glbUrl: placing.glb_url,
      width_m: size.width,
      height_m: size.height,
      depth_m: size.depth,
      size,
      x,
      y: 0,
      z,
      rotation_y: rotation,
      rotation_x: previewTilt,
      category: placing.category,
      mount: mountFor(placing.category),
      shape: placing.shape ?? "straight",
      arm_m: placingArm ?? undefined,
      warnings: [],
    };
    return localWarnings(candidate, geometry, items)[0] ?? null;
  };

  useEffect(() => {
    if (!placing) return;
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelPlacing();
      const turn = rotationKey(event);
      if (turn?.axis === "y") setPreviewRotation((r) => normalizeYaw(r + turn.step));
      if (turn?.axis === "x") setPreviewTilt((t) => clampTilt(t + turn.step));
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [placing, onCancelPlacing]);

  // Re-check where the preview stands when it rotates or switches model.
  useEffect(() => {
    const p = preview.current;
    if (placing && p) setPreviewProblem(checkPreview(p.x, p.z));
    // checkPreview reads the latest props; re-run only on these changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewRotation, previewTilt, placing]);

  // Re-check the carpet preview where it stands when it rotates (R) or a new carpet is picked.
  useEffect(() => {
    const p = preview.current;
    if (rugDraft && p) setPreviewProblem(rugProblem(p.x, p.z));
    // rugProblem reads the latest props; re-run only when the draft changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rugDraft]);

  const pick = (item: PlacedItem) => {
    if (walking || onPickRoom || panning) return; // walking / choosing a room / panning: nothing is picked up or selected
    if (measureIds && onMeasurePick) {
      onMeasurePick(item.instanceId); // measuring: models are measure points, not picked up
      return;
    }
    if (placing) return; // clicks during placement place the new model, they do not pick others up
    if (carrying) {
      setCarrying(null); // the click landed on the carried item itself: drop it here
      onDrop?.(carrying.id);
      return;
    }
    justPicked.current = true; // this same click must not also count as the drop
    onSelect(item.instanceId);
    setCarrying({ id: item.instanceId, origin: [item.x, item.z] });
  };

  useEffect(() => {
    if (!carrying) return;
    const cancel = (event: KeyboardEvent) => {
      const turn = rotationKey(event);
      const item = items.find((i) => i.instanceId === carrying.id);
      if (turn && item && onRotate) {
        const y = turn.axis === "y" ? normalizeYaw(item.rotation_y + turn.step) : item.rotation_y;
        const x = turn.axis === "x" ? clampTilt((item.rotation_x ?? 0) + turn.step) : (item.rotation_x ?? 0);
        onRotate(carrying.id, { rotation_y: y, rotation_x: x });
        return;
      }
      if (event.key !== "Escape") return;
      onMove(carrying.id, carrying.origin[0], carrying.origin[1]);
      setCarrying(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [carrying, onMove, onRotate, items]);

  return (
    <div
      ref={wrap}
      className={`relative h-full min-h-[480px] bg-[#e4eaee] ${carrying ? "cursor-grabbing" : panning ? "cursor-grab active:cursor-grabbing" : onPickRoom ? "cursor-pointer" : placing || painting || rugDraft || windowDraft ? "cursor-crosshair" : ""}`}
      onPointerMove={(event) => {
        const hit = floorAt(event.clientX, event.clientY);
        if (rugDraft) {
          preview.current = hit ? { x: hit.x, z: hit.z } : null;
          setPreviewProblem(hit ? rugProblem(hit.x, hit.z) : t("Point at a room floor."));
          return;
        }
        if (placing) {
          const snap = hit ? snapToCorner(hit.x, hit.z) : null;
          if (snap) {
            // Near a room corner an L unit sits into it, each arm along a wall.
            preview.current = { x: snap.x, z: snap.z };
            if (snap.rotation !== previewRotation) setPreviewRotation(snap.rotation);
            setPreviewProblem(checkPreview(snap.x, snap.z, snap.rotation));
            return;
          }
          preview.current = hit ? { x: hit.x, z: hit.z } : null;
          previewSurface.current = hit && placing.category === "tv" ? surfaceHeight({ instanceId: "__preview__", x: hit.x, z: hit.z }, items) : 0;
          setPreviewProblem(hit ? checkPreview(hit.x, hit.z) : t("Point at the floor."));
          return;
        }
        if (!carrying || walking) return; // nothing follows the cursor while walking
        const carried = items.find((i) => i.instanceId === carrying.id);
        if (hit && carried && (carried.shape === "l_left" || carried.shape === "l_right")) {
          // Carrying an L unit: it drops into a room corner the same way it does when first placed.
          const size = carried.size ?? { width: carried.width_m, height: carried.height_m, depth: carried.depth_m };
          const arm = (carried.arm_m ?? 0.6) * (carried.width_m ? size.width / carried.width_m : 1);
          const snap = cornerSnap({ shape: carried.shape, width: size.width, depth: size.depth, arm }, geometry, { x: hit.x, z: hit.z });
          if (snap) {
            if (snap.rotation !== carried.rotation_y) onRotate?.(carried.instanceId, { rotation_y: snap.rotation, rotation_x: carried.rotation_x ?? 0 });
            onMove(carried.instanceId, snap.x, snap.z);
            return;
          }
        }
        if (hit) onMove(carrying.id, clamp(hit.x, 0, width), clamp(hit.z, 0, depth));
      }}
      onPointerDown={(event) => {
        pressAt.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        if (justPicked.current) {
          justPicked.current = false;
          return;
        }
        // A drag (looking around / orbiting) is not a drop.
        const p = pressAt.current;
        if (p && Math.hypot(event.clientX - p.x, event.clientY - p.y) > 5) return;
        if (rugDraft) {
          const hit = floorAt(event.clientX, event.clientY);
          if (!hit) return;
          const problem = rugProblem(hit.x, hit.z);
          setPreviewProblem(problem);
          if (!problem) onPlaceRug?.(hit.x, hit.z);
          return;
        }
        if (placing) {
          // Place exactly where the cursor meets the floor — only if the spot is valid.
          const hit = floorAt(event.clientX, event.clientY);
          const size = previewSize.current;
          if (!hit || !size) return;
          const snap = snapToCorner(hit.x, hit.z);
          const at = snap ?? { x: hit.x, z: hit.z, rotation: previewRotation };
          const problem = checkPreview(at.x, at.z, at.rotation);
          setPreviewProblem(problem);
          if (!problem) onPlace(placing, at.x, at.z, at.rotation, size, previewTilt);
          return;
        }
        if (carrying) {
          setCarrying(null);
          onDrop?.(carrying.id);
        }
      }}
    >
      {/* flat = no tone mapping: paints and floor finishes show their real swatch colour. */}
      <Canvas
        flat
        camera={{ position: [...cam.position], fov: view === "top" ? 50 : 45 }}
        onPointerMissed={() => {
          if (!placing && !painting && !rugDraft && !windowDraft && !onPickRoom) {
            onSelect(null);
            onSelectRoom?.(null);
          }
        }}
      >
        {/* Soft misty blue-grey: calm next to the beige floors, easier on the eyes than near-black. */}
        <color attach="background" args={["#e4eaee"]} />
        {/* Indoor light: a key from +X and a fill from −Z give each wall direction its own shade
            (~0.75–0.93 of its true colour), so two same-colour walls still read as a corner, while
            the floor stays at ~1.0. three's physical lights divide by π (Lambert), hence the π. */}
        <ambientLight intensity={0.72 * Math.PI} />
        <directionalLight position={[10, 10, 3]} intensity={0.3 * Math.PI} />
        <directionalLight position={[-3, 8, -10]} intensity={0.15 * Math.PI} />
        {/* Soft ambient occlusion: darkens inside corners and wall / floor / ceiling junctions. */}
        {!is2d && (
          <EffectComposer multisampling={4}>
            <N8AO aoRadius={0.8} distanceFalloff={0.6} intensity={2.2} halfRes />
          </EffectComposer>
        )}
        <CameraRig view={view} width={width} depth={depth} height={height} onCamera={(c) => {
            camera.current = c;
          }}
        />
        {walking ? (
          <WalkControls start={walk.position} yaw={walk.yaw} walls={geometry.walls} />
        ) : is2d ? (
          <>
            <PlanCamera width={width} depth={depth} />
            {/* 2D: pan and zoom only, the plan never tilts. */}
            <MapControls key="2d" makeDefault target={[width / 2, 0, depth / 2]} enableRotate={false} screenSpacePanning enabled={!carrying && !placing && !rugDraft} />
          </>
        ) : (
          <OrbitControls
            key="3d"
            makeDefault
            target={[...cam.target]}
            enableDamping
            enabled={!carrying && !placing && !rugDraft}
            // Pan tool: the left button pans instead of orbiting (right-drag still orbits).
            mouseButtons={panning ? { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE } : undefined}
            touches={panning ? { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE } : undefined}
          />
        )}
        {showGrid && <Grid args={[Math.max(Math.ceil(width), 4), Math.max(Math.ceil(depth), 4)]} cellSize={1} sectionSize={5} sectionColor="#94a3b8" cellColor="#c3ccd5" infiniteGrid={false} position={[width / 2, 0.001, depth / 2]} />}
        {areas.map((area) => (
          <Floor
            key={area.id}
            polygon={area.polygon}
            kind={area.kind}
            paint={geometry.floor_paints?.[area.id]}
            selectable={Boolean(onPickRoom)}
            selected={selectedRoomId === area.id}
            onPaint={
              onPickRoom
                ? () => onPickRoom(area.id)
                : paintFloors && onPaintFloor
                  ? () => onPaintFloor(area.id)
                  : onSelectRoom && !walking && !panning && !placing && !painting && !rugDraft && !windowDraft && !doorDraft && !carrying
                    ? () => {
                        onSelect(null);
                        onSelectRoom(area.id);
                      }
                    : undefined
            }
          />
        ))}
        {(geometry.floors ?? []).map((strip, index) => (
          <Floor key={`door-floor-${index}`} polygon={strip} kind="hall" />
        ))}
        {/* 2D is a plan cut at ~1.2 m: lintels and sills would cover door and window openings. */}
        {geometry.walls.filter((wall) => !hideWalls && (!is2d || ((wall.elevation ?? 0) === 0 && wall.height >= 1.5))).map((wall) => (
          <WallMesh
            key={wall.id}
            wall={wall}
            sides={wallSidesById.get(wall.id) ?? [null, null]}
            paints={[geometry.wall_paints?.[`${wall.id}:L`], geometry.wall_paints?.[`${wall.id}:R`]]}
            onPaint={paintWalls && onPaintWall ? (side) => onPaintWall(`${wall.id}:${side}`) : undefined}
            skirting={!is2d}
            onFacePoint={
              windowDraft && (wall.elevation ?? 0) === 0 && wall.height >= 1.5
                ? (side, along, y, click) => {
                    const at = windowAt(wall, side, along, y);
                    setWindowHover(at);
                    if (click && at && !at.problem && onPlaceWindow)
                      onPlaceWindow({ ...windowDraft, wall_id: wall.id, side, along: at.along, y: at.y });
                  }
                : undefined
            }
          />
        ))}
        {(geometry.rugs ?? []).map((rug) => (
          <Rug
            key={rug.id}
            rug={rug}
            onClick={
              onPickRug && !walking && !onPickRoom && !panning && !placing && !painting && !rugDraft && !carrying
                ? () => {
                    justPicked.current = true; // this click picks it up; the next one lays it
                    onPickRug(rug);
                  }
                : undefined
            }
          />
        ))}
        {rugDraft && <Rug rug={{ ...rugDraft, x: 0, z: 0 }} follow={preview} invalid={Boolean(previewProblem)} />}
        {(geometry.placed_windows ?? []).map((win) => {
          const wall = geometry.walls.find((w) => w.id === win.wall_id);
          return wall ? (
            <WindowDecal
              key={win.id}
              win={win}
              wall={wall}
              onClick={
                onPickWindow && !walking && !onPickRoom && !panning && !placing && !painting && !rugDraft && !windowDraft && !carrying
                  ? () => {
                      justPicked.current = true;
                      onPickWindow(win);
                    }
                  : undefined
              }
            />
          ) : null;
        })}
        {(geometry.placed_doors ?? []).map((door) => {
          const opening = doorOpenings.find((o) => o.id === door.opening_id);
          return opening ? (
            <DoorLeaf
              key={door.id}
              door={door}
              opening={opening}
              onClick={
                onPickDoor && !walking && !onPickRoom && !panning && !placing && !painting && !rugDraft && !windowDraft && !doorDraft && !carrying
                  ? () => {
                      justPicked.current = true;
                      onPickDoor(door);
                    }
                  : undefined
              }
            />
          ) : null;
        })}
        {doorDraft &&
          doorOpenings.map((opening) => {
            const status = doorFit(doorDraft, opening).status;
            return (
              <DoorwayTarget
                key={opening.id}
                opening={opening}
                status={status}
                hovered={doorHover === opening.id}
                onHover={(on) => setDoorHover((h) => (on ? opening.id : h === opening.id ? null : h))}
                onClick={() => {
                  if (status !== "too_big" && onPlaceDoor) onPlaceDoor({ ...doorDraft, opening_id: opening.id });
                }}
              />
            );
          })}
        {measureIds?.length === 2 && <Measurement a={items.find((i) => i.instanceId === measureIds[0])} b={items.find((i) => i.instanceId === measureIds[1])} />}
        {windowDraft && windowHover && (
          <WindowDecal win={{ ...windowDraft, wall_id: windowHover.wall.id, side: windowHover.side, along: windowHover.along, y: windowHover.y }} wall={windowHover.wall} ghost invalid={Boolean(windowHover.problem)} />
        )}
        {is2d && <PlanAnnotations2D geometry={geometry} sides={wallSidesById} showDimensions={dimensionLines} />}
        <Fixtures fixtures={geometry.fixtures} />
        {(roomSizes || roomNames) && !is2d && <RoomSizeLabels geometry={geometry} names={roomNames} sizes={roomSizes} />}
        {items.map((item) => (
          <FurnitureDraggable
            key={item.instanceId}
            item={item}
            selected={selectedId === item.instanceId || Boolean(measureIds?.includes(item.instanceId))}
            showDimensions={showDimensions}
            onPick={() => pick(item)}
            interactive={!walking && !onPickRoom && !panning}
            onNormalized={(report) => onItemNormalized(item.instanceId, report)}
          />
        ))}
        {placing && (
          <Suspense fallback={null}>
            <PlacementPreview
              key={placing.id}
              model={placing}
              position={preview}
              rotationY={previewRotation}
              rotationX={previewTilt}
              mount={mountFor(placing.category)}
              ceiling={height}
              surface={previewSurface}
              invalid={Boolean(previewProblem)}
              onSize={(size) => {
                previewSize.current = size;
              }}
            />
          </Suspense>
        )}
      </Canvas>
      {placing && <PlacementGuide action={t("Click the floor to place {name}", { name: placing.title })} problem={previewProblem} />}
      {rugDraft && <PlacementGuide action={t("Click the floor to lay {name}", { name: rugDraft.name })} problem={previewProblem} />}
      {measureIds && (
        <p className="pointer-events-none absolute bottom-3 left-1/2 max-w-[90%] -translate-x-1/2 rounded bg-black/75 px-3 py-1 text-center text-xs text-white">
          {measureIds.length === 0 ? t("Click a model to measure from") : measureIds.length === 1 ? t("Click a second model") : t("Click another model to measure again")} · Esc to stop measuring
        </p>
      )}
      {doorDraft && (
        <p
          className={`pointer-events-none absolute bottom-3 left-1/2 max-w-[90%] -translate-x-1/2 rounded px-3 py-1 text-center text-xs text-white ${(() => {
            const o = doorOpenings.find((d) => d.id === doorHover);
            return o && doorFit(doorDraft, o).status === "too_big" ? "bg-red-700/90" : "bg-black/70";
          })()}`}
        >
          {doorOpenings.length === 0
            ? t("This plan has no doorways to fit a door into.")
            : (() => {
                const o = doorOpenings.find((d) => d.id === doorHover);
                return o ? doorMessage(o) : t("Click a doorway to fit {name} ({w} × {h} m)", { name: doorDraft.name, w: doorDraft.width.toFixed(2), h: doorDraft.height.toFixed(2) });
              })()}{" "}
          · {t("Esc to cancel")}
        </p>
      )}
      {windowDraft && (
        <p
          className={`pointer-events-none absolute bottom-3 left-1/2 max-w-[90%] -translate-x-1/2 rounded px-3 py-1 text-center text-xs text-white ${windowHover?.problem ? "bg-red-700/90" : "bg-black/70"}`}
        >
          {windowHover?.problem ?? t("Click a wall to place {name}", { name: windowDraft.name })} · {t("Esc to cancel")}
        </p>
      )}
      {painting && (
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-xs text-white">
          {paintSurface === "floor"
            ? t("Click a floor to apply · click it again to remove · Esc to stop")
            : t(paintSurface === "any" ? "Click a wall or floor to apply · Esc to stop" : "Click a wall to apply · Esc to stop")}
        </p>
      )}
      {carrying && !placing && (
        // Live fit check while moving: the frame turns red and the guide says why; a drop there moves it
        // to the nearest spot where it fits (never left overlapping a wall or another item).
        <PlacementGuide
          action={t("Click where it should go")}
          problem={(() => {
            const w = items.find((i) => i.instanceId === carrying.id)?.warnings[0];
            return w ? `${w} ${t("Dropping here moves it to the nearest spot where it fits.")}` : null;
          })()}
        />
      )}
      {walking && !carrying && !placing && <WalkGuide />}
      {process.env.NODE_ENV !== "production" && (
        <label className="pointer-events-auto absolute end-2 top-2 flex items-center gap-1 rounded bg-black/60 px-2 py-1 text-[11px] text-white">
          <input type="checkbox" checked={showDimensions} onChange={() => setShowDimensions((v) => !v)} /> Dimension boxes (dev)
        </label>
      )}
    </div>
  );
}

const FLOOR = new Plane(new Vector3(0, 1, 0), 0);

function floorPoint(ndc: Vector2, camera: Camera) {
  const ray = new Raycaster();
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(FLOOR, new Vector3());
}

function FurnitureDraggable({
  item,
  selected,
  onPick,
  onNormalized,
  showDimensions,
  interactive,
}: {
  item: PlacedItem;
  selected: boolean;
  showDimensions: boolean;
  onPick: () => void;
  onNormalized: (report: NormalizationReport) => void;
  interactive: boolean;
}) {
  // Position follows the cursor through the viewer's carry mode; only x/z ever change.
  return <FurnitureObject item={item} selected={selected} onSelect={onPick} showDimensions={showDimensions} onNormalized={onNormalized} interactive={interactive} />;
}

/**
 * Semi-transparent copy of the catalogue model following the cursor. Same loader and the same
 * normalisation as placed furniture and the standalone viewer, so what you preview is what lands.
 * Materials are cloned for the ghost so the cached GLB's materials are never altered.
 */
function PlacementPreview({
  model,
  position,
  rotationY,
  rotationX,
  mount,
  ceiling,
  surface,
  invalid,
  onSize,
}: {
  model: CatalogModel;
  position: React.RefObject<{ x: number; z: number } | null>;
  rotationY: number;
  rotationX: number;
  /** floor (on the surface below), ceiling (ceiling lights) or wall (wall art at eye level). */
  mount: Mount;
  ceiling: number;
  /** Height of the surface under the cursor (a table top for TVs), metres. */
  surface: React.RefObject<number>;
  invalid: boolean;
  onSize: (size: Dimensions) => void;
}) {
  const { scene } = useGLTF(model.glb_url);
  const group = useRef<Group>(null);
  const { object, ghosts, size } = useMemo(() => {
    const { object, report } = normalizeModel(scene, catalogDimensions(model), model.id);
    const ghosts: MeshStandardMaterial[] = [];
    object.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const ghost = (m: Material) => {
        const c = m.clone() as MeshStandardMaterial;
        c.transparent = true;
        c.opacity = 0.55;
        c.depthWrite = false;
        c.userData.baseColor = c.color?.clone();
        ghosts.push(c);
        return c;
      };
      node.material = Array.isArray(node.material) ? node.material.map(ghost) : ghost(node.material);
      node.raycast = () => undefined; // the ghost must not catch clicks meant for the floor
    });
    return { object, ghosts, size: report.finalSize };
  }, [scene, model]);

  useEffect(() => onSize(size), [onSize, size]);
  useEffect(() => () => ghosts.forEach((m) => m.dispose()), [ghosts]);
  useEffect(() => {
    for (const m of ghosts) {
      if (!m.color) continue;
      if (invalid) m.color.set("#ef4444");
      else if (m.userData.baseColor) m.color.copy(m.userData.baseColor);
    }
  }, [ghosts, invalid]);

  useFrame(() => {
    const g = group.current;
    const p = position.current;
    if (!g) return;
    g.visible = Boolean(p);
    // Bottom on the floor plane, or top against the ceiling for ceiling lights; size never changes.
    if (p) g.position.set(p.x, mount === "floor" ? surface.current : baseHeight(mount, ceiling, size.height), p.z);
  });

  return (
    <group ref={group} rotation={[0, (rotationY * Math.PI) / 180, 0]} visible={false}>
      <group position={[0, tilted(size, rotationX).lift, 0]} rotation={[(rotationX * Math.PI) / 180, 0, 0]}>
        <primitive object={object} />
        <mesh position={[0, size.height / 2, 0]} raycast={() => undefined}>
          <boxGeometry args={[size.width, size.height, size.depth]} />
          <meshBasicMaterial color={invalid ? "#ef4444" : "#22c55e"} wireframe transparent opacity={0.7} />
        </mesh>
      </group>
    </group>
  );
}

/** Orthographic top-down camera: true 2D plan, 1 m always the same on screen, fitted to the apartment. */
function PlanCamera({ width, depth }: { width: number; depth: number }) {
  const size = useThree((state) => state.size);
  const zoom = Math.min(size.width / (width * 1.15), size.height / (depth * 1.15));
  const ref = useRef<OrthographicCameraImpl>(null);
  useLayoutEffect(() => {
    // Looking down −Y with up = −Z: +X right, +Z down the screen, like the drawing.
    ref.current?.lookAt(width / 2, 0, depth / 2);
  }, [width, depth]);
  return <OrthographicCamera ref={ref} makeDefault position={[width / 2, 50, depth / 2]} up={[0, 0, -1]} zoom={zoom} near={0.1} far={200} />;
}

function CameraRig({ view, width, depth, height, onCamera }: { view: CameraView; width: number; depth: number; height: number; onCamera: (camera: Camera) => void }) {
  // The camera frames the scene; it never changes object sizes.
  const { camera } = useThree();
  useLayoutEffect(() => {
    onCamera(camera);
  }, [camera, onCamera]);
  useLayoutEffect(() => {
    if (view === "2d" || view === "walk") return; // PlanCamera / WalkControls own the camera
    const next = cameraForView(view, width, depth, height, "fov" in camera ? (camera as { fov: number }).fov : 50);
    camera.position.set(...next.position);
    camera.lookAt(...next.target);
    camera.updateProjectionMatrix();
  }, [camera, view, width, depth, height]);
  return null;
}

function span(geometry: PlanGeometry, axis: 0 | 1) {
  const values = geometry.rooms.flatMap((room) => room.polygon.map((p) => p[axis]));
  if (!values.length) return axis === 0 ? 4 : 5;
  return Math.max(...values) - Math.min(...values);
}

function Floor({
  polygon,
  kind,
  paint,
  onPaint,
  selectable = false,
  selected = false,
}: {
  polygon: [number, number][];
  kind: string;
  paint?: WallPaint;
  onPaint?: () => void;
  /** Room picking: glow amber under the cursor. */
  selectable?: boolean;
  /** The clicked room: glows amber until another is picked. */
  selected?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const glow = (selectable && hovered) || selected;
  const texture = usePaintTexture(paint?.texture_url);
  // Shape UVs are in metres, so repeat = 1 / tile size keeps the vendor's real tile size.
  const map = useMemo(() => {
    if (!texture || !paint) return null;
    const next = texture.clone();
    // Shape UVs are metres along x (u) and z (v): repeat = 1 / tile size in each direction.
    const [tw, th] = tileSize(paint);
    next.repeat.set(1 / tw, 1 / th);
    next.needsUpdate = true;
    return next;
  }, [texture, paint]);
  useEffect(() => () => map?.dispose(), [map]);
  const shape = useMemo(() => {
    const next = new Shape();
    polygon.forEach(([x, z], index) => {
      if (index === 0) next.moveTo(x, z);
      else next.lineTo(x, z);
    });
    next.closePath();
    return next;
  }, [polygon]);
  const finish = finishFor(kind);
  return (
    // Shape (x, z) → world (x, 0, z). A −π/2 turn would map z to −z and mirror floors away from walls.
    <mesh
      rotation={[Math.PI / 2, 0, 0]}
      receiveShadow
      onPointerOver={selectable ? (event) => (event.stopPropagation(), setHovered(true)) : undefined}
      onPointerOut={selectable ? () => setHovered(false) : undefined}
      onClick={
        onPaint &&
        ((event) => {
          event.stopPropagation();
          onPaint();
        })
      }
    >
      <shapeGeometry args={[shape]} />
      {/* Keyed on the texture: a material compiled without a map ignores one assigned later
          (three.js only adds map support on recompile), which drew textured floors flat grey. */}
      <meshStandardMaterial
        key={map?.uuid ?? "flat"}
        color={map ? "#ffffff" : paint?.color ?? finish.floor}
        map={map ?? undefined}
        emissive="#f2a33a"
        emissiveIntensity={glow ? 0.45 : 0}
        roughness={0.8}
        side={DoubleSide}
      />
    </mesh>
  );
}

/** Carpet: its image stretched over width × length, lying just above the floor. */
function Rug({
  rug,
  follow,
  invalid = false,
  onClick,
}: {
  rug: PlacedRug;
  /** Preview: position read from this ref every frame (no re-render per mouse move). */
  follow?: { current: { x: number; z: number } | null };
  invalid?: boolean;
  onClick?: () => void;
}) {
  const texture = usePaintTexture(rug.image_url);
  const group = useRef<Group>(null);
  useFrame(() => {
    if (!follow || !group.current) return;
    const p = follow.current;
    group.current.visible = Boolean(p);
    if (p) group.current.position.set(p.x, 0.012, p.z);
  });
  return (
    <group ref={group} position={[rug.x, 0.012, rug.z]} rotation={[0, (rug.rotation * Math.PI) / 180, 0]}>
      {/* Tilt about the carpet's own X through its centre, lifted so its lower edge rests on the floor. */}
      <group position={[0, (rug.length / 2) * Math.abs(Math.sin(((rug.tilt ?? 0) * Math.PI) / 180)), 0]} rotation={[((rug.tilt ?? 0) * Math.PI) / 180, 0, 0]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={
          onClick &&
          ((event) => {
            event.stopPropagation();
            onClick();
          })
        }
      >
        <planeGeometry args={[rug.width, rug.length]} />
        <meshStandardMaterial
          key={texture?.uuid ?? "loading"} // recompile with map support once the image has loaded
          color={invalid ? "#ef4444" : "#ffffff"}
          map={texture ?? undefined}
          roughness={0.95}
          transparent={Boolean(follow)}
          opacity={follow ? 0.65 : 1}
          depthWrite={!follow}
          side={DoubleSide}
        />
      </mesh>
      </group>
    </group>
  );
}

/** Distance (metres) from the wall's start to a world point, measured along the wall. */
function alongWall(wall: PlanGeometry["walls"][number], x: number, z: number) {
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const len = Math.hypot(dx, dz) || 1;
  return ((x - wall.start[0]) * dx + (z - wall.start[1]) * dz) / len;
}

const DOOR_FIT_COLOR = { fits: "#16a34a", gap: "#f59e0b", too_big: "#dc2626" } as const;

/** A door opening while a door is being fitted: a translucent box filling it, green / amber / red by fit. */
function DoorwayTarget({ opening, status, hovered, onHover, onClick }: { opening: Doorway; status: keyof typeof DOOR_FIT_COLOR; hovered: boolean; onHover: (on: boolean) => void; onClick: () => void }) {
  const [ax, az] = opening.start;
  const [bx, bz] = opening.end;
  return (
    <mesh
      position={[(ax + bx) / 2, opening.height / 2, (az + bz) / 2]}
      rotation={[0, -Math.atan2(bz - az, bx - ax), 0]}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(true);
      }}
      onPointerOut={() => onHover(false)}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <boxGeometry args={[opening.width, opening.height, opening.thickness + 0.04]} />
      <meshStandardMaterial color={DOOR_FIT_COLOR[status]} transparent opacity={hovered ? 0.55 : 0.3} depthWrite={false} />
    </mesh>
  );
}

/** A fitted door: its cut-out image standing in the opening at the door's real size, centred, from the floor. */
function DoorLeaf({ door, opening, onClick }: { door: PlacedDoor; opening: Doorway; onClick?: () => void }) {
  const texture = usePaintTexture(door.image_url);
  const [ax, az] = opening.start;
  const [bx, bz] = opening.end;
  return (
    <mesh
      position={[(ax + bx) / 2, door.height / 2, (az + bz) / 2]}
      rotation={[0, -Math.atan2(bz - az, bx - ax), 0]}
      onClick={
        onClick &&
        ((event) => {
          event.stopPropagation();
          onClick();
        })
      }
    >
      <planeGeometry args={[door.width, door.height]} />
      <meshStandardMaterial key={texture?.uuid ?? "loading"} map={texture ?? undefined} transparent alphaTest={0.05} side={DoubleSide} roughness={0.5} />
    </mesh>
  );
}

/** A window on a wall face: its cut-out image (transparent background) at its real size, just in front of the face. */
function WindowDecal({
  win,
  wall,
  ghost = false,
  invalid = false,
  onClick,
}: {
  win: PlacedWindow;
  wall: PlanGeometry["walls"][number];
  ghost?: boolean;
  invalid?: boolean;
  onClick?: () => void;
}) {
  const texture = usePaintTexture(win.image_url);
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const len = Math.hypot(dx, dz) || 1;
  const [ux, uz] = [dx / len, dz / len];
  const s = win.side === "L" ? 1 : -1;
  const off = wall.thickness / 2 + 0.004; // in front of the face, never inside it
  const x = wall.start[0] + ux * win.along + -uz * off * s;
  const z = wall.start[1] + uz * win.along + ux * off * s;
  const angle = Math.atan2(dz, dx);
  return (
    // A plane faces +Z; the wall's left face normal is +Z after rotation.y = −angle (right face: + π).
    <mesh
      position={[x, win.y, z]}
      rotation={[0, -angle + (s === 1 ? 0 : Math.PI), 0]}
      raycast={ghost ? () => undefined : undefined}
      onClick={
        onClick &&
        ((event) => {
          event.stopPropagation();
          onClick();
        })
      }
    >
      <planeGeometry args={[win.width, win.height]} />
      <meshStandardMaterial
        key={texture?.uuid ?? "loading"}
        map={texture ?? undefined}
        color={invalid ? "#ef4444" : "#ffffff"}
        transparent
        opacity={ghost ? 0.6 : 1}
        alphaTest={ghost ? 0 : 0.05}
        depthWrite={!ghost}
        roughness={0.4}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  );
}

/** Wall border lines: dark enough to read on light paint, soft on dark finishes. */
/** Skirting board: off-white, 9 cm high, 1.5 cm proud of the wall face. */
const SKIRT = "#f4f1ea";
const SKIRT_H = 0.09;
const SKIRT_T = 0.015;

const paintTextures = new Map<string, Texture>();

/** Vendor texture by URL, loaded once and shared; null until it has loaded. */
function usePaintTexture(url: string | null | undefined) {
  const [, loaded] = useState(0);
  useEffect(() => {
    if (!url || paintTextures.has(url)) return;
    let live = true;
    new TextureLoader().load(url, (texture) => {
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.colorSpace = SRGBColorSpace;
      paintTextures.set(url, texture);
      if (live) loaded((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return url ? paintTextures.get(url) ?? null : null;
}

function WallMesh({
  wall,
  sides,
  paints: [leftPaint, rightPaint],
  onPaint,
  skirting = false,
  onFacePoint,
}: {
  wall: PlanGeometry["walls"][number];
  sides: [string | null, string | null];
  /** Vendor paint on the left / right face, overriding the room finish. */
  paints: [WallPaint | undefined, WallPaint | undefined];
  onPaint?: (side: "L" | "R") => void;
  /** Skirting boards on the room-facing faces (3D views). */
  skirting?: boolean;
  /** Window placement: the hovered / clicked point on a long face, as distance along the wall and height. */
  onFacePoint?: (side: "L" | "R", along: number, y: number, click: boolean) => void;
}) {
  const leftTex = usePaintTexture(leftPaint?.texture_url);
  const rightTex = usePaintTexture(rightPaint?.texture_url);
  const length = wall.length || Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0]);
  // Each long face takes the finish of the room it faces (tile in wet rooms, paint elsewhere,
  // brick outside). Textures are cloned per face so tiles/bricks repeat at their real size.
  const materials = useMemo(() => {
    const face = (kind: string | null, w: number, h: number) => {
      const finish = kind ? finishFor(kind) : FACADE;
      const tex = wallTexture(finish);
      if (!tex) return { color: finish.wall, map: null };
      const map = tex.texture.clone();
      map.repeat.set(w / tex.span[0], h / tex.span[1]);
      // Lintels/sills: keep courses aligned with the floor, not the piece's own bottom edge.
      map.offset.set(0, ((wall.elevation ?? 0) % tex.span[1]) / tex.span[1]);
      map.needsUpdate = true;
      return { color: "#ffffff", map };
    };
    const painted = (paint: WallPaint, tex: Texture | null, w: number, h: number) => {
      if (!tex) return { color: paint.color, map: null }; // flat colour, or texture still loading
      const map = tex.clone();
      const [tw, th] = tileSize(paint);
      map.repeat.set(w / tw, h / th);
      map.offset.set(0, ((wall.elevation ?? 0) % th) / th);
      map.needsUpdate = true;
      return { color: "#ffffff", map };
    };
    const left = leftPaint ? painted(leftPaint, leftTex, length, wall.height) : face(sides[0], length, wall.height);
    const right = rightPaint ? painted(rightPaint, rightTex, length, wall.height) : face(sides[1], length, wall.height);
    // Door jambs (wall ends) continue the finish of the room on the +Z side.
    const end = face(sides[0] ?? sides[1], wall.thickness, wall.height);
    const top = { color: "#475569", map: null }; // slate cut-wall core: reads like a drawn plan in 2D
    // BoxGeometry material order: +X, −X, +Y, −Y, +Z, −Z.
    return [end, end, top, top, left, right];
  }, [sides, length, wall.height, wall.thickness, wall.elevation, leftPaint, rightPaint, leftTex, rightTex]);
  useEffect(() => () => materials.forEach((m) => m.map?.dispose()), [materials]);
  return (
    <mesh
      position={[(wall.start[0] + wall.end[0]) / 2, (wall.elevation ?? 0) + wall.height / 2, (wall.start[1] + wall.end[1]) / 2]}
      rotation={[0, -angle, 0]}
      castShadow
      onClick={
        onPaint || onFacePoint
          ? (event) => {
              // Long faces only: material 4 is +Z (left of start→end), 5 is −Z (right).
              const index = event.face?.materialIndex;
              if (index !== 4 && index !== 5) return;
              if (event.delta > 5) return; // the end of a drag (orbiting), not a click
              event.stopPropagation();
              const side = index === 4 ? "L" : "R";
              if (onFacePoint) onFacePoint(side, alongWall(wall, event.point.x, event.point.z), event.point.y, true);
              else onPaint?.(side);
            }
          : undefined
      }
      onPointerMove={
        onFacePoint
          ? (event) => {
              const index = event.face?.materialIndex;
              if (index !== 4 && index !== 5) return;
              event.stopPropagation();
              onFacePoint(index === 4 ? "L" : "R", alongWall(wall, event.point.x, event.point.z), event.point.y, false);
            }
          : undefined
      }
    >
      <boxGeometry args={[length, wall.height, wall.thickness]} />
      {materials.map((m, index) => (
        <meshStandardMaterial
          key={`${index}:${m.map?.uuid ?? "flat"}`}
          attach={`material-${index}`}
          color={m.color}
          map={m.map ?? undefined}
          roughness={0.85}
        />
      ))}
      {/* Skirting boards on room-facing faces of full-height walls: a real border at the floor. */}
      {skirting &&
        (wall.elevation ?? 0) === 0 &&
        wall.height >= 1.5 &&
        ([1, -1] as const).map((s, i) =>
          sides[i] ? (
            <mesh key={s} position={[0, -wall.height / 2 + SKIRT_H / 2, s * (wall.thickness / 2 + SKIRT_T / 2)]} raycast={() => undefined}>
              <boxGeometry args={[length, SKIRT_H, SKIRT_T]} />
              <meshStandardMaterial color={SKIRT} roughness={0.45} />
            </mesh>
          ) : null,
        )}
    </mesh>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** R / Shift+R turn about Y, T / Shift+T tilt about X, in 15° steps (ignored while typing). */
/** Rotation keys while placing / moving: Y / T turn about the Y axis, F / V tilt about the X axis (15° steps). */
const ROTATION_KEYS: Record<string, { axis: "x" | "y"; step: number }> = {
  y: { axis: "y", step: 15 },
  t: { axis: "y", step: -15 },
  f: { axis: "x", step: 15 },
  v: { axis: "x", step: -15 },
};

export function rotationKey(event: KeyboardEvent): { axis: "x" | "y"; step: number } | null {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null; // leave browser shortcuts alone
  return ROTATION_KEYS[event.key.toLowerCase()] ?? null;
}

/** Key guide while placing or moving an item: what the click does, the rotation keys, Esc. */
function PlacementGuide({ action, problem }: { action: string; problem?: string | null }) {
  const t = useT();
  const keys: [string[], string][] = [
    [["Y", "T"], "Turn (Y axis)"],
    [["F", "V"], "Tilt (X axis)"],
    [["Esc"], "Cancel"],
  ];
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 flex max-w-[95%] -translate-x-1/2 flex-col items-center gap-1.5 rounded-xl bg-slate-900/80 px-4 py-2.5 text-[11px] text-white shadow-lg backdrop-blur">
      <p className={`text-center text-xs font-medium ${problem ? "text-red-300" : "text-white"}`}>{problem ?? action}</p>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {keys.map(([k, text]) => (
          <span key={text} className="flex items-center gap-1.5">
            {k.map((key, i) => (
              <span key={key} className="flex items-center gap-1">
                {i > 0 && <span className="text-slate-400">/</span>}
                <kbd className="min-w-5 rounded-md border border-white/25 bg-white/10 px-1.5 py-0.5 text-center font-sans text-[10px] font-semibold">{key}</kbd>
              </span>
            ))}
            <span className="text-slate-200">{t(text)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Walk-mode key guide, bottom centre of the viewport. */
function WalkGuide() {
  const t = useT();
  const rows: [string[], string][] = [
    [["W", "A", "S", "D"], "Walk (or arrow keys)"],
    [["R"], "Turn right"],
    [["E"], "Turn left"],
    [["⇧"], "Walk faster"],
    [["Drag"], "Look around (left mouse button)"],
  ];
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-x-4 gap-y-1.5 rounded-xl bg-slate-900/75 px-4 py-2.5 text-[11px] text-white shadow-lg backdrop-blur">
      {rows.map(([keys, text]) => (
        <span key={text} className="flex items-center gap-1.5">
          {keys.map((k) => (
            <kbd key={k} className="min-w-5 rounded-md border border-white/25 bg-white/10 px-1.5 py-0.5 text-center font-sans text-[10px] font-semibold">
              {t(k)}
            </kbd>
          ))}
          <span className="text-slate-200">{t(text)}</span>
        </span>
      ))}
    </div>
  );
}

/** Measurement between two models: an amber line between their nearest points with end ticks and a label. */
function Measurement({ a, b }: { a?: PlacedItem; b?: PlacedItem }) {
  const t = useT();
  if (!a || !b) return null;
  const m = measureBetween(a, b);
  const y = 0.04; // on the floor: reads in 2D and 3D
  const from: [number, number, number] = [m.from.x, y, m.from.z];
  const to: [number, number, number] = [m.to.x, y, m.to.z];
  const dx = m.to.x - m.from.x;
  const dz = m.to.z - m.from.z;
  const len = Math.hypot(dx, dz) || 1;
  const n = { x: (-dz / len) * 0.12, z: (dx / len) * 0.12 };
  const tick = (p: { x: number; z: number }): [number, number, number][] => [
    [p.x + n.x, y, p.z + n.z],
    [p.x - n.x, y, p.z - n.z],
  ];
  return (
    <group>
      {m.gap > 0 && (
        <>
          <Line points={[from, to]} color="#f2a33a" lineWidth={3} dashed dashSize={0.12} gapSize={0.06} />
          <Line points={tick(m.from)} color="#f2a33a" lineWidth={3} />
          <Line points={tick(m.to)} color="#f2a33a" lineWidth={3} />
        </>
      )}
      <Html position={[(m.from.x + m.to.x) / 2, 0.3, (m.from.z + m.to.z) / 2]} center zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
        <div className="whitespace-nowrap rounded-lg bg-brand-navy px-2.5 py-1.5 text-center text-white shadow-lg">
          <p className="text-sm font-semibold tabular-nums">{m.gap > 0 ? t("{d} m apart", { d: m.gap.toFixed(2) }) : t("Touching")}</p>
          <p className="text-[10px] tabular-nums text-slate-300">{m.centres.toFixed(2)} m centre to centre</p>
        </div>
      </Html>
    </group>
  );
}

/** Furniture the vision model found in the drawing: plain grey boxes, never walls, never pickable. */
function Fixtures({ fixtures }: { fixtures?: PlanGeometry["fixtures"] }) {
  if (!fixtures?.length) return null;
  return (
    <group>
      {fixtures.map((f) => (
        <mesh key={f.id} position={[f.position[0], f.size[2] / 2, f.position[1]]} rotation={[0, -((f.rotation_deg || 0) * Math.PI) / 180, 0]} raycast={() => null} castShadow receiveShadow>
          <boxGeometry args={[f.size[0], f.size[2], f.size[1]]} />
          <meshStandardMaterial color="#c9c4ba" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** Room name and size above each room's floor; "≈" marks sizes from an estimated scale. */
function RoomSizeLabels({ geometry, names, sizes }: { geometry: PlanGeometry; names: boolean; sizes: boolean }) {
  const approx = geometry.scale?.estimated ? "≈ " : "";
  const areas = geometry.zones?.length ? geometry.zones : geometry.rooms;
  return (
    <>
      {areas.map((a) => {
        const xs = a.polygon.map((p) => p[0]);
        const zs = a.polygon.map((p) => p[1]);
        const at = ("label_point" in a && a.label_point) || [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
        const w = a.dimensions?.width || Math.max(...xs) - Math.min(...xs);
        const l = a.dimensions?.length || Math.max(...zs) - Math.min(...zs);
        return (
          <Html key={a.id} position={[at[0], 0.05, at[1]]} center zIndexRange={[8, 0]} style={{ pointerEvents: "none" }}>
            <div className="whitespace-nowrap rounded-md bg-white/90 px-2 py-1 text-center text-[11px] leading-tight text-slate-700 shadow-sm ring-1 ring-slate-200">
              {names && <div className="font-semibold text-brand-navy">{a.name}</div>}
              {sizes && <div className="tabular-nums">{approx}{w.toFixed(1)} × {l.toFixed(1)} m</div>}
            </div>
          </Html>
        );
      })}
    </>
  );
}
