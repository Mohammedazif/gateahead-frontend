import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { barrierDrop, chainageKm, placeCamera, sample, toLocal, trainKm, yawFacing } from "./frame.ts";

const origin = { lat: 12, lon: 75 };

test("north is −z and east is +x", () => {
  const north = toLocal({ lat: 12.01, lon: 75 }, origin);
  const east = toLocal({ lat: 12, lon: 75.01 }, origin);
  assert.ok(north.z < -1000);
  assert.ok(Math.abs(north.x) < 1);
  assert.ok(east.x > 1000);
  assert.ok(Math.abs(east.z) < 1);
});

test("a northbound nose uses yaw 0", () => {
  const points = [toLocal(origin, origin), toLocal({ lat: 12.02, lon: 75 }, origin)];
  const { dir } = sample(points, 0.4, 2);
  assert.ok(dir.z < -0.9);
  assert.ok(Math.abs(yawFacing(dir)) < 0.05);
});

test("an eastbound nose yaws so −z lands on +x", () => {
  const points = [toLocal(origin, origin), toLocal({ lat: 12, lon: 75.02 }, origin)];
  const { dir } = sample(points, 0.4, 2);
  assert.ok(dir.x > 0.9);
  assert.ok(Math.abs(yawFacing(dir) + Math.PI / 2) < 0.05);
});

test("chainage of the far end matches the path", () => {
  const points = [toLocal(origin, origin), toLocal({ lat: 12.01, lon: 75 }, origin)];
  const km = chainageKm(points, points[1]);
  assert.ok(Math.abs(km - 1.1057) < 0.02);
});

test("yaw puts the mesh nose on the travel direction", () => {
  for (const dir of [
    { x: 0, y: 0, z: -1 },
    { x: 1, y: 0, z: 0 },
    { x: -0.6, y: 0, z: 0.8 },
  ]) {
    const nose = new THREE.Vector3(0, 0, -1);
    const object = new THREE.Object3D();
    object.rotation.y = yawFacing(dir);
    object.updateMatrixWorld();
    nose.applyQuaternion(object.quaternion);
    const travel = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    assert.ok(nose.dot(travel) > 0.99, `nose ${nose.toArray()} vs ${travel.toArray()}`);
  }
});

test("the camera looks along the track from beside it", () => {
  const look = { x: 0, y: 0, z: -1 };
  const rig = placeCamera({ x: 0, y: 0, z: 0 }, look);
  assert.ok(rig.position.x > 12);
  assert.ok(rig.position.y > 4);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(rig.position.x, rig.position.y, rig.position.z);
  camera.up.set(0, 1, 0);
  camera.lookAt(rig.target.x, rig.target.y, rig.target.z);
  camera.updateMatrixWorld();
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  assert.ok(forward.dot(new THREE.Vector3(look.x, 0, look.z)) > 0.9);
  assert.ok(rig.position.z > 4);
});

test("a lowered boom lies along the track, across the road", () => {
  const arm = new THREE.Object3D();
  arm.rotation.x = barrierDrop(1);
  arm.updateMatrixWorld();
  const tip = new THREE.Vector3(0, 1, 0).applyQuaternion(arm.quaternion);
  assert.ok(tip.z > 0.95);
  assert.ok(Math.abs(tip.x) < 0.05);
  const other = new THREE.Object3D();
  other.rotation.x = barrierDrop(-1);
  other.updateMatrixWorld();
  const back = new THREE.Vector3(0, 1, 0).applyQuaternion(other.quaternion);
  assert.ok(back.z < -0.95);
});

test("a fresh report walks toward the gate and a stale one stays", () => {
  assert.ok(Math.abs(trainKm(0.2, 1.0, 10, 5, false) - 0.6) < 1e-9);
  const capped = trainKm(0.2, 1.0, 10, 100, false);
  assert.ok(Math.abs(capped - (0.2 + 0.8 * 0.97)) < 1e-9);
  assert.equal(trainKm(0.2, 1.0, 10, 5, true), 0.2);
});
