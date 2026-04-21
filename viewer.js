import * as THREE from "three";
import { SparkControls, SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const HIGHLIGHT_RGB = [255, 196, 64];
const PICK_THRESHOLD_PX = 12;
const BRUSH_APPLY_INTERVAL_MS = 50;
const HISTORY_LIMIT = 50;
const ORBIT_SPEED = 0.005;
const ORBIT_TRANSITION_SPEED = 1.0;
const LOOK_SPEED = 0.004;
const HIDDEN_SPLAT_SCALE = 1e-5;
const SH_C0 = 0.28209479177387814;
const WHEEL_DOLLY_FACTOR = 0.035;
const WHEEL_DOLLY_MIN_STEP = 0.015;
const WHEEL_DOLLY_MAX_UNITS = 2.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101418);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 1000);
camera.position.set(0, 0, 3);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

const infoEl = document.getElementById("info");
const crosshairEl = document.getElementById("crosshair");
const selectionRectEl = document.getElementById("selectionRect");
const brushCursorEl = document.getElementById("brushCursor");
const kfCountEl = document.getElementById("kfCount");
const playStatusEl = document.getElementById("playStatus");

const resSelect = document.getElementById("resSelect");
const fpsInput = document.getElementById("fpsInput");
const durationInput = document.getElementById("durationInput");
const bitrateInput = document.getElementById("bitrateInput");
const exportBtn = document.getElementById("exportBtn");
const exportProgress = document.getElementById("exportProgress");
const exportProgressBar = document.getElementById("exportProgressBar");
const exportStatusEl = document.getElementById("exportStatus");
const exportFrameInfo = document.getElementById("exportFrameInfo");

const toggleEditBtn = document.getElementById("toggleEditBtn");
const resetViewBtn = document.getElementById("resetViewBtn");
const toolButtons = Array.from(document.querySelectorAll(".toolBtn"));
const radiusLabelEl = document.getElementById("radiusLabel");
const radiusInput = document.getElementById("radiusInput");
const editHintEl = document.getElementById("editHint");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const deleteSelectionBtn = document.getElementById("deleteSelectionBtn");
const saveSceneBtn = document.getElementById("saveSceneBtn");
const saveStatusEl = document.getElementById("saveStatus");
const activeToolLabelEl = document.getElementById("activeToolLabel");
const selectionCountEl = document.getElementById("selectionCount");
const deletedCountEl = document.getElementById("deletedCount");

const controls = new SparkControls({ canvas: renderer.domElement });
controls.pointerControls.enable = false;

const markerGeo = new THREE.SphereGeometry(0.03, 16, 16);
const markerMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
const marker = new THREE.Mesh(markerGeo, markerMat);
marker.visible = false;
scene.add(marker);

const raycaster = new THREE.Raycaster();
const orbitTarget = new THREE.Vector3();
const startQuaternion = new THREE.Quaternion();
const tempMatrix = new THREE.Matrix4();
const tempVecA = new THREE.Vector3();
const tempVecB = new THREE.Vector3();
const tempVecC = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();
const tempColor = new THREE.Color();

const keyframes = [];
const kfMarkers = [];
let pathLine = null;
let positionCurve = null;
let playing = false;
let playT = 0;
let playLastTime = 0;
const playSpeed = 0.15;

let exporting = false;
let hasOrbitTarget = false;
let orbitTransition = 0;
let rKeyDown = false;

const editState = {
  ready: false,
  editMode: false,
  activeTool: "picker",
  brushRadiusPx: 24,
  selectionHighlightEnabled: true,
  savingScene: false,
  numSplats: 0,
  worldCenters: null,
  baseCenters: null,
  baseScales: null,
  baseQuaternions: null,
  baseOpacities: null,
  baseColors: null,
  splatData: null,
  selectedMask: null,
  hiddenMask: null,
  selectedCount: 0,
  hiddenCount: 0,
  undoStack: [],
  redoStack: [],
  projectionX: null,
  projectionY: null,
  projectionDepth: null,
  projectionVisible: null
};

const pointerState = {
  action: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  selectionMode: "replace",
  lastBrushApplyTime: 0,
  rectVisible: false
};

const splats = new SplatMesh({
  url: "./model.ply",
  onLoad: (mesh) => {
    console.log("加载完成，splat 数量:", mesh.numSplats);
    const focus = autoFocusMesh(mesh);
    initializeEditing(mesh, focus);
  }
});
splats.quaternion.set(1, 0, 0, 0);
scene.add(splats);

function isInputFocused() {
  const active = document.activeElement;
  return active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName);
}

function opacityToLogit(opacity) {
  const clamped = THREE.MathUtils.clamp(opacity, 1e-6, 1 - 1e-6);
  return Math.log(clamped / (1 - clamped));
}

function getSelectionMode(event) {
  if (event && (event.ctrlKey || event.metaKey)) {
    return "subtract";
  }
  if (event && event.shiftKey) {
    return "add";
  }
  return "replace";
}

function toolLabel(tool) {
  if (tool === "brush") return "Brush";
  return "Picker";
}

function resetPointerControlsState() {
  const pointerControls = controls.pointerControls;
  pointerControls.rotating = null;
  pointerControls.sliding = null;
  pointerControls.dualPress = false;
  pointerControls.scroll.set(0, 0, 0);
  pointerControls.rotateVelocity.set(0, 0, 0);
  pointerControls.moveVelocity.set(0, 0, 0);
}

function updateInfoPanel() {
  const editText = editState.editMode ? `编辑模式: ${toolLabel(editState.activeTool)}` : "编辑模式: 关闭";
  infoEl.title = editText;
}

function updateBrushCursor(clientX = null, clientY = null) {
  const visible = editState.editMode && editState.activeTool === "brush" && clientX !== null && clientY !== null && !exporting;
  if (!visible) {
    brushCursorEl.style.display = "none";
    return;
  }
  const size = editState.brushRadiusPx * 2;
  brushCursorEl.style.width = `${size}px`;
  brushCursorEl.style.height = `${size}px`;
  brushCursorEl.style.left = `${clientX}px`;
  brushCursorEl.style.top = `${clientY}px`;
  brushCursorEl.style.display = "block";
}

