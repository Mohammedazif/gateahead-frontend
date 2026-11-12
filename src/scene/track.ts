import * as THREE from "three";

import type { Vec3 } from "./frame";

function ribbon(points: Vec3[], halfWidth: number, y: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const rx = (-dz / len) * halfWidth;
    const rz = (dx / len) * halfWidth;
    const p = points[i];
    positions.push(p.x + rx, y, p.z + rz, p.x - rx, y, p.z - rz);
    normals.push(0, 1, 0, 0, 1, 0);
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function railGeometry(points: Vec3[]): THREE.BufferGeometry {
  const left: Vec3[] = [];
  const right: Vec3[] = [];
  const gauge = 0.84;
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const rx = (-dz / len) * gauge;
    const rz = (dx / len) * gauge;
    const p = points[i];
    left.push({ x: p.x + rx, y: 0, z: p.z + rz });
    right.push({ x: p.x - rx, y: 0, z: p.z - rz });
  }
  const a = ribbon(left, 0.045, 0.22);
  const b = ribbon(right, 0.045, 0.22);
  return merge(a, b);
}

export function ballastGeometry(points: Vec3[]): THREE.BufferGeometry {
  return ribbon(points, 1.7, 0.02);
}

function merge(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const pa = a.getAttribute("position");
  const pb = b.getAttribute("position");
  const positions = new Float32Array(pa.count * 3 + pb.count * 3);
  positions.set(pa.array as Float32Array, 0);
  positions.set(pb.array as Float32Array, pa.count * 3);
  const ia = a.getIndex();
  const ib = b.getIndex();
  const indices: number[] = [];
  if (ia && ib) {
    for (let i = 0; i < ia.count; i += 1) indices.push(ia.getX(i));
    for (let i = 0; i < ib.count; i += 1) indices.push(ib.getX(i) + pa.count);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  a.dispose();
  b.dispose();
  return geometry;
}

export function sleeperMatrices(points: Vec3[]): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = [];
  const step = 0.85;
  let walked = 0;
  let nextAt = 0;
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    while (nextAt <= walked + len) {
      const t = (nextAt - walked) / len;
      pos.set(a.x + dx * t, 0.08, a.z + dz * t);
      const tangent = new THREE.Vector3(dx, 0, dz).normalize();
      const across = tangent.clone().cross(up);
      if (across.lengthSq() < 1e-8) {
        nextAt += step;
        continue;
      }
      quat.setFromUnitVectors(new THREE.Vector3(1, 0, 0), across.normalize());
      const matrix = new THREE.Matrix4();
      matrix.compose(pos, quat, new THREE.Vector3(1, 1, 1));
      matrices.push(matrix);
      nextAt += step;
      if (matrices.length > 2400) return matrices;
    }
    walked += len;
  }
  return matrices;
}
