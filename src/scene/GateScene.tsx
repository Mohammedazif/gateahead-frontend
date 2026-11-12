import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { Scene, SceneTrain } from "../api";
import { barrierDrop, chainageKm, placeCamera, polylineLocal, sample, trainKm, yawFacing, type Vec3 } from "./frame";
import { ballastGeometry, railGeometry, sleeperMatrices } from "./track";

type Props = {
  scene: Scene & { crossing: { id: string; name: string; lat: number; lon: number } };
};

const STALE_MIN = 8;

type GateProbe = Window & { __gateNose?: number; __trainX?: number; __barrier?: number };

export function GateScene({ scene }: Props) {
  const { lat, lon } = scene.crossing;
  const points = useMemo(() => polylineLocal(scene.rail, { lat, lon }), [scene.rail, lat, lon]);
  const gateKm = useMemo(() => chainageKm(points, { x: 0, y: 0, z: 0 }), [points]);
  const lead = scene.trains[0];
  const look = useMemo(() => {
    const toward = lead ? lead.along_km : gateKm + 0.2;
    return sample(points, gateKm, toward).dir;
  }, [points, gateKm, lead]);

  return (
    <Canvas
      className="gate-canvas"
      dpr={[1, 1.5]}
      camera={{ fov: 42, near: 0.1, far: 900 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.08;
      }}
    >
      <DuskSky />
      <fog attach="fog" args={["#1b140f", 40, 320]} />
      <hemisphereLight args={["#ffd0a8", "#3a2a22", 0.85]} />
      <directionalLight position={[-36, 28, 18]} intensity={2.4} color="#ffc49a" />
      <directionalLight position={[22, 14, -10]} intensity={0.55} color="#8eb4d8" />
      <CameraRig points={points} gateKm={gateKm} look={look} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <circleGeometry args={[480, 48]} />
        <meshStandardMaterial color="#2a211b" roughness={1} />
      </mesh>
      <Track points={points} />
      <Crossing points={points} gateKm={gateKm} status={lead?.status ?? "open"} />
      {scene.trains.map((train) => (
        <MovingTrain key={train.number} points={points} train={train} gateKm={gateKm} />
      ))}
    </Canvas>
  );
}