function updateSelectionRect(clientX, clientY) {
  const left = Math.min(pointerState.startX, clientX);
  const top = Math.min(pointerState.startY, clientY);
  const width = Math.abs(clientX - pointerState.startX);
  const height = Math.abs(clientY - pointerState.startY);
  selectionRectEl.style.left = `${left}px`;
  selectionRectEl.style.top = `${top}px`;
  selectionRectEl.style.width = `${width}px`;
  selectionRectEl.style.height = `${height}px`;
  selectionRectEl.style.display = width > 2 || height > 2 ? "block" : "none";
  pointerState.rectVisible = selectionRectEl.style.display === "block";
}

function hideSelectionRect() {
  selectionRectEl.style.display = "none";
  pointerState.rectVisible = false;
}

function focusCameraOnBounds(center, size) {
  const radius = Math.max(size.length() * 0.5, 0.1);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const fitDistance = radius / Math.sin(fov / 2);

  camera.getWorldDirection(tempVecA);
  camera.position.copy(center).sub(tempVecA.multiplyScalar(fitDistance * 1.2));
  camera.near = Math.max(0.01, fitDistance / 200);
  camera.far = Math.max(1000, fitDistance * 20);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  orbitTarget.copy(center);
  hasOrbitTarget = true;
  marker.position.copy(center);
  marker.visible = !exporting;
}

function focusVisibleSplats() {
  if (!editState.ready) {
    return false;
  }

  let visibleCount = 0;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < editState.numSplats; index += 1) {
    if (editState.hiddenMask[index]) {
      continue;
    }
    const offset = index * 3;
    const x = editState.worldCenters[offset];
    const y = editState.worldCenters[offset + 1];
    const z = editState.worldCenters[offset + 2];

    sumX += x;
    sumY += y;
    sumZ += z;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
    visibleCount += 1;
  }

  if (visibleCount === 0) {
    return false;
  }

  const center = new THREE.Vector3(sumX / visibleCount, sumY / visibleCount, sumZ / visibleCount);
  const size = new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ);
  focusCameraOnBounds(center, size);

  console.log("Reset 对焦中心:", center.toArray(), "可见 splat 数量:", visibleCount);
  return true;
}

function getVisibleSplatCount() {
  if (!editState.ready) {
    return 0;
  }
  return editState.numSplats - editState.hiddenCount;
}

function downloadBytes(filename, bytes, mimeType) {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function buildVisiblePlyBytes() {
  const visibleCount = getVisibleSplatCount();
  if (visibleCount === 0) {
    throw new Error("没有可保存的 splats");
  }

  const header = [
    "ply",
    "format binary_little_endian 1.0",
    "comment saved from 3dgs-viewer-web",
    `element vertex ${visibleCount}`,
    "property float x",
    "property float y",
    "property float z",
    "property float scale_0",
    "property float scale_1",
    "property float scale_2",
    "property float rot_0",
    "property float rot_1",
    "property float rot_2",
    "property float rot_3",
    "property float opacity",
    "property float f_dc_0",
    "property float f_dc_1",
    "property float f_dc_2",
    "end_header\n"
  ].join("\n");

  const headerBytes = new TextEncoder().encode(header);
  const bytesPerSplat = 56;
  const buffer = new ArrayBuffer(headerBytes.length + visibleCount * bytesPerSplat);
  const u8 = new Uint8Array(buffer);
  u8.set(headerBytes, 0);

  const view = new DataView(buffer, headerBytes.length);
  let offset = 0;

  for (let index = 0; index < editState.numSplats; index += 1) {
    if (editState.hiddenMask[index]) {
      continue;
    }

    const vecOffset = index * 3;
    const quatOffset = index * 4;

    view.setFloat32(offset, editState.baseCenters[vecOffset], true);
    offset += 4;
    view.setFloat32(offset, editState.baseCenters[vecOffset + 1], true);
    offset += 4;
    view.setFloat32(offset, editState.baseCenters[vecOffset + 2], true);
    offset += 4;

    view.setFloat32(offset, Math.log(Math.max(editState.baseScales[vecOffset], 1e-6)), true);
    offset += 4;
    view.setFloat32(offset, Math.log(Math.max(editState.baseScales[vecOffset + 1], 1e-6)), true);
    offset += 4;
    view.setFloat32(offset, Math.log(Math.max(editState.baseScales[vecOffset + 2], 1e-6)), true);
    offset += 4;

    view.setFloat32(offset, editState.baseQuaternions[quatOffset + 3], true);
    offset += 4;
    view.setFloat32(offset, editState.baseQuaternions[quatOffset], true);
    offset += 4;
    view.setFloat32(offset, editState.baseQuaternions[quatOffset + 1], true);
    offset += 4;
    view.setFloat32(offset, editState.baseQuaternions[quatOffset + 2], true);
    offset += 4;

    view.setFloat32(offset, opacityToLogit(editState.baseOpacities[index]), true);
    offset += 4;

    view.setFloat32(offset, (editState.baseColors[vecOffset] - 0.5) / SH_C0, true);
    offset += 4;
    view.setFloat32(offset, (editState.baseColors[vecOffset + 1] - 0.5) / SH_C0, true);
    offset += 4;
    view.setFloat32(offset, (editState.baseColors[vecOffset + 2] - 0.5) / SH_C0, true);
    offset += 4;
  }

  return new Uint8Array(buffer);
}

async function saveEditedScene() {
  if (!editState.ready || editState.savingScene) {
    return;
  }

  const visibleCount = getVisibleSplatCount();
  if (visibleCount === 0) {
    saveStatusEl.textContent = "没有可保存的 splats。";
    return;
  }

  editState.savingScene = true;
  saveStatusEl.textContent = `正在保存... (${visibleCount} splats)`;
  updateEditUi();

  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const plyBytes = buildVisiblePlyBytes();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBytes(`edited_scene_${timestamp}.ply`, plyBytes, "application/octet-stream");
    saveStatusEl.textContent = `已保存 ${visibleCount} 个 splats。`;
  } catch (error) {
    console.error("保存场景失败:", error);
    saveStatusEl.textContent = `保存失败: ${error.message}`;
  } finally {
    editState.savingScene = false;
    updateEditUi();
  }
}

