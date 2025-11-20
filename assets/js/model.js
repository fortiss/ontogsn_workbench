// car.js
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import app from "./queries.js";

// RDF / Turtle handling via N3 (global from index.html)
const { Parser, Store, DataFactory, Writer } = N3;
const { namedNode, literal, blankNode } = DataFactory;

// --- RDF constants --------------------------------------------------------

const SCHEMA = "https://schema.org/";
const EX     = "https://example.org/car-demo#";
const RDF    = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XSD    = "http://www.w3.org/2001/XMLSchema#";

// Global-ish state: current car config + clickable meshes
let carConfig = null;
const clickable = [];

// --- TTL → JS: load & parse car.ttl --------------------------------------

async function loadCarConfigFromTTL(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch TTL: ${res.status} ${res.statusText}`);
  }
  const ttl = await res.text();

  const parser = new Parser({ format: "text/turtle" });
  const quads  = parser.parse(ttl);
  const store  = new Store(quads);

  const carNode = namedNode(EX + "car1");

  function getOne(subject, predicate) {
    const objs = store.getObjects(subject, predicate, null);
    return objs.length ? objs[0] : null;
  }

  function getQuantValue(subject, predicateIri) {
    const qv = getOne(subject, namedNode(predicateIri));
    if (!qv) return null;
    const valueNode = getOne(qv, namedNode(SCHEMA + "value"));
    if (!valueNode) return null;
    const num = parseFloat(valueNode.value);
    return Number.isFinite(num) ? num : null;
  }

  function getLiteralFloat(subject, predicateIri, fallback) {
    const obj = getOne(subject, namedNode(predicateIri));
    if (!obj || obj.termType !== "Literal") return fallback;
    const num = parseFloat(obj.value);
    return Number.isFinite(num) ? num : fallback;
  }

  function getLiteralInt(subject, predicateIri, fallback) {
    const obj = getOne(subject, namedNode(predicateIri));
    if (!obj || obj.termType !== "Literal") return fallback;
    const num = parseInt(obj.value, 10);
    return Number.isFinite(num) ? num : fallback;
  }

  const vinNode  = getOne(carNode, namedNode(SCHEMA + "vehicleIdentificationNumber"));
  const nameNode = getOne(carNode, namedNode(SCHEMA + "name"));

  const width  = getQuantValue(carNode, SCHEMA + "width");
  const height = getQuantValue(carNode, SCHEMA + "height");
  const depth  = getQuantValue(carNode, SCHEMA + "depth");

  // Parts (same as before)
  const partPred  = namedNode(EX + "hasPart");
  const partNodes = store.getObjects(carNode, partPred, null);
  const parts = partNodes.map(node => {
    const labelNode = getOne(node, namedNode(SCHEMA + "name"));
    return {
      iri:   node.value,
      label: labelNode ? labelNode.value : node.value
    };
  });

  // --- NEW: wheel geometry from ex:StandardWheel -------------------------
  const wheelTypeNode = namedNode(EX + "StandardWheel");

  const wheelParams = {
    radius:   getLiteralFloat(wheelTypeNode, EX + "radius",   0.4),
    width:    getLiteralFloat(wheelTypeNode, EX + "width",    0.5),
    segments: getLiteralInt  (wheelTypeNode, EX + "segments", 24),
    y:        getLiteralFloat(wheelTypeNode, EX + "y",        0.5),
    offsetX:  getLiteralFloat(wheelTypeNode, EX + "offsetX",  1.4),
    offsetZ:  getLiteralFloat(wheelTypeNode, EX + "offsetZ",  0.85)
  };

  // --- Geometry for body / bumper / doors / cabin from ex:car1 ----------
  const geometry = {
    // Body (matches your ex:bodyLength, ex:bodyHeight, ex:bodyDepth, ex:bodyCenterY)
    BODY_LENGTH:   getLiteralFloat(carNode, EX + "bodyLength",   4.54),
    BODY_HEIGHT:   getLiteralFloat(carNode, EX + "bodyHeight",   0.75),
    BODY_DEPTH:    getLiteralFloat(carNode, EX + "bodyDepth",    2.0),
    BODY_CENTER_Y: getLiteralFloat(carNode, EX + "bodyCenterY",  0.9),

    // Bumper
    BUMPER_THICKNESS_X: getLiteralFloat(carNode, EX + "bumperThicknessX", 0.05),
    BUMPER_HEIGHT_Y:    getLiteralFloat(carNode, EX + "bumperHeightY",    0.10),
    BUMPER_DEPTH_Z:     getLiteralFloat(carNode, EX + "bumperDepthZ",     1.80),

    // Doors (note: TTL uses ex:doorDepthOffset, we map that to DOOR_Z_OFFSET)
    DOOR_BOTTOM_Y: getLiteralFloat(carNode, EX + "doorBottomY",    0.525),
    DOOR_TOP_Y:    getLiteralFloat(carNode, EX + "doorTopY",       1.28),
    DOOR_FRONT_X:  getLiteralFloat(carNode, EX + "doorFrontX",     0.9),
    DOOR_BACK_X:   getLiteralFloat(carNode, EX + "doorBackX",     -0.4),
    DOOR_DEPTH_Z:  getLiteralFloat(carNode, EX + "doorDepthZ",     0.12),
    DOOR_Z_OFFSET: getLiteralFloat(carNode, EX + "doorDepthOffset",0.95),

    // Cabin – you don’t yet have these in TTL, so we keep JS defaults for now
    CABIN_WIDTH_X:   2.15,
    CABIN_HEIGHT_Y:  0.80,
    CABIN_DEPTH_Z:   1.70,
    CABIN_CENTER_X: -0.50,
    CABIN_CENTER_Y:  1.55
  };

  return {
    store,
    carNode,
    vin:  vinNode  ? vinNode.value  : null,
    name: nameNode ? nameNode.value : null,
    dimensions: { width, height, depth },
    parts,
    wheelParams,
    geometry
  };
}


// Look up a part IRI by its schema:name label
function findPartIriByName(name) {
  if (!carConfig || !carConfig.parts) return null;
  const part = carConfig.parts.find(p => p.label === name);
  return part ? part.iri : null;
}

// --- Three.js scene creation ----------------------------------------------

function createCarScene(config) {
  clickable.length = 0;
  const g = config.geometry;

  // ---------- CONFIG / CONSTANTS ----------

  const LICENSE_PLATE_TEXT = config.vin || "0N7065N";

  // Body
  const BODY_LENGTH   = g.BODY_LENGTH;
  const BODY_HEIGHT   = g.BODY_HEIGHT;
  const BODY_DEPTH    = g.BODY_DEPTH;
  const BODY_CENTER_Y = g.BODY_CENTER_Y;
  const BODY_FRONT_X  = BODY_LENGTH / 2;
  const BODY_BOTTOM_Y = BODY_CENTER_Y - BODY_HEIGHT / 2;
  // Bumper
  const BUMPER_THICKNESS_X = g.BUMPER_THICKNESS_X;
  const BUMPER_HEIGHT_Y    = g.BUMPER_HEIGHT_Y;
  const BUMPER_DEPTH_Z     = g.BUMPER_DEPTH_Z;
  // Wheels
  const wp = config.wheelParams || {};
  const WHEEL_RADIUS   = wp.radius   != null ? wp.radius   : 0.4;
  const WHEEL_WIDTH    = wp.width    != null ? wp.width    : 0.5;
  const WHEEL_SEGMENTS = wp.segments != null ? wp.segments : 24;
  const WHEEL_Y        = wp.y        != null ? wp.y        : 0.5;
  const WHEEL_OFFSET_X = wp.offsetX  != null ? wp.offsetX  : 1.4;
  const WHEEL_OFFSET_Z = wp.offsetZ  != null ? wp.offsetZ  : 0.85;
  // Doors
  const DOOR_BOTTOM_Y = g.DOOR_BOTTOM_Y;
  const DOOR_TOP_Y    = g.DOOR_TOP_Y;
  const DOOR_FRONT_X  = g.DOOR_FRONT_X;
  const DOOR_BACK_X   = g.DOOR_BACK_X;
  const DOOR_DEPTH_Z  = g.DOOR_DEPTH_Z;
  const DOOR_Z_OFFSET = g.DOOR_Z_OFFSET;
  // Cabin
  const CABIN_WIDTH_X  = g.CABIN_WIDTH_X;
  const CABIN_HEIGHT_Y = g.CABIN_HEIGHT_Y;
  const CABIN_DEPTH_Z  = g.CABIN_DEPTH_Z;
  const CABIN_CENTER_X = g.CABIN_CENTER_X;
  const CABIN_CENTER_Y = g.CABIN_CENTER_Y;

  // ---------- DOM / RENDERER / CAMERA ----------

  const container = document.getElementById("scene-container");

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0xffffff, 1);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const aspect = container.clientWidth / container.clientHeight;
  const d = 2.3;

  const ortho_left   = -d * aspect;
  const ortho_right  =  d * aspect;
  const ortho_top    =  d;
  const ortho_bottom = -d;
  const ortho_near   = 0.1;
  const ortho_far    = 100;

  const camera = new THREE.OrthographicCamera(ortho_left, 
                                              ortho_right, 
                                              ortho_top, 
                                              ortho_bottom, 
                                              ortho_near, 
                                              ortho_far);

  camera.position.set(6, 5, 6);
  camera.lookAt(0, 1, 0);

  // ---------- INTERACTION (RAYCASTING) ----------

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let selectedMesh = null;
  const selectedOriginalColor = new THREE.Color();
  const infoEl = document.getElementById("part-label");

  // ---------- LIGHTS ----------

  scene.add(new THREE.AmbientLight(0x888888));

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  // ---------- MATERIALS ----------

  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });

  const baseFillMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });

  // ---------- CAR GROUP & HELPERS ----------

  const car = new THREE.Group();
  scene.add(car);

  // generic "filled box + outline" builder, now with optional IRI
  function outlinedBox(geometry, position, label, iri = null) {
    const mesh = new THREE.Mesh(geometry, baseFillMaterial.clone());
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      edgeMaterial
    );

    mesh.position.copy(position);
    edges.position.copy(position);

    car.add(mesh);
    car.add(edges);

    mesh.userData.label = label;
    mesh.userData.iri   = iri;
    clickable.push(mesh);

    return mesh;
  }

  // ---------- LICENSE PLATE ----------

  function addFrontLicensePlate(text) {
    const plateWidth = 0.7;
    const plateHeight = 0.15;

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");

    // background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // text
    ctx.fillStyle = "#000000";
    ctx.font = 'bold 100px "Courier New", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const plateMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide
    });

    const plateGeometry = new THREE.PlaneGeometry(plateWidth, plateHeight);
    const plateMesh = new THREE.Mesh(plateGeometry, plateMaterial);

    const plateEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(plateGeometry),
      edgeMaterial
    );
    plateMesh.add(plateEdges);

    // plate sits slightly in front of the bumper
    const bumperCenterX = BODY_FRONT_X + BUMPER_THICKNESS_X / 2;
    const plateOffsetX = 0.03;

    const plateCenterX = bumperCenterX + BUMPER_THICKNESS_X / 2 + plateOffsetX;
    const plateCenterY = BODY_BOTTOM_Y + 0.22;
    const plateCenterZ = 0;

    plateMesh.position.set(plateCenterX, plateCenterY, plateCenterZ);
    plateMesh.rotation.y = Math.PI / 2; // face +X

    plateMesh.userData.label = "Front license plate";
    plateMesh.userData.iri   = findPartIriByName("Front license plate");
    clickable.push(plateMesh);

    car.add(plateMesh);
  }

  // ---------- CAR GEOMETRY ----------

  // Body
  const bodyGeometry = new THREE.BoxGeometry(BODY_LENGTH, BODY_HEIGHT, BODY_DEPTH);
  outlinedBox(
    bodyGeometry,
    new THREE.Vector3(0, BODY_CENTER_Y, 0),
    "Body",
    findPartIriByName("Body")
  );

  // Cabin
  const cabinGeometry = new THREE.BoxGeometry(
    CABIN_WIDTH_X,
    CABIN_HEIGHT_Y,
    CABIN_DEPTH_Z
  );
  outlinedBox(
    cabinGeometry,
    new THREE.Vector3(CABIN_CENTER_X, CABIN_CENTER_Y, 0),
    "Cabin",
    findPartIriByName("Cabin")
  );

  // Windshields
  const frontWindGeom = new THREE.BoxGeometry(1.0, 0.45, 1.66);
  frontWindGeom.rotateZ(Math.PI / 1.4);
  outlinedBox(
    frontWindGeom,
    new THREE.Vector3(1.2 - 0.5, 1.41, 0),
    "Front windshield",
    findPartIriByName("Front windshield")
  );

  const rearWindGeom = new THREE.BoxGeometry(1.0, 0.45, 1.66);
  rearWindGeom.rotateZ(-Math.PI / 1.4);
  outlinedBox(
    rearWindGeom,
    new THREE.Vector3(-1.2 - 0.5, 1.4, 0),
    "Rear windshield",
    findPartIriByName("Rear windshield")
  );

  // Lights
  const frontLightGeom = new THREE.BoxGeometry(0.15, 0.25, 0.35);
  const rearLightGeom = new THREE.BoxGeometry(0.15, 0.25, 0.35);

  outlinedBox(
    frontLightGeom,
    new THREE.Vector3(2.25, 0.85, 0.7),
    "Front-right light",
    findPartIriByName("Front-right light")
  );
  outlinedBox(
    frontLightGeom,
    new THREE.Vector3(2.25, 0.85, -0.7),
    "Front-left light",
    findPartIriByName("Front-left light")
  );

  outlinedBox(
    rearLightGeom,
    new THREE.Vector3(-2.25, 0.85, 0.7),
    "Rear-right light",
    findPartIriByName("Rear-right light")
  );
  outlinedBox(
    rearLightGeom,
    new THREE.Vector3(-2.25, 0.85, -0.7),
    "Rear-left light",
    findPartIriByName("Rear-left light")
  );

  // Front bumper
  const bumperGeom = new THREE.BoxGeometry(
    BUMPER_THICKNESS_X,
    BUMPER_HEIGHT_Y,
    BUMPER_DEPTH_Z
  );

  const bumperCenterX = BODY_FRONT_X + BUMPER_THICKNESS_X / 2;
  const bumperCenterY = 0.575;
  const bumperCenterZ = 0;

  outlinedBox(
    bumperGeom,
    new THREE.Vector3(bumperCenterX, bumperCenterY, bumperCenterZ),
    "Front bumper",
    findPartIriByName("Front bumper")
  );

  // License plate
  addFrontLicensePlate(LICENSE_PLATE_TEXT);

  // Wheels
  const wheelGeometry = new THREE.CylinderGeometry(
    WHEEL_RADIUS,
    WHEEL_RADIUS,
    WHEEL_WIDTH,
    WHEEL_SEGMENTS
  );
  wheelGeometry.rotateZ(Math.PI / 2);
  wheelGeometry.rotateY(Math.PI / 2);

  const wheelEdgesGeometry = new THREE.EdgesGeometry(wheelGeometry);

  const wheelFillMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  });

  function addWheel(x, z, label, iri = null) {
    const wheelMesh = new THREE.Mesh(wheelGeometry, wheelFillMaterial.clone());
    wheelMesh.position.set(x, WHEEL_Y, z);
    car.add(wheelMesh);

    const wheelLines = new THREE.LineSegments(
      wheelEdgesGeometry,
      edgeMaterial
    );
    wheelLines.position.set(x, WHEEL_Y, z);
    car.add(wheelLines);

    wheelMesh.userData.label = label;
    wheelMesh.userData.iri   = iri;
    clickable.push(wheelMesh);
  }

  addWheel(-WHEEL_OFFSET_X, -WHEEL_OFFSET_Z, "Front-left wheel",
    findPartIriByName("Front-left wheel"));
  addWheel( WHEEL_OFFSET_X, -WHEEL_OFFSET_Z, "Front-right wheel",
    findPartIriByName("Front-right wheel"));
  addWheel(-WHEEL_OFFSET_X,  WHEEL_OFFSET_Z, "Rear-left wheel",
    findPartIriByName("Rear-left wheel"));
  addWheel( WHEEL_OFFSET_X,  WHEEL_OFFSET_Z, "Rear-right wheel",
    findPartIriByName("Rear-right wheel"));

  // Doors
  function addDoorBox(zSide, label) {
    const doorWidthX  = DOOR_FRONT_X - DOOR_BACK_X;
    const doorHeightY = DOOR_TOP_Y   - DOOR_BOTTOM_Y;

    const centerX = (DOOR_FRONT_X + DOOR_BACK_X) / 2 - 0.32;
    const centerY = (DOOR_TOP_Y + DOOR_BOTTOM_Y) / 2;

    const sideOffset = zSide > 0 ? zSide + 0.01 : zSide - 0.01;

    const doorGeom = new THREE.BoxGeometry(
      doorWidthX,
      doorHeightY,
      DOOR_DEPTH_Z
    );
    outlinedBox(
      doorGeom,
      new THREE.Vector3(centerX, centerY, sideOffset),
      label,
      findPartIriByName(label)
    );

    // handle as thin box
    const handleFrontX   = 0.7;
    const handleBackX    = 0.4;
    const handleCenterX  = (handleFrontX + handleBackX) / 2 - 0.3;
    const handleWidthX   = handleFrontX - handleBackX;
    const handleHeightY  = 0.06;
    const handleDepthZ   = DOOR_DEPTH_Z + 0.02;

    const handleGeom = new THREE.BoxGeometry(
      handleWidthX,
      handleHeightY,
      handleDepthZ
    );

    outlinedBox(
      handleGeom,
      new THREE.Vector3(handleCenterX, 1.1, sideOffset),
      label + " handle",
      findPartIriByName(label + " handle")
    );
  }

  addDoorBox( DOOR_Z_OFFSET,  "Right door");
  addDoorBox(-DOOR_Z_OFFSET, "Left door");

  // Mirrors
  function addMirror(zSide, label) {
    const mirrorY = DOOR_TOP_Y + 0.05;
    const mirrorX = DOOR_FRONT_X - 0.2;

    const mirrorWidthX  = 0.28;
    const mirrorHeightY = 0.16;
    const mirrorDepthZ  = 0.1;

    const sideOffset = zSide > 0 ? zSide + 0.18 : zSide - 0.18;

    const mirrorGeom = new THREE.BoxGeometry(
      mirrorWidthX,
      mirrorHeightY,
      mirrorDepthZ
    );
    outlinedBox(
      mirrorGeom,
      new THREE.Vector3(mirrorX, mirrorY, sideOffset),
      label,
      findPartIriByName(label)
    );

    // stem
    const stemWidthX  = 0.08;
    const stemHeightY = 0.08;
    const stemDepthZ  = 0.18;
    const stemZ       = zSide > 0 ? zSide + 0.09 : zSide - 0.09;

    const stemGeom = new THREE.BoxGeometry(
      stemWidthX,
      stemHeightY,
      stemDepthZ
    );
    outlinedBox(
      stemGeom,
      new THREE.Vector3(mirrorX - 0.08, mirrorY - 0.05, stemZ),
      label + " stem",
      findPartIriByName(label + " stem")
    );
  }

  addMirror( DOOR_Z_OFFSET,  "Right mirror");
  addMirror(-DOOR_Z_OFFSET, "Left mirror");

  // Side windows (derived from door + cabin geometry)
  function addSideWindow(zSide, label) {
    const doorWidthX = DOOR_FRONT_X - DOOR_BACK_X;

    const windowWidthX  = doorWidthX - 0.1;
    const windowHeightY = 0.65;

    const windowCenterX =
      ((DOOR_FRONT_X + DOOR_BACK_X) / 2) - 0.32;

    const windowCenterY = DOOR_TOP_Y + windowHeightY / 2 - 0.05;

    const windowDepthZ = 0.07;
    const sideOffset   = zSide > 0 ? zSide - 0.1 : zSide + 0.1;

    const windowGeom = new THREE.BoxGeometry(
      windowWidthX,
      windowHeightY,
      windowDepthZ
    );

    const windowMesh = outlinedBox(
      windowGeom,
      new THREE.Vector3(windowCenterX, windowCenterY, sideOffset),
      label
    );

    windowMesh.material.color.set(0xffffff);
    windowMesh.material.transparent = true;
    windowMesh.material.opacity = 0.5;

    return windowMesh;
  }

  addSideWindow( DOOR_Z_OFFSET,  "Right side window");
  addSideWindow(-DOOR_Z_OFFSET, "Left side window");

  // ---------- CONTROLS ----------

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.8, 0);
  controls.update();

  // ---------- EVENTS ----------

  function onWindowResize() {
    const width  = container.clientWidth;
    const height = container.clientHeight;
    camera.left  = -d * (width / height);
    camera.right =  d * (width / height);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  window.addEventListener("resize", onWindowResize);

  renderer.domElement.addEventListener("pointerdown", onPointerDown);

  function onPointerDown(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(clickable, false);

    if (intersects.length === 0) return;

    const mesh = intersects[0].object;

    if (selectedMesh && selectedMesh !== mesh) {
      selectedMesh.material.color.copy(selectedOriginalColor);
    }

    selectedMesh = mesh;
    selectedOriginalColor.copy(mesh.material.color);
    mesh.material.color.set(0xcf4040); // highlight

    if (infoEl) {
      const label = mesh.userData.label || "Unknown part";
      const iri   = mesh.userData.iri;
      infoEl.textContent = iri ? `${label} (${iri})` : label;
    }

    if (mesh.userData.iri) {
      console.log("Clicked RDF resource:", mesh.userData.iri);
    }
  }

  // ---------- ANIMATION LOOP ----------

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}

// --- JS → TTL: export current scene as Turtle -----------------------------

function exportCarSnapshotToTTL() {
  if (!carConfig) {
    return Promise.reject("No carConfig loaded");
  }

  const writer  = new Writer({ prefixes: { schema: SCHEMA, ex: EX } });
  const carNode = carConfig.carNode;

  // Basic car info
  writer.addQuad(carNode,
    namedNode(RDF + "type"),
    namedNode(SCHEMA + "Car")
  );

  if (carConfig.name) {
    writer.addQuad(carNode,
      namedNode(SCHEMA + "name"),
      literal(carConfig.name)
    );
  }

  if (carConfig.vin) {
    writer.addQuad(carNode,
      namedNode(SCHEMA + "vehicleIdentificationNumber"),
      literal(carConfig.vin)
    );
  }

  const dims = carConfig.dimensions;

  function addQuant(predicateIri, value, unitCode) {
    if (value == null) return;
    const qv = blankNode();
    writer.addQuad(carNode, namedNode(predicateIri), qv);
    writer.addQuad(qv,
      namedNode(RDF + "type"),
      namedNode(SCHEMA + "QuantitativeValue")
    );
    writer.addQuad(qv,
      namedNode(SCHEMA + "value"),
      literal(String(value), namedNode(XSD + "float"))
    );
    writer.addQuad(qv,
      namedNode(SCHEMA + "unitCode"),
      literal(unitCode)
    );
  }

  addQuant(SCHEMA + "width",  dims.width,  "MTR");
  addQuant(SCHEMA + "height", dims.height, "MTR");
  addQuant(SCHEMA + "depth",  dims.depth,  "MTR");

  // Geometry parameters back into ex:*
  const geom = carConfig.geometry || {};

  function addGeomFloat(localName, value) {
    if (value == null) return;
    writer.addQuad(carNode,
      namedNode(EX + localName),
      literal(String(value), namedNode(XSD + "float"))
    );
  }

  function addGeomInt(localName, value) {
    if (value == null) return;
    writer.addQuad(carNode,
      namedNode(EX + localName),
      literal(String(value), namedNode(XSD + "int"))
    );
  }

  addGeomFloat("bodyLength",   geom.BODY_LENGTH);
  addGeomFloat("bodyHeight",   geom.BODY_HEIGHT);
  addGeomFloat("bodyDepth",    geom.BODY_DEPTH);
  addGeomFloat("bodyCenterY",  geom.BODY_CENTER_Y);

  addGeomFloat("bumperThicknessX", geom.BUMPER_THICKNESS_X);
  addGeomFloat("bumperHeightY",    geom.BUMPER_HEIGHT_Y);
  addGeomFloat("bumperDepthZ",     geom.BUMPER_DEPTH_Z);

  // if you really want wheel params only on ex:StandardWheel, you can DELETE
  // these next lines; for now I’ll leave them so nothing breaks.
  addGeomFloat("wheelRadius",   geom.WHEEL_RADIUS);
  addGeomFloat("wheelWidth",    geom.WHEEL_WIDTH);
  addGeomInt  ("wheelSegments", geom.WHEEL_SEGMENTS);
  addGeomFloat("wheelY",        geom.WHEEL_Y);
  addGeomFloat("wheelOffsetX",  geom.WHEEL_OFFSET_X);
  addGeomFloat("wheelOffsetZ",  geom.WHEEL_OFFSET_Z);

  addGeomFloat("doorBottomY",     geom.DOOR_BOTTOM_Y);
  addGeomFloat("doorTopY",        geom.DOOR_TOP_Y);
  addGeomFloat("doorFrontX",      geom.DOOR_FRONT_X);
  addGeomFloat("doorBackX",       geom.DOOR_BACK_X);
  addGeomFloat("doorDepthZ",      geom.DOOR_DEPTH_Z);
  addGeomFloat("doorDepthOffset", geom.DOOR_Z_OFFSET);

  addGeomFloat("cabinWidthX",   geom.CABIN_WIDTH_X);
  addGeomFloat("cabinHeightY",  geom.CABIN_HEIGHT_Y);
  addGeomFloat("cabinDepthZ",   geom.CABIN_DEPTH_Z);
  addGeomFloat("cabinCenterX",  geom.CABIN_CENTER_X);
  addGeomFloat("cabinCenterY",  geom.CABIN_CENTER_Y);

  // Parts: only export those that actually have an IRI
  clickable.forEach(mesh => {
    if (!mesh.userData || !mesh.userData.iri) return;
    const partNode = namedNode(mesh.userData.iri);
    writer.addQuad(carNode,
      namedNode(EX + "hasPart"),
      partNode
    );
    if (mesh.userData.label) {
      writer.addQuad(partNode,
        namedNode(SCHEMA + "name"),
        literal(mesh.userData.label)
      );
    }
  });

  return new Promise((resolve, reject) => {
    writer.end((err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// Wire up the "Download TTL" button
function setupDownloadButton() {
  const btn    = document.getElementById("download-ttl");
  const output = document.getElementById("ttl-output");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      const ttl = await exportCarSnapshotToTTL();
      if (output) output.textContent = ttl;

      // Download as file
      const blob = new Blob([ttl], { type: "text/turtle" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = "car-snapshot.ttl";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("TTL export failed:", err);
      if (output) {
        output.textContent = "TTL export failed: " + err;
      }
    }
  });
}

// --- MAIN / INTEGRATION WITH OntoGSN UI ---------------------------------

// Load carConfig once (from TTL if available, otherwise fallback)
async function ensureCarConfig() {
  if (carConfig) return carConfig;

  try {
    // Adjust this path if your car.ttl lives somewhere else
    carConfig = await loadCarConfigFromTTL("/assets/data/car.ttl");
    console.log("Loaded car config from TTL:", carConfig);
  } catch (err) {
    console.error("Failed to load car config from TTL:", err);
    const msg = document.getElementById("status-message");
    if (msg) {msg.textContent = "Could not load car.ttl – check console/logs.";}
  }

  return carConfig;
}

// Public entry point: render the car into the right-hand #graph block
export async function renderModelView({
  mount  = "#graph",
  height = 520
} = {}) {
  const rootEl = typeof mount === "string" ? document.querySelector(mount) : mount;
  if (!rootEl) throw new Error(`Model view: mount "${mount}" not found`);

  // Clean previous GSN graph / layered SVG if present
  if (app?.graphCtl && typeof app.graphCtl.destroy === "function") {
    app.graphCtl.destroy();
    app.graphCtl = null;
  }
  window.graphCtl = null;

  // Inject the car viewer UI into the right-hand block
  rootEl.innerHTML = `
    <div id="scene-container" style="width:100%; height:${height}px;"></div>
    <div id="ui" class="car-ui">
      <div>
        Selected part:
        <span id="part-label">None</span>
      </div>
      <!-- <button id="download-ttl">Download TTL snapshot</button> -->
    </div>
    <pre id="ttl-output" class="car-ttl-output"></pre>
  `;

  // Reset clickable meshes for a fresh scene
  clickable.length = 0;

  const cfg = await ensureCarConfig();
  createCarScene(cfg);
  setupDownloadButton();
}

// Wire the “Model View” button
window.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btn-model-view");
  if (!btn) return;
  btn.addEventListener("click", () => {
    renderModelView();
  });
});
