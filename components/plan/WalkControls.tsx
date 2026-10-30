"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Euler, Quaternion, Vector3 } from "three";
import type { PlanWall } from "@/lib/plan/types";

const EYE = 1.6; // metres
const SPEED = 1.4; // walking pace, m/s
const BODY = 0.22; // keep this far from wall faces
const LOOK = 0.0035; // radians per pixel
const FLY = 1.1; // seconds to fly from the overview into the chosen room
const TURN = Math.PI / 2; // R key turning speed, radians per second (a quarter turn per second)

/**
 * First-person walk-through. Look around only while the LEFT mouse button is held (drag);
 * walk with W/A/S/D or the arrow keys (Shift = faster); hold R to turn right, E to turn left. Walls block, doorways do not: a wall
 * piece blocks only if it reaches below eye height from the floor (door lintels start at 2.1 m).
 */
export function WalkControls({ start, yaw = 0, walls, enabled = true }: { start: [number, number]; yaw?: number; walls: PlanWall[]; enabled?: boolean }) {
  const camera = useThree((s) => s.camera);
  const dom = useThree((s) => s.gl.domElement);
  const look = useRef({ yaw: 0, pitch: 0 });
  const keys = useRef(new Set<string>());
  // Fly-in: from wherever the camera is (overview) down to eye height at the start, then walk.
  const fly = useRef<{ t: number; fromPos: Vector3; fromQuat: Quaternion; toPos: Vector3; toQuat: Quaternion } | null>(null);

  useEffect(() => {
    look.current = { yaw, pitch: 0 };
    fly.current = {
      t: 0,
      fromPos: camera.position.clone(),
      fromQuat: camera.quaternion.clone(),
      toPos: new Vector3(start[0], EYE, start[1]),
      toQuat: new Quaternion().setFromEuler(new Euler(0, yaw, 0, "YXZ")),
    };
  }, [camera, start, yaw]);

  useEffect(() => {
    let dragging = false;
    let last = { x: 0, y: 0 };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return; // left button only
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!dragging || !enabled || (e.buttons & 1) === 0) return;
      look.current.yaw -= (e.clientX - last.x) * LOOK;
      look.current.pitch = Math.max(-1.3, Math.min(1.3, look.current.pitch - (e.clientY - last.y) * LOOK));
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => {
      dragging = false;
    };
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.type === "keydown") keys.current.add(e.key.toLowerCase());
      else keys.current.delete(e.key.toLowerCase());
    };
    const clear = () => keys.current.clear();
    dom.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", clear);
    return () => {
      dom.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", clear);
    };
  }, [dom, enabled]);

  useFrame((state, dt) => {
    const camera = state.camera; // per-frame camera from R3F state, not the render-time value
    const f = fly.current;
    if (f) {
      f.t = Math.min(1, f.t + dt / FLY);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2; // ease in-out
      camera.position.lerpVectors(f.fromPos, f.toPos, e);
      camera.quaternion.slerpQuaternions(f.fromQuat, f.toQuat, e);
      if (f.t >= 1) fly.current = null;
      return; // no walking or looking until the camera has landed
    }
    const k = keys.current;
    // Hold R to turn right on the spot, E to turn left.
    const turn = (k.has("e") ? 1 : 0) - (k.has("r") ? 1 : 0);
    if (enabled && turn) look.current.yaw += turn * TURN * Math.min(dt, 0.1);
    const { yaw, pitch } = look.current;
    camera.quaternion.setFromEuler(new Euler(pitch, yaw, 0, "YXZ"));
    if (!enabled) return;
    const forward = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    const strafe = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
    if (!forward && !strafe) return;
    const step = SPEED * (k.has("shift") ? 2 : 1) * Math.min(dt, 0.1);
    // Camera looks down −Z at yaw 0; walking stays level regardless of pitch.
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const dx = (fx * forward + -fz * strafe) * step;
    const dz = (fz * forward + fx * strafe) * step;
    // Slide along walls: try each axis on its own.
    const p = camera.position;
    if (!blocked(p.x + dx, p.z, walls)) p.x += dx;
    if (!blocked(p.x, p.z + dz, walls)) p.z += dz;
    p.y = EYE;
  });

  return null;
}

function blocked(x: number, z: number, walls: PlanWall[]) {
  for (const w of walls) {
    if ((w.elevation ?? 0) > EYE) continue; // lintel above a doorway
    const [ax, az] = w.start;
    const [bx, bz] = w.end;
    const ex = bx - ax;
    const ez = bz - az;
    const len2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2));
    if (Math.hypot(x - (ax + t * ex), z - (az + t * ez)) < w.thickness / 2 + BODY) return true;
  }
  return false;
}