function updateEditUi() {
  toggleEditBtn.textContent = editState.editMode ? "退出编辑 (E)" : "进入编辑 (E)";
  activeToolLabelEl.textContent = toolLabel(editState.activeTool);
  selectionCountEl.textContent = String(editState.selectedCount);
  deletedCountEl.textContent = String(editState.hiddenCount);

  const hasModel = editState.ready;
  const hasVisibleSplats = hasModel && editState.hiddenCount < editState.numSplats;
  const usingRadius = editState.activeTool === "brush";
  radiusLabelEl.textContent = "画笔半径 (px)";
  radiusInput.disabled = !hasModel || !usingRadius;
  resetViewBtn.disabled = !hasVisibleSplats;
  saveSceneBtn.disabled = !hasVisibleSplats || editState.savingScene;
  saveSceneBtn.textContent = editState.savingScene ? "保存中..." : "保存场景 (.ply)";

  radiusInput.min = "1";
  radiusInput.step = "1";
  radiusInput.value = String(Math.round(editState.brushRadiusPx));

  for (const button of toolButtons) {
    const isActive = button.dataset.tool === editState.activeTool;
    button.classList.toggle("active", isActive);
    button.disabled = !hasModel;
  }

  clearSelectionBtn.disabled = !hasModel || editState.selectedCount === 0;
  undoBtn.disabled = !hasModel || editState.undoStack.length === 0;
  redoBtn.disabled = !hasModel || editState.redoStack.length === 0;
  deleteSelectionBtn.disabled = !hasModel || editState.selectedCount === 0;

  if (!hasModel) {
    editHintEl.textContent = "等待模型加载完成。";
  } else if (!editState.editMode) {
    editHintEl.textContent = "按 E 进入编辑模式。进入后左键用于选择，右键/滚轮用于导航。";
  } else if (editState.activeTool === "picker") {
    editHintEl.textContent = "左键单击选点，左键拖拽框选。Shift 加选，Ctrl/Cmd 减选。";
  } else {
    editHintEl.textContent = "左键拖动刷选，按 [ / ] 调整半径。Shift 加选，Ctrl/Cmd 减选。";
  }

  updateInfoPanel();
}

function setActiveTool(tool) {
  editState.activeTool = tool;
  hideSelectionRect();
  updateBrushCursor();
  updateEditUi();
}

function endPointerAction() {
  pointerState.action = null;
  hideSelectionRect();
  crosshairEl.style.display = "none";
}

function setEditMode(enabled) {
  editState.editMode = enabled;
  endPointerAction();
  updateBrushCursor();
  updateEditUi();
}

function autoFocusMesh(mesh) {
  const localBox = mesh.getBoundingBox();
  mesh.updateWorldMatrix(true, false);
  const box = localBox.clone().applyMatrix4(mesh.matrixWorld);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  focusCameraOnBounds(center, size);

  console.log("模型包围盒:", box.min.toArray(), box.max.toArray());
  console.log("自动对焦中心:", center.toArray(), "相机位置:", camera.position.toArray());

  return { box, center, size };
}

function initializeEditing(mesh, focus) {
  const count = mesh.numSplats;
  const worldCenters = new Float32Array(count * 3);
  const baseCenters = new Float32Array(count * 3);
  const baseScales = new Float32Array(count * 3);
  const baseQuaternions = new Float32Array(count * 4);
  const baseOpacities = new Float32Array(count);
  const baseColors = new Float32Array(count * 3);
  const selectedMask = new Uint8Array(count);
  const hiddenMask = new Uint8Array(count);
  const projectionX = new Float32Array(count);
  const projectionY = new Float32Array(count);
  const projectionDepth = new Float32Array(count);
  const projectionVisible = new Uint8Array(count);
  const splatData = mesh.packedSplats ?? mesh.extSplats ?? mesh.splats ?? null;

  mesh.updateWorldMatrix(true, false);
  const worldMatrix = mesh.matrixWorld.clone();
  mesh.forEachSplat((index, center, scales, quaternion, opacity, color) => {
    const baseOffset = index * 3;
    baseCenters[baseOffset] = center.x;
    baseCenters[baseOffset + 1] = center.y;
    baseCenters[baseOffset + 2] = center.z;
    baseScales[baseOffset] = scales.x;
    baseScales[baseOffset + 1] = scales.y;
    baseScales[baseOffset + 2] = scales.z;
    baseColors[baseOffset] = color.r;
    baseColors[baseOffset + 1] = color.g;
    baseColors[baseOffset + 2] = color.b;

    const quatOffset = index * 4;
    baseQuaternions[quatOffset] = quaternion.x;
    baseQuaternions[quatOffset + 1] = quaternion.y;
    baseQuaternions[quatOffset + 2] = quaternion.z;
    baseQuaternions[quatOffset + 3] = quaternion.w;
    baseOpacities[index] = opacity;

    tempVecA.copy(center).applyMatrix4(worldMatrix);
    worldCenters[baseOffset] = tempVecA.x;
    worldCenters[baseOffset + 1] = tempVecA.y;
    worldCenters[baseOffset + 2] = tempVecA.z;
  });

  editState.ready = true;
  editState.numSplats = count;
  editState.worldCenters = worldCenters;
  editState.baseCenters = baseCenters;
  editState.baseScales = baseScales;
  editState.baseQuaternions = baseQuaternions;
  editState.baseOpacities = baseOpacities;
  editState.baseColors = baseColors;
  editState.splatData = splatData;
  editState.selectedMask = selectedMask;
  editState.hiddenMask = hiddenMask;
  editState.selectedCount = 0;
  editState.hiddenCount = 0;
  editState.undoStack.length = 0;
  editState.redoStack.length = 0;
  editState.projectionX = projectionX;
  editState.projectionY = projectionY;
  editState.projectionDepth = projectionDepth;
  editState.projectionVisible = projectionVisible;
  updateEditUi();
}

