import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry
} from "three";

export interface ProceduralSemantics {
  pivots: string[];
  sockets: string[];
  colliders: string[];
}

export const proceduralSemantics: ProceduralSemantics = {
  pivots: ["pivot:root", "pivot:indicator"],
  sockets: ["socket:top"],
  colliders: ["collider:body"]
};

function namedAnchor(name: string, position: [number, number, number]): Object3D {
  const anchor = new Object3D();
  anchor.name = name;
  anchor.position.set(...position);
  return anchor;
}

/**
 * A deterministic, code-only THREE.Group fixture that matches the img2threejs
 * adapter boundary: readable factory output plus named pivots/sockets/colliders.
 * It is repository-authored test data, not a claim that img2threejs generated it.
 */
export function createProceduralFixture(): Group {
  const group = new Group();
  group.name = "procedural-proof";

  const bodyMaterial = new MeshStandardMaterial({ color: 0x2563eb, roughness: 0.55, metalness: 0.08 });
  const accentMaterial = new MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.45, metalness: 0.12 });
  const neutralMaterial = new MeshStandardMaterial({ color: 0x0f172a, roughness: 0.72, metalness: 0.02 });

  const body = new Mesh(new BoxGeometry(1.6, 0.72, 0.8), bodyMaterial);
  body.name = "collider:body";
  group.add(body);

  const indicator = new Mesh(new SphereGeometry(0.22, 16, 12), accentMaterial);
  indicator.name = "pivot:indicator";
  indicator.position.set(0.48, 0.48, 0.12);
  group.add(indicator);

  const mast = new Mesh(new CylinderGeometry(0.08, 0.1, 0.72, 12), neutralMaterial);
  mast.position.set(-0.48, 0.58, 0);
  group.add(mast);

  group.add(namedAnchor("pivot:root", [0, 0, 0]));
  group.add(namedAnchor("socket:top", [-0.48, 0.98, 0]));
  group.userData.proceduralSemantics = proceduralSemantics;
  group.userData.sourceAdapter = "img2threejs-compatible";

  return group;
}

export function disposeProceduralFixture(group: Group): void {
  group.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}
