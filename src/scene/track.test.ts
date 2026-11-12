import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { railGeometry, sleeperMatrices } from "./track.ts";

test("rails face upward", () => {
  const geometry = railGeometry([
    { x: 0, y: 0, z: 0 },
    { x: 40, y: 0, z: 0 },
    { x: 80, y: 0, z: -8 },
  ]);
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute("normal");
  let up = 0;
  for (let i = 0; i < normal.count; i += 1) up += normal.getY(i);
  assert.ok(up / normal.count > 0.5);
});

test("sleepers lie across a northbound track", () => {
  const matrices = sleeperMatrices([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: -40 },
  ]);
  assert.ok(matrices.length > 3);
  const longAxis = new THREE.Vector3(1, 0, 0).transformDirection(matrices[2]);
  assert.ok(Math.abs(longAxis.x) > 0.9);
  assert.ok(Math.abs(longAxis.y) < 0.05);
});