function applyVisualStateForIndex(index) {
  if (!editState.splatData) {
    return;
  }

  const vecOffset = index * 3;
  const quatOffset = index * 4;

  tempVecA.set(
    editState.baseCenters[vecOffset],
    editState.baseCenters[vecOffset + 1],
    editState.baseCenters[vecOffset + 2]
  );
  tempVecB.set(
    editState.baseScales[vecOffset],
    editState.baseScales[vecOffset + 1],
    editState.baseScales[vecOffset + 2]
  );
  tempQuat.set(
    editState.baseQuaternions[quatOffset],
    editState.baseQuaternions[quatOffset + 1],
    editState.baseQuaternions[quatOffset + 2],
    editState.baseQuaternions[quatOffset + 3]
  );

  if (!editState.hiddenMask[index] && editState.selectedMask[index] && editState.selectionHighlightEnabled) {
    tempColor.setRGB(HIGHLIGHT_RGB[0] / 255, HIGHLIGHT_RGB[1] / 255, HIGHLIGHT_RGB[2] / 255);
  } else {
    tempColor.setRGB(
      editState.baseColors[vecOffset],
      editState.baseColors[vecOffset + 1],
      editState.baseColors[vecOffset + 2]
    );
  }

  if (editState.hiddenMask[index]) {
    tempVecB.set(HIDDEN_SPLAT_SCALE, HIDDEN_SPLAT_SCALE, HIDDEN_SPLAT_SCALE);
  }

  const opacity = editState.hiddenMask[index] ? 0 : editState.baseOpacities[index];
  editState.splatData.setSplat(index, tempVecA, tempVecB, tempQuat, opacity, tempColor);
}

function syncSplatDataAfterMutation() {
  if (!editState.splatData) {
    return;
  }

  if (typeof editState.splatData.updateTextures === "function") {
    editState.splatData.updateTextures();
    for (const texture of editState.splatData.textures ?? []) {
      if (texture && texture.image) {
        texture.needsUpdate = true;
      }
    }
  } else {
    editState.splatData.needsUpdate = true;
    if (editState.splatData.source && editState.splatData.source.image) {
      editState.splatData.source.needsUpdate = true;
    }
  }

  splats.needsUpdate = true;
}

function applyVisualChanges(changedIndices) {
  if (!editState.ready || changedIndices.length === 0) {
    return;
  }
  for (const index of changedIndices) {
    applyVisualStateForIndex(index);
  }
  syncSplatDataAfterMutation();
}

function collectSelectedIndices() {
  const indices = [];
  if (!editState.ready || editState.selectedCount === 0) {
    return indices;
  }
  for (let index = 0; index < editState.numSplats; index += 1) {
    if (editState.selectedMask[index]) {
      indices.push(index);
    }
  }
  return indices;
}

function clearSelection(changedIndices = []) {
  if (!editState.ready || editState.selectedCount === 0) {
    return changedIndices;
  }
  for (let index = 0; index < editState.numSplats; index += 1) {
    if (editState.selectedMask[index]) {
      editState.selectedMask[index] = 0;
      editState.selectedCount -= 1;
      changedIndices.push(index);
    }
  }
  return changedIndices;
}

function setSelected(index, selected, changedIndices) {
  if (!editState.ready) {
    return;
  }
  if (selected && editState.hiddenMask[index]) {
    return;
  }
  const current = editState.selectedMask[index] === 1;
  if (current === selected) {
    return;
  }
  editState.selectedMask[index] = selected ? 1 : 0;
  editState.selectedCount += selected ? 1 : -1;
  changedIndices.push(index);
}

function commitSelectionChange(changedIndices) {
  applyVisualChanges(changedIndices);
  updateEditUi();
}

function deleteSelectedSplats() {
  if (!editState.ready || editState.selectedCount === 0) {
    return;
  }

  const deletedIndices = [];
  for (let index = 0; index < editState.numSplats; index += 1) {
    if (editState.selectedMask[index] && !editState.hiddenMask[index]) {
      editState.selectedMask[index] = 0;
      editState.hiddenMask[index] = 1;
      editState.selectedCount -= 1;
      editState.hiddenCount += 1;
      deletedIndices.push(index);
    }
  }

  if (deletedIndices.length === 0) {
    updateEditUi();
    return;
  }

  editState.undoStack.push({ type: "delete", indices: Uint32Array.from(deletedIndices) });
  if (editState.undoStack.length > HISTORY_LIMIT) {
    editState.undoStack.shift();
  }
  editState.redoStack.length = 0;

  applyVisualChanges(deletedIndices);
  updateEditUi();
}

function undoDelete() {
  const action = editState.undoStack.pop();
  if (!action) {
    return;
  }

  const changedIndices = [];
  for (const index of action.indices) {
    if (editState.hiddenMask[index]) {
      editState.hiddenMask[index] = 0;
      editState.hiddenCount -= 1;
      changedIndices.push(index);
    }
  }
  editState.redoStack.push(action);
  applyVisualChanges(changedIndices);
  updateEditUi();
}

function redoDelete() {
  const action = editState.redoStack.pop();
  if (!action) {
    return;
  }

  const changedIndices = [];
  for (const index of action.indices) {
    if (!editState.hiddenMask[index]) {
      editState.hiddenMask[index] = 1;
      if (editState.selectedMask[index]) {
        editState.selectedMask[index] = 0;
        editState.selectedCount -= 1;
      }
      editState.hiddenCount += 1;
      changedIndices.push(index);
    }
  }
  editState.undoStack.push(action);
  applyVisualChanges(changedIndices);
  updateEditUi();
}

function projectSplatsToScreen() {
  if (!editState.ready) {
    return false;
  }

  const width = renderer.domElement.clientWidth || innerWidth;
  const height = renderer.domElement.clientHeight || innerHeight;

  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  tempMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = tempMatrix.elements;

  for (let index = 0; index < editState.numSplats; index += 1) {
    const offset = index * 3;
    const x = editState.worldCenters[offset];
    const y = editState.worldCenters[offset + 1];
    const z = editState.worldCenters[offset + 2];

    const clipX = e[0] * x + e[4] * y + e[8] * z + e[12];
    const clipY = e[1] * x + e[5] * y + e[9] * z + e[13];
    const clipZ = e[2] * x + e[6] * y + e[10] * z + e[14];
    const clipW = e[3] * x + e[7] * y + e[11] * z + e[15];

    if (clipW <= 0) {
      editState.projectionVisible[index] = 0;
      continue;
    }

    const invW = 1 / clipW;
    const ndcX = clipX * invW;
    const ndcY = clipY * invW;
    const ndcZ = clipZ * invW;

    editState.projectionX[index] = (ndcX * 0.5 + 0.5) * width;
    editState.projectionY[index] = (-ndcY * 0.5 + 0.5) * height;
    editState.projectionDepth[index] = ndcZ;
    editState.projectionVisible[index] = ndcZ >= -1 && ndcZ <= 1 ? 1 : 0;
  }

  return true;
}