function DuskSky() {
  return (
    <mesh frustumCulled={false}>
      <sphereGeometry args={[420, 28, 16]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
        vertexShader={`
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          varying vec3 vPos;
          void main() {
            float h = normalize(vPos).y;
            vec3 horizon = vec3(0.48, 0.24, 0.13);
            vec3 zenith = vec3(0.06, 0.045, 0.07);
            float t = smoothstep(-0.02, 0.55, h);
            gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
          }
        `}
      />
    </mesh>
  );
}

function CameraRig({ points, gateKm, look }: { points: Vec3[]; gateKm: number; look: Vec3 }) {
  const placed = useRef(false);
  useFrame(({ camera }) => {
    if (placed.current) return;
    const at = sample(points, gateKm, gateKm + 0.01).point;
    const rig = placeCamera(at, look);
    camera.position.set(rig.position.x, rig.position.y, rig.position.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(rig.target.x, rig.target.y, rig.target.z);
    placed.current = true;
  });
  return null;
}

function Track({ points }: { points: Vec3[] }) {
  const rails = useMemo(() => railGeometry(points), [points]);
  const ballast = useMemo(() => ballastGeometry(points), [points]);
  const sleepers = useMemo(() => sleeperMatrices(points), [points]);
  useEffect(() => {
    return () => {
      rails.dispose();
      ballast.dispose();
    };
  }, [rails, ballast]);
  return (
    <group>
      <mesh geometry={ballast}>
        <meshStandardMaterial color="#3a342c" roughness={1} />
      </mesh>
      <mesh geometry={rails}>
        <meshStandardMaterial color="#c5c9ce" metalness={0.82} roughness={0.28} />
      </mesh>
      <Sleepers matrices={sleepers} />
    </group>
  );
}

function Sleepers({ matrices }: { matrices: THREE.Matrix4[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);
  if (matrices.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, matrices.length]}>
      <boxGeometry args={[2.6, 0.12, 0.24]} />
      <meshStandardMaterial color="#5c4634" roughness={0.92} />
    </instancedMesh>
  );
}

function Crossing({ points, gateKm, status }: { points: Vec3[]; gateKm: number; status: string }) {
  const at = sample(points, gateKm, gateKm + 0.05);
  const yaw = yawFacing(at.dir);
  return (
    <group position={[at.point.x, 0, at.point.z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[22, 0.05, 7.5]} />
        <meshStandardMaterial color="#3a3d42" roughness={0.62} />
      </mesh>
      <mesh position={[0, 0.085, 0]}>
        <boxGeometry args={[22, 0.012, 0.12]} />
        <meshStandardMaterial color="#e4dcc8" />
      </mesh>
      <mesh position={[0, 0.085, 2.4]}>
        <boxGeometry args={[7, 0.012, 0.18]} />
        <meshStandardMaterial color="#f4f1ea" />
      </mesh>
      <Hut />
      <Lamp />
      <Barrier x={4.8} z={-3.7} status={status} drop={1} />
      <Barrier x={-4.8} z={3.7} status={status} drop={-1} />
    </group>
  );
}

function Hut() {
  return (
    <group position={[-14.5, 0, 8]}>
      <mesh position={[0, 1.15, 0]}>
        <boxGeometry args={[2.4, 2.3, 2.6]} />
        <meshStandardMaterial color="#6a4630" roughness={0.86} />
      </mesh>
      <mesh position={[0, 2.45, 0]}>
        <boxGeometry args={[2.7, 0.18, 2.9]} />
        <meshStandardMaterial color="#3a2a22" />
      </mesh>
      <mesh position={[0, 1.35, 1.32]}>
        <boxGeometry args={[0.7, 0.7, 0.04]} />
        <meshStandardMaterial color="#f0c27a" emissive="#c47a2a" emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

function Lamp() {
  return (
    <group position={[6.4, 0, 5.4]}>
      <mesh position={[0, 2.3, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 4.6, 8]} />
        <meshStandardMaterial color="#d9d3c8" metalness={0.4} roughness={0.45} />
      </mesh>
      <mesh position={[0, 4.55, 0]}>
        <sphereGeometry args={[0.16, 12, 10]} />
        <meshStandardMaterial color="#ffd27a" emissive="#ffbf6b" emissiveIntensity={3} />
      </mesh>
      <pointLight position={[0, 4.5, 0]} intensity={16} distance={32} color="#ffbf6b" />
    </group>
  );
}

function Barrier({ x, z, status, drop }: { x: number; z: number; status: string; drop: 1 | -1 }) {
  const arm = useRef<THREE.Group>(null);
  const down = status === "closed" || status === "closing_soon";
  useFrame((_, delta) => {
    const group = arm.current;
    if (!group) return;
    const target = down ? barrierDrop(drop) : drop * 0.12;
    const step = 1 - Math.exp(-delta * 8);
    group.rotation.x += (target - group.rotation.x) * step;
    if (import.meta.env.DEV && drop > 0) {
      (window as GateProbe).__barrier = group.rotation.x;
    }
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.11, 0.13, 1.1, 10]} />
        <meshStandardMaterial color="#e4dfd4" />
      </mesh>
      <group ref={arm} position={[0, 1.05, 0]}>
        <mesh position={[0, 3.7, 0]}>
          <boxGeometry args={[0.16, 7.4, 0.08]} />
          <meshStandardMaterial color="#f4f1ea" />
        </mesh>
        <mesh position={[0, 1.8, 0.05]}>
          <boxGeometry args={[0.18, 0.7, 0.02]} />
          <meshStandardMaterial color="#c4382f" emissive="#c4382f" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0, 3.6, 0.05]}>
          <boxGeometry args={[0.18, 0.7, 0.02]} />
          <meshStandardMaterial color="#c4382f" emissive="#c4382f" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0, 5.4, 0.05]}>
          <boxGeometry args={[0.18, 0.7, 0.02]} />
          <meshStandardMaterial color="#c4382f" emissive="#c4382f" emissiveIntensity={0.35} />
        </mesh>
      </group>
    </group>
  );
}

function MovingTrain({ points, train, gateKm }: { points: Vec3[]; train: SceneTrain; gateKm: number }) {
  const ref = useRef<THREE.Group>(null);
  const started = useRef(performance.now());
  const probe = useRef({ nose: new THREE.Vector3(), origin: new THREE.Vector3(), travel: new THREE.Vector3() });
  const hold = train.age_min >= STALE_MIN || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const group = ref.current;
    if (!group) return;
    const { point, dir } = sample(points, train.along_km, gateKm);
    group.position.set(point.x, 0, point.z);
    group.rotation.y = yawFacing(dir);
  }, [points, train.along_km, gateKm]);

  useFrame(() => {
    const group = ref.current;
    if (!group) return;
    const elapsed = (performance.now() - started.current) / 60000;
    const { point, dir } = sample(points, trainKm(train.along_km, gateKm, train.eta_min, elapsed, hold), gateKm);
    group.position.set(point.x, 0, point.z);
    group.rotation.y = yawFacing(dir);
    if (import.meta.env.DEV) {
      group.updateMatrixWorld(true);
      const head = group.getObjectByName("headlight");
      if (head) {
        group.getWorldPosition(probe.current.origin);
        head.getWorldPosition(probe.current.nose);
        probe.current.nose.sub(probe.current.origin).setY(0).normalize();
        probe.current.travel.set(dir.x, 0, dir.z);
        (window as GateProbe).__gateNose = probe.current.nose.dot(probe.current.travel);
        (window as GateProbe).__trainX = group.position.x;
      }
    }
  });

  return (
    <group ref={ref}>
      <Locomotive />
    </group>
  );
}