function selectAtScreenPoint(clientX, clientY, selectionMode) {
  if (!projectSplatsToScreen()) {
    return;
  }

  const changedIndices = [];
  if (selectionMode === "replace") {
    clearSelection(changedIndices);
  }

  let bestIndex = -1;
  let bestDistanceSq = PICK_THRESHOLD_PX * PICK_THRESHOLD_PX;
  let bestDepth = Number.POSITIVE_INFINITY;

  for (let index = 0; index < editState.numSplats; index += 1) {
    if (!editState.projectionVisible[index] || editState.hiddenMask[index]) {
      continue;
    }
    const dx = editState.projectionX[index] - clientX;
    const dy = editState.projectionY[index] - clientY;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > bestDistanceSq) {
      continue;
    }
    const depth = editState.projectionDepth[index];
    if (distanceSq < bestDistanceSq || depth < bestDepth) {
      bestIndex = index;
      bestDistanceSq = distanceSq;
      bestDepth = depth;
    }
  }

  if (bestIndex !== -1) {
    setSelected(bestIndex, selectionMode !== "subtract", changedIndices);
  }
  commitSelectionChange(changedIndices);
}

function selectInRectangle(x0, y0, x1, y1, selectionMode) {
  if (!projectSplatsToScreen()) {
    return;
  }

  const changedIndices = [];
  if (selectionMode === "replace") {
    clearSelection(changedIndices);
  }

  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const add = selectionMode !== "subtract";

  for (let index = 0; index < editState.numSplats; index += 1) {
    if (!editState.projectionVisible[index] || editState.hiddenMask[index]) {
      continue;
    }
    const px = editState.projectionX[index];
    const py = editState.projectionY[index];
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
      setSelected(index, add, changedIndices);
    }
  }

  commitSelectionChange(changedIndices);
}

function applyBrushSelection(clientX, clientY) {
  if (!editState.ready) {
    return;
  }

  const radiusSq = editState.brushRadiusPx * editState.brushRadiusPx;
  const add = pointerState.selectionMode !== "subtract";
  const changedIndices = [];

  for (let index = 0; index < editState.numSplats; index += 1) {
    if (!editState.projectionVisible[index] || editState.hiddenMask[index]) {
      continue;
    }

    const dx = editState.projectionX[index] - clientX;
    const dy = editState.projectionY[index] - clientY;
    if (dx * dx + dy * dy <= radiusSq) {
      setSelected(index, add, changedIndices);
    }
  }

  commitSelectionChange(changedIndices);
}

function setOrbitTarget(point) {
  orbitTarget.copy(point);
  hasOrbitTarget = true;
  marker.position.copy(point);
  if (!exporting) {
    marker.visible = true;
  }
}

function pickScenePoint(event) {
  const ndc = new THREE.Vector2(
    (event.clientX / innerWidth) * 2 - 1,
    -(event.clientY / innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const intersects = raycaster.intersectObjects(scene.children);
  return intersects.find((item) => item.object instanceof SplatMesh || item.object === splats) || null;
}

function beginOrbit(event) {
  pointerState.action = "orbit";
  pointerState.lastX = event.clientX;
  pointerState.lastY = event.clientY;
  orbitTransition = 0;
  startQuaternion.copy(camera.quaternion);

  const projected = orbitTarget.clone().project(camera);
  crosshairEl.style.left = `${((projected.x + 1) / 2) * innerWidth}px`;
  crosshairEl.style.top = `${((-projected.y + 1) / 2) * innerHeight}px`;
  crosshairEl.style.display = "block";
}

function updateOrbit(event) {
  const deltaX = event.clientX - pointerState.lastX;
  const deltaY = event.clientY - pointerState.lastY;
  pointerState.lastX = event.clientX;
  pointerState.lastY = event.clientY;

  const offset = camera.position.clone().sub(orbitTarget);
  const azimuth = -deltaX * ORBIT_SPEED;
  const cosA = Math.cos(azimuth);
  const sinA = Math.sin(azimuth);
  const newX = offset.x * cosA - offset.z * sinA;
  const newZ = offset.x * sinA + offset.z * cosA;
  offset.x = newX;
  offset.z = newZ;

  const elevation = -deltaY * ORBIT_SPEED;
  const horizontalDist = Math.sqrt(offset.x * offset.x + offset.z * offset.z);
  const currentElevAngle = Math.atan2(offset.y, horizontalDist);
  const nextElevAngle = THREE.MathUtils.clamp(
    currentElevAngle + elevation,
    -Math.PI / 2 + 0.05,
    Math.PI / 2 - 0.05
  );
  const radius = offset.length();
  offset.y = radius * Math.sin(nextElevAngle);
  const nextHorizontalDist = radius * Math.cos(nextElevAngle);
  const scale = horizontalDist > 0.001 ? nextHorizontalDist / horizontalDist : 0;
  offset.x *= scale;
  offset.z *= scale;

  camera.position.copy(orbitTarget).add(offset);

  const lookAtMatrix = new THREE.Matrix4().lookAt(camera.position, orbitTarget, camera.up);
  tempQuat.setFromRotationMatrix(lookAtMatrix);

  if (orbitTransition < 1) {
    orbitTransition = Math.min(1, orbitTransition + ORBIT_TRANSITION_SPEED * 0.016);
    camera.quaternion.slerpQuaternions(startQuaternion, tempQuat, orbitTransition);
  } else {
    camera.quaternion.copy(tempQuat);
  }
}

function beginPan(event) {
  pointerState.action = "pan";
  pointerState.lastX = event.clientX;
  pointerState.lastY = event.clientY;
}

function beginRotate(event) {
  pointerState.action = "rotate";
  pointerState.lastX = event.clientX;
  pointerState.lastY = event.clientY;
}

function updateRotate(event) {
  const deltaX = event.clientX - pointerState.lastX;
  const deltaY = event.clientY - pointerState.lastY;
  pointerState.lastX = event.clientX;
  pointerState.lastY = event.clientY;

  const eulers = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
  eulers.y -= deltaX * LOOK_SPEED;
  eulers.x = THREE.MathUtils.clamp(
    eulers.x - deltaY * LOOK_SPEED,
    -Math.PI / 2 + 0.001,
    Math.PI / 2 - 0.001
  );
  camera.quaternion.setFromEuler(eulers);
}

function updatePan(event) {
  const deltaX = event.clientX - pointerState.lastX;
  const deltaY = event.clientY - pointerState.lastY;
  pointerState.lastX = event.clientX;
  pointerState.lastY = event.clientY;

  const navScale = hasOrbitTarget ? Math.max(camera.position.distanceTo(orbitTarget), 0.5) : 2;
  const panScale = navScale * 0.0025;

  tempVecA.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(-deltaX * panScale);
  tempVecB.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(deltaY * panScale);
  tempVecC.copy(tempVecA).add(tempVecB);

  camera.position.add(tempVecC);
  if (hasOrbitTarget) {
    orbitTarget.add(tempVecC);
    marker.position.copy(orbitTarget);
  }
}

function normalizeWheelDelta(event) {
  let pixelDelta = event.deltaY;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    pixelDelta *= 16;
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    pixelDelta *= innerHeight;
  }
  return THREE.MathUtils.clamp(pixelDelta / 120, -WHEEL_DOLLY_MAX_UNITS, WHEEL_DOLLY_MAX_UNITS);
}

function applyDolly(event) {
  const navScale = hasOrbitTarget ? Math.max(camera.position.distanceTo(orbitTarget), 0.5) : 2;
  const wheelUnits = normalizeWheelDelta(event);
  const moveScale = Math.max(navScale * WHEEL_DOLLY_FACTOR, WHEEL_DOLLY_MIN_STEP);
  camera.getWorldDirection(tempVecA);

  let moveAmount = wheelUnits * moveScale;
  if (hasOrbitTarget && moveAmount > 0) {
    const maxForward = Math.max(camera.position.distanceTo(orbitTarget) - 0.05, 0);
    moveAmount = Math.min(moveAmount, maxForward);
  }

  camera.position.add(tempVecA.multiplyScalar(moveAmount));
}

function handleCanvasMouseDown(event) {
  if (exporting) {
    return;
  }

  if (event.button === 0 && rKeyDown && hasOrbitTarget) {
    beginOrbit(event);
    event.preventDefault();
    return;
  }

  if (event.button === 2) {
    beginPan(event);
    event.preventDefault();
    return;
  }

  if (!editState.editMode || !editState.ready) {
    if (event.button === 0) {
      beginRotate(event);
      event.preventDefault();
    }
    return;
  }

  if (event.button !== 0) {
    return;
  }

  pointerState.startX = event.clientX;
  pointerState.startY = event.clientY;
  pointerState.lastX = event.clientX;
  pointerState.lastY = event.clientY;
  pointerState.selectionMode = getSelectionMode(event);

  if (editState.activeTool === "picker") {
    pointerState.action = "pickerRect";
    hideSelectionRect();
    event.preventDefault();
    return;
  }

  if (editState.activeTool === "brush") {
    pointerState.action = "brush";
    pointerState.lastBrushApplyTime = 0;
    if (pointerState.selectionMode === "replace") {
      const changed = clearSelection([]);
      commitSelectionChange(changed);
    }
    projectSplatsToScreen();
    applyBrushSelection(event.clientX, event.clientY);
    updateBrushCursor(event.clientX, event.clientY);
    event.preventDefault();
  }
}

function handleWindowMouseMove(event) {
  if (pointerState.action === "orbit") {
    updateOrbit(event);
    return;
  }

  if (pointerState.action === "rotate") {
    updateRotate(event);
    return;
  }

  if (pointerState.action === "pan") {
    updatePan(event);
    return;
  }

  if (editState.editMode && editState.activeTool === "brush") {
    updateBrushCursor(event.clientX, event.clientY);
  }

  if (pointerState.action === "pickerRect") {
    updateSelectionRect(event.clientX, event.clientY);
    return;
  }

  if (pointerState.action === "brush") {
    updateBrushCursor(event.clientX, event.clientY);
    const now = performance.now();
    if (now - pointerState.lastBrushApplyTime >= BRUSH_APPLY_INTERVAL_MS) {
      pointerState.lastBrushApplyTime = now;
      applyBrushSelection(event.clientX, event.clientY);
    }
  }
}

function handleWindowMouseUp(event) {
  if (pointerState.action === "orbit") {
    endPointerAction();
    return;
  }

  if (pointerState.action === "rotate") {
    endPointerAction();
    return;
  }

  if (pointerState.action === "pan") {
    endPointerAction();
    return;
  }

  if (pointerState.action === "pickerRect") {
    const distance = Math.hypot(event.clientX - pointerState.startX, event.clientY - pointerState.startY);
    const selectionMode = pointerState.selectionMode;
    endPointerAction();
    if (distance < 4) {
      selectAtScreenPoint(event.clientX, event.clientY, selectionMode);
    } else {
      selectInRectangle(pointerState.startX, pointerState.startY, event.clientX, event.clientY, selectionMode);
    }
    return;
  }

  if (pointerState.action === "brush") {
    applyBrushSelection(event.clientX, event.clientY);
    endPointerAction();
  }
}

function handleCanvasDoubleClick(event) {
  const hit = pickScenePoint(event);
  if (!hit) {
    return;
  }
  setOrbitTarget(hit.point);
  console.log("环绕中心已设置:", hit.point);
}

function handleCanvasWheel(event) {
  applyDolly(event);
  event.preventDefault();
}

function updateFrameInfo() {
  const fps = parseInt(fpsInput.value, 10) || 30;
  const duration = parseFloat(durationInput.value) || 5;
  exportFrameInfo.textContent = `总帧数: ${Math.round(fps * duration)}`;
}

function updatePathLine() {
  if (pathLine) {
    scene.remove(pathLine);
    pathLine.geometry.dispose();
    pathLine.material.dispose();
    pathLine = null;
  }
  if (keyframes.length < 2) {
    positionCurve = null;
    return;
  }

  positionCurve = new THREE.CatmullRomCurve3(
    keyframes.map((kf) => kf.position.clone()),
    false,
    "catmullrom",
    0.5
  );
  const points = positionCurve.getPoints(keyframes.length * 50);
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color: 0x44ff44, linewidth: 2 });
  pathLine = new THREE.Line(geo, mat);
  scene.add(pathLine);
}