function Locomotive() {
  const light = useRef<THREE.SpotLight>(null);
  const target = useRef<THREE.Object3D>(null);
  useEffect(() => {
    if (light.current && target.current) light.current.target = target.current;
  }, []);
  const body = "#3a74c4";
  const band = "#f3efe4";
  return (
    <group>
      <object3D ref={target} position={[0, 1.5, -28]} />
      <spotLight
        ref={light}
        position={[0, 2.6, -9.1]}
        angle={0.38}
        penumbra={0.5}
        intensity={80}
        distance={150}
        color="#fff6df"
      />
      <Wheels zs={[-5.2, -2.4, 2.2, 5.4, 16.2, 20.8, 29.6, 34.2]} />
      <mesh position={[0, 0.62, 2]}>
        <boxGeometry args={[2.75, 0.28, 18]} />
        <meshStandardMaterial color="#141618" metalness={0.45} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.85, 1.6]}>
        <boxGeometry args={[2.9, 2.15, 13.2]} />
        <meshStandardMaterial color={body} metalness={0.32} roughness={0.45} />
      </mesh>
      <mesh position={[0, 1.55, -6.6]} rotation={[0.38, 0, 0]}>
        <boxGeometry args={[2.72, 1.45, 3.4]} />
        <meshStandardMaterial color={body} metalness={0.32} roughness={0.45} />
      </mesh>
      <mesh position={[0, 2.55, 1.7]}>
        <boxGeometry args={[2.55, 0.22, 11.4]} />
        <meshStandardMaterial color={band} roughness={0.55} />
      </mesh>
      <mesh position={[0, 1.85, -8.55]}>
        <boxGeometry args={[2.15, 0.85, 0.12]} />
        <meshStandardMaterial color="#b9ddff" metalness={0.05} roughness={0.12} />
      </mesh>
      <mesh name="headlight" position={[-0.7, 1.15, -9.05]}>
        <boxGeometry args={[0.42, 0.28, 0.12]} />
        <meshStandardMaterial color="#fff6d8" emissive="#fff1c2" emissiveIntensity={4} toneMapped={false} />
      </mesh>
      <mesh position={[0.7, 1.15, -9.05]}>
        <boxGeometry args={[0.42, 0.28, 0.12]} />
        <meshStandardMaterial color="#fff6d8" emissive="#fff1c2" emissiveIntensity={4} toneMapped={false} />
      </mesh>
      <mesh position={[0, 3.35, 0.6]}>
        <boxGeometry args={[0.06, 0.85, 0.06]} />
        <meshStandardMaterial color="#d5dae0" metalness={0.8} roughness={0.28} />
      </mesh>
      <mesh position={[0, 3.75, 0.6]}>
        <boxGeometry args={[1.35, 0.05, 0.06]} />
        <meshStandardMaterial color="#d5dae0" metalness={0.8} roughness={0.28} />
      </mesh>
      <Coach z={16.4} />
      <Coach z={30.2} />
      <mesh position={[0, 1.7, 36.5]}>
        <boxGeometry args={[0.28, 0.28, 0.08]} />
        <meshStandardMaterial color="#ffb1a4" emissive="#c4382f" emissiveIntensity={1.4} />
      </mesh>
    </group>
  );
}

function Wheels({ zs }: { zs: number[] }) {
  return (
    <>
      {zs.map((z) => (
        <mesh key={z} position={[0, 0.36, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.36, 0.36, 2.55, 14]} />
          <meshStandardMaterial color="#121416" metalness={0.55} roughness={0.4} />
        </mesh>
      ))}
    </>
  );
}

function Coach({ z }: { z: number }) {
  const windows = [-4.2, -1.4, 1.4, 4.2];
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 0.58, 0]}>
        <boxGeometry args={[2.7, 0.22, 12.2]} />
        <meshStandardMaterial color="#141618" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.9, 0]}>
        <boxGeometry args={[3.0, 2.35, 12.6]} />
        <meshStandardMaterial color="#163e68" metalness={0.22} roughness={0.5} />
      </mesh>
      <mesh position={[0, 2.55, 0]}>
        <boxGeometry args={[3.02, 0.16, 12.6]} />
        <meshStandardMaterial color="#f3efe4" />
      </mesh>
      {windows.map((offset) => (
        <mesh key={`r${offset}`} position={[1.52, 1.9, offset]}>
          <boxGeometry args={[0.04, 0.72, 1.15]} />
          <meshStandardMaterial color="#d5ecff" metalness={0.05} roughness={0.08} />
        </mesh>
      ))}
      {windows.map((offset) => (
        <mesh key={`l${offset}`} position={[-1.52, 1.9, offset]}>
          <boxGeometry args={[0.04, 0.72, 1.15]} />
          <meshStandardMaterial color="#d5ecff" metalness={0.05} roughness={0.08} />
        </mesh>
      ))}
    </group>
  );
}