function addKeyframe() {
  const kf = {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone()
  };
  keyframes.push(kf);
  const geo = new THREE.SphereGeometry(0.02, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color: 0x4488ff });
  const markerMesh = new THREE.Mesh(geo, mat);
  markerMesh.position.copy(kf.position);
  scene.add(markerMesh);
  kfMarkers.push(markerMesh);

  kfCountEl.textContent = `关键帧: ${keyframes.length}`;
  console.log(`关键帧 #${keyframes.length} 已添加`, kf.position);
  updatePathLine();
}

function clearKeyframes() {
  keyframes.length = 0;
  for (const markerMesh of kfMarkers) {
    scene.remove(markerMesh);
    markerMesh.geometry.dispose();
    markerMesh.material.dispose();
  }
  kfMarkers.length = 0;
  if (pathLine) {
    scene.remove(pathLine);
    pathLine.geometry.dispose();
    pathLine.material.dispose();
    pathLine = null;
  }
  positionCurve = null;
  playing = false;
  playT = 0;
  kfCountEl.textContent = "关键帧: 0";
  playStatusEl.textContent = "";
  console.log("关键帧已清除");
}

function togglePlay() {
  if (keyframes.length < 2 || !positionCurve) {
    playStatusEl.textContent = "至少需要 2 个关键帧";
    return;
  }
  playing = !playing;
  if (playing) {
    playT = 0;
    playLastTime = performance.now();
    playStatusEl.textContent = "▶ 播放中...";
  } else {
    playStatusEl.textContent = "⏸ 已停止";
  }
}

function updatePlayback(time) {
  if (!playing || !positionCurve) {
    return;
  }

  const dt = (time - playLastTime) / 1000;
  playLastTime = time;
  playT += playSpeed * dt;

  if (playT >= 1) {
    playT = 1;
    playing = false;
    playStatusEl.textContent = "✓ 播放完成";
  }

  camera.position.copy(positionCurve.getPointAt(playT));
  const totalSegments = keyframes.length - 1;
  const rawSegment = playT * totalSegments;
  const segmentIndex = Math.min(Math.floor(rawSegment), totalSegments - 1);
  const segmentT = rawSegment - segmentIndex;
  camera.quaternion.slerpQuaternions(
    keyframes[segmentIndex].quaternion,
    keyframes[segmentIndex + 1].quaternion,
    segmentT
  );

  playStatusEl.textContent = `▶ ${Math.round(playT * 100)}%`;
}

function hideHelperOverlaysForExport() {
  if (pathLine) {
    pathLine.visible = false;
  }
  for (const markerMesh of kfMarkers) {
    markerMesh.visible = false;
  }
  marker.visible = false;
  selectionRectEl.style.display = "none";
  brushCursorEl.style.display = "none";

  if (editState.ready && editState.selectionHighlightEnabled && editState.selectedCount > 0) {
    editState.selectionHighlightEnabled = false;
    applyVisualChanges(collectSelectedIndices());
  }
}

function restoreHelperOverlaysAfterExport() {
  if (pathLine) {
    pathLine.visible = true;
  }
  for (const markerMesh of kfMarkers) {
    markerMesh.visible = true;
  }
  if (hasOrbitTarget) {
    marker.visible = true;
  }

  if (editState.ready && !editState.selectionHighlightEnabled && editState.selectedCount > 0) {
    editState.selectionHighlightEnabled = true;
    applyVisualChanges(collectSelectedIndices());
  } else {
    editState.selectionHighlightEnabled = true;
  }
}

async function exportVideo() {
  if (exporting) {
    return;
  }
  if (keyframes.length < 2 || !positionCurve) {
    exportStatusEl.textContent = "请先添加至少 2 个关键帧";
    return;
  }
  if (typeof VideoEncoder === "undefined") {
    exportStatusEl.textContent = "浏览器不支持 WebCodecs，请使用 Chrome/Edge";
    return;
  }

  exporting = true;
  exportBtn.disabled = true;
  exportProgress.style.display = "block";
  exportStatusEl.textContent = "加载编码器...";

  let mp4Muxer;
  try {
    mp4Muxer = await import("https://esm.sh/mp4-muxer@5");
  } catch (error) {
    exportStatusEl.textContent = `加载 mp4-muxer 失败: ${error.message}`;
    exporting = false;
    exportBtn.disabled = false;
    return;
  }

  const resolutions = {
    "1080": { width: 1920, height: 1080 },
    "2160": { width: 2560, height: 1440 },
    "4320": { width: 3840, height: 2160 }
  };
  const resolution = resolutions[resSelect.value];
  const fps = Math.max(1, parseInt(fpsInput.value, 10) || 30);
  const duration = Math.max(0.5, parseFloat(durationInput.value) || 5);
  const bitrate = Math.max(1, parseInt(bitrateInput.value, 10) || 10) * 1_000_000;
  const totalFrames = Math.round(fps * duration);

  const pixels = resolution.width * resolution.height;
  const codecString = pixels > 5652480 ? "avc1.640034" : pixels > 2097152 ? "avc1.640032" : "avc1.640028";

  const muxer = new mp4Muxer.Muxer({
    target: new mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: resolution.width, height: resolution.height },
    fastStart: "in-memory"
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      exportStatusEl.textContent = `编码错误: ${error.message}`;
    }
  });
  encoder.configure({
    codec: codecString,
    width: resolution.width,
    height: resolution.height,
    bitrate,
    framerate: fps
  });

  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  const originalAspect = camera.aspect;
  const originalPosition = camera.position.clone();
  const originalQuaternion = camera.quaternion.clone();

  renderer.setSize(resolution.width, resolution.height);
  camera.aspect = resolution.width / resolution.height;
  camera.updateProjectionMatrix();

  hideHelperOverlaysForExport();
  exportStatusEl.textContent = `渲染中... 0/${totalFrames}`;

  for (let frameIndex = 0; frameIndex <= totalFrames; frameIndex += 1) {
    const t = frameIndex / totalFrames;
    camera.position.copy(positionCurve.getPointAt(Math.min(t, 1)));

    const totalSegments = keyframes.length - 1;
    const rawSegment = t * totalSegments;
    const segmentIndex = Math.min(Math.floor(rawSegment), totalSegments - 1);
    const segmentT = rawSegment - segmentIndex;
    camera.quaternion.slerpQuaternions(
      keyframes[segmentIndex].quaternion,
      keyframes[segmentIndex + 1].quaternion,
      segmentT
    );

    renderer.render(scene, camera);

    const bitmap = await createImageBitmap(renderer.domElement);
    const timestamp = Math.round(frameIndex * (1_000_000 / fps));
    const frame = new VideoFrame(bitmap, { timestamp });
    encoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 });
    frame.close();
    bitmap.close();

    const percent = Math.round((frameIndex / totalFrames) * 100);
    exportProgressBar.style.width = `${percent}%`;
    exportStatusEl.textContent = `渲染中... ${frameIndex + 1}/${totalFrames + 1} (${percent}%)`;

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  exportStatusEl.textContent = "正在合成视频...";
  await encoder.flush();
  encoder.close();
  muxer.finalize();

  restoreHelperOverlaysAfterExport();
  renderer.setSize(originalWidth, originalHeight);
  camera.aspect = originalAspect;
  camera.updateProjectionMatrix();
  camera.position.copy(originalPosition);
  camera.quaternion.copy(originalQuaternion);

  const mp4Blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(mp4Blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `render_${resSelect.value}p_${fps}fps.mp4`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  exporting = false;
  exportBtn.disabled = false;
  const sizeMb = (mp4Blob.size / 1048576).toFixed(1);
  exportStatusEl.textContent = `✓ 导出完成！${sizeMb} MB, 共 ${totalFrames + 1} 帧`;
}

function handleGlobalKeyDown(event) {
  if (event.key === "r" || event.key === "R") {
    rKeyDown = true;
  }

  if (isInputFocused()) {
    return;
  }

  const commandKey = event.ctrlKey || event.metaKey;
  if (commandKey && (event.key === "z" || event.key === "Z")) {
    if (event.shiftKey) {
      redoDelete();
    } else {
      undoDelete();
    }
    event.preventDefault();
    return;
  }

  if (commandKey && (event.key === "y" || event.key === "Y")) {
    redoDelete();
    event.preventDefault();
    return;
  }

  if (event.key === "e" || event.key === "E") {
    if (editState.ready) {
      setEditMode(!editState.editMode);
      event.preventDefault();
    }
    return;
  }

  if (commandKey && (event.key === "s" || event.key === "S")) {
    if (editState.ready) {
      void saveEditedScene();
      event.preventDefault();
    }
    return;
  }

  if (editState.editMode) {
    if (event.key === "1") {
      setActiveTool("picker");
      event.preventDefault();
      return;
    }
    if (event.key === "2") {
      setActiveTool("brush");
      event.preventDefault();
      return;
    }
    if (event.key === "[" || event.key === "{") {
      if (editState.activeTool === "brush") {
        editState.brushRadiusPx = Math.max(2, editState.brushRadiusPx - 2);
      }
      updateEditUi();
      event.preventDefault();
      return;
    }
    if (event.key === "]" || event.key === "}") {
      if (editState.activeTool === "brush") {
        editState.brushRadiusPx += 2;
      }
      updateEditUi();
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      const changed = clearSelection([]);
      commitSelectionChange(changed);
      event.preventDefault();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      deleteSelectedSplats();
      event.preventDefault();
      return;
    }
  }

  if (playing && event.key !== "p" && event.key !== "P") {
    return;
  }

  if (event.key === "+" || event.key === "=") {
    addKeyframe();
  } else if (event.key === "p" || event.key === "P") {
    togglePlay();
  } else if (event.key === "c" || event.key === "C") {
    clearKeyframes();
  }
}

function handleGlobalKeyUp(event) {
  if (event.key === "r" || event.key === "R") {
    rKeyDown = false;
    if (pointerState.action === "orbit") {
      endPointerAction();
    }
  }
}

function handleResize() {
  if (exporting) {
    return;
  }
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

toggleEditBtn.addEventListener("click", () => {
  if (!editState.ready) {
    return;
  }
  setEditMode(!editState.editMode);
});

resetViewBtn.addEventListener("click", () => {
  focusVisibleSplats();
});

for (const button of toolButtons) {
  button.addEventListener("click", () => {
    if (!editState.ready) {
      return;
    }
    setActiveTool(button.dataset.tool);
  });
}

radiusInput.addEventListener("input", () => {
  const value = Number.parseFloat(radiusInput.value);
  if (!Number.isFinite(value)) {
    return;
  }
  editState.brushRadiusPx = Math.max(2, Math.round(value));
  updateEditUi();
});

clearSelectionBtn.addEventListener("click", () => {
  const changed = clearSelection([]);
  commitSelectionChange(changed);
});

undoBtn.addEventListener("click", undoDelete);
redoBtn.addEventListener("click", redoDelete);
deleteSelectionBtn.addEventListener("click", deleteSelectedSplats);
saveSceneBtn.addEventListener("click", () => {
  void saveEditedScene();
});

fpsInput.addEventListener("input", updateFrameInfo);
durationInput.addEventListener("input", updateFrameInfo);
resSelect.addEventListener("change", updateFrameInfo);
exportBtn.addEventListener("click", exportVideo);

renderer.domElement.addEventListener("mousedown", handleCanvasMouseDown);
renderer.domElement.addEventListener("dblclick", handleCanvasDoubleClick);
renderer.domElement.addEventListener("wheel", handleCanvasWheel, { passive: false });
renderer.domElement.addEventListener("mouseleave", () => {
  if (editState.activeTool === "brush" && pointerState.action !== "brush") {
    updateBrushCursor();
  }
});

window.addEventListener("mousemove", handleWindowMouseMove);
window.addEventListener("mouseup", handleWindowMouseUp);
window.addEventListener("keydown", handleGlobalKeyDown);
window.addEventListener("keyup", handleGlobalKeyUp);
window.addEventListener("resize", handleResize);
window.addEventListener("blur", endPointerAction);

updateFrameInfo();
updateEditUi();

window.__viewerDebug = {
  scene,
  camera,
  renderer,
  spark,
  splats,
  editState,
  getVisibleSplatCount,
  buildVisiblePlyBytes,
  saveEditedScene
};

renderer.setAnimationLoop((time) => {
  if (exporting) {
    return;
  }

  if (playing) {
    updatePlayback(time);
  } else {
    const deltaTime = (time - (controls.lastTime || time)) / 1000;
    controls.lastTime = time;
    controls.fpsMovement.update(deltaTime, camera);
  }

  renderer.render(scene, camera);
});
