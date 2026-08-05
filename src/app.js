import { getMedia, getRecord, getRecords, mergeRecords, peekNextCatalogNumber, putMedia, putRecord, removeMedia, removeRecord, reserveCatalogNumber } from "./db.js?v=1.8.1";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const FORM_DRAFT_KEY = "bhcm-field-form-draft";
const COUNTRY_SEEDS = ["United States", "Zimbabwe", "South Africa", "Botswana", "Mozambique", "Zambia", "Malawi", "Kenya", "Tanzania", "Canada", "United Kingdom"];
const PHOTO_PROTOCOL = [
  { id: "habitus-dorsal", label: "Top view — dorsal habitus", core: true, guidance: "Whole specimen; record body outline, head, thorax, abdomen and appendage position." },
  { id: "habitus-lateral", label: "Side view — lateral habitus", core: true, guidance: "Whole specimen in profile; show head, thorax, legs and abdomen." },
  { id: "head-frontal", label: "Front view — head", core: true, guidance: "Show eyes, antennal insertions, face or clypeus, and mouthparts." },
  { id: "habitus-ventral", label: "Bottom view — ventral habitus", core: true, guidance: "Show ventral thorax and abdomen when the specimen can be positioned safely." },
  { id: "head-dorsal", label: "Head — dorsal detail", guidance: "Document vertex, frons, occiput, hair pattern and ocelli where present." },
  { id: "compound-eye", label: "Compound eye", guidance: "Focus-stack the complete eye surface for morphology and identification." },
  { id: "antennae", label: "Antennae", guidance: "Show the complete antenna, insertion and enough detail to compare segments." },
  { id: "mouthparts-frontal", label: "Mouthparts — frontal", guidance: "Document mandibles, palps, labrum and clypeus for feeding type and classification." },
  { id: "thorax-dorsal", label: "Thorax — dorsal detail", guidance: "Record pronotum or mesosoma, mesoscutum, scutellum, colour and surface texture." },
  { id: "legs", label: "Legs, tarsus and claws", guidance: "Show femur, tibia, tarsus, claws, tibial spurs, segmentation and setation." },
  { id: "abdomen-tergites", label: "Abdomen — dorsal / tergites", guidance: "Record dorsal segments or metasoma, banding, texture, hair density and terminal pattern." },
  { id: "abdomen-sternites", label: "Abdomen — ventral / sternites", guidance: "Record sterna and terminal area only where appropriate and permitted." },
  { id: "wings-overall", label: "Wings or elytra — overall", conditional: true, guidance: "When present, show forewing and hindwing condition, or complete elytral pattern." },
  { id: "wing-surface", label: "Wing venation or elytral surface", conditional: true, guidance: "When present, record venation, stripes, punctures, microsculpture, setae, wear or damage." },
  { id: "hind-leg-special", label: "Hind-leg special structures", conditional: true, guidance: "Where present, capture swollen femur, corbicula, basitarsus, spurs or other diagnostic structures." },
  { id: "surface-detail", label: "Fine surface texture", conditional: true, guidance: "Capture diagnostic sculpture, punctation, hairs or setation at useful magnification." },
];
const WING_PHOTO_TYPES = ["wings-overall", "wing-surface"];
const PHOTO_OMISSION_LABELS = { not_visible: "Not visible", not_applicable: "Not applicable", restricted: "Restricted" };
const CAPTURE_MODE_LABELS = { single: "Single frame", "macro-single": "Macro — single frame", "focus-stack": "Focus stack", "macro-stack": "Macro — focus stack", microscope: "Microscope image" };

const state = {
  records: [],
  media: [],
  catalogueRecords: [],
  catalogueMedia: [],
  selected: new Set(),
  pendingFiles: [],
  editingRecordId: null,
  photoOmissions: {},
  viewCaptureSettings: {},
  installPrompt: null,
  syncing: false,
  cloudReady: false,
  cloudDatabaseReady: false,
  cloudImagesReady: false,
  localPreview: ["127.0.0.1", "localhost"].includes(window.location.hostname),
  visitorMode: window.location.pathname.replace(/\/+$/, "") === "/catalogue"
    || (window.location.hostname === "bioheritage-collections.dochwiza.workers.dev"
      && window.location.pathname.replace(/\/+$/, "") === ""),
};

const imageViewer = {
  scale: 1,
  x: 0,
  y: 0,
  dragging: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0,
  objectUrl: "",
};

function uid(prefix) {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${random[0].toString(36).slice(0, 3).toUpperCase()}${random[1].toString(36).slice(0, 2).toUpperCase()}`;
}

async function showNextCatalogNumber() {
  if ($("#record-id")?.value) return;
  $("#catalog-number").value = await peekNextCatalogNumber();
}

function isoNow() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }
function clean(value) { return String(value ?? "").trim(); }
function isDisplayableMime(value) { return /image\/(jpeg|png|webp|gif|avif)/i.test(value || ""); }

function protocolSlot(id) {
  return PHOTO_PROTOCOL.find((slot) => slot.id === id);
}

function storedMediaFor(recordId = state.editingRecordId) {
  return recordId ? state.media.filter((item) => item.recordId === recordId) : [];
}

function photoReviewFor(record) {
  const captured = new Set(storedMediaFor(record.id).map((item) => item.photoType).filter((id) => protocolSlot(id)));
  const omissions = record.photoOmissions || {};
  const missingCore = PHOTO_PROTOCOL.filter((slot) => slot.core && !captured.has(slot.id) && !omissions[slot.id]);
  const undocumentedDetails = PHOTO_PROTOCOL.filter((slot) => !slot.core && !captured.has(slot.id) && !omissions[slot.id]);
  const documented = PHOTO_PROTOCOL.filter((slot) => captured.has(slot.id) || omissions[slot.id]).length;
  return { captured, omissions, missingCore, undocumentedDetails, documented, ready: !missingCore.length && !undocumentedDetails.length };
}

function orientationOptions(slot) {
  if (!["habitus-lateral", "compound-eye", "antennae", "legs", "hind-leg-special"].includes(slot.id)) return "";
  return `<select data-photo-orientation="${slot.id}" aria-label="Orientation for ${escapeAttribute(slot.label)}"><option value="">Side not recorded</option><option value="left">Left</option><option value="right">Right</option><option value="both">Both / paired</option></select>`;
}

function captureSettingsFor(slotId) {
  const remembered = state.viewCaptureSettings[slotId];
  if (remembered) return remembered;
  const previous = [...storedMediaFor()].reverse().find((item) => item.photoType === slotId && item.captureMetadata);
  return { captureMode: "single", ...(previous?.captureMetadata || {}) };
}

function captureSettingsMarkup(slot) {
  const settings = captureSettingsFor(slot.id);
  const savedCount = storedMediaFor().filter((item) => item.photoType === slot.id).length;
  const field = (key, label, options = {}) => `<label>${label}<input data-capture-setting="${key}" data-photo-slot="${slot.id}" value="${escapeAttribute(settings[key] || "")}" ${options.type ? `type="${options.type}"` : ""} ${options.min ? `min="${options.min}"` : ""} ${options.step ? `step="${options.step}"` : ""} placeholder="${escapeAttribute(options.placeholder || "")}"></label>`;
  return `<details class="view-capture-settings"><summary>Settings for this view <span>${escapeHtml(CAPTURE_MODE_LABELS[settings.captureMode] || "Single frame")}${settings.camera ? ` · ${escapeHtml(settings.camera)}` : ""}${settings.lens ? ` · ${escapeHtml(settings.lens)}` : ""}</span></summary>${savedCount ? `<p class="view-settings-note">Saving the record updates ${savedCount === 1 ? "this photograph" : `all ${savedCount} photographs`} attached to this view.</p>` : ""}<div class="view-settings-grid">
    <label>Capture type<select data-capture-setting="captureMode" data-photo-slot="${slot.id}">${Object.entries(CAPTURE_MODE_LABELS).map(([value, label]) => `<option value="${value}" ${settings.captureMode === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
    ${field("camera", "Camera body", { placeholder: "Camera used for this view" })}
    ${field("lens", "Lens / objective", { placeholder: "Lens used for this view" })}
    ${field("magnification", "Magnification", { placeholder: "e.g. 1× or 5×" })}
    ${field("stackFrames", "Stack frames", { type: "number", min: "1", step: "1" })}
    ${field("stepMicrons", "Step size (µm)", { type: "number", min: "0", step: "any" })}
    ${field("stackingSoftware", "Stacking software", { placeholder: "e.g. Helicon Focus" })}
    ${field("iso", "ISO", { placeholder: "e.g. 100" })}
    ${field("aperture", "Aperture", { placeholder: "e.g. f/8" })}
    ${field("shutterSpeed", "Shutter speed", { placeholder: "e.g. 1/200 s" })}
    ${field("lighting", "Lighting", { placeholder: "Lighting used for this view" })}
    ${field("photographer", "Photographer")}
    ${field("captureDate", "Capture date", { type: "date" })}
    ${field("license", "Image licence", { placeholder: "e.g. CC BY 4.0" })}
    ${field("notes", "View notes", { placeholder: "Stacking, scale or processing notes" })}
  </div></details>`;
}

function readSupplementalCaptureMetadata() {
  return {
    captureMode: $("#supplemental-capture-mode").value,
    camera: clean($("#supplemental-camera").value),
    lens: clean($("#supplemental-lens").value),
    magnification: clean($("#supplemental-magnification").value),
    stackFrames: clean($("#supplemental-stack-frames").value),
    stepMicrons: clean($("#supplemental-step-microns").value),
    stackingSoftware: clean($("#supplemental-stacking-software").value),
    iso: clean($("#supplemental-iso").value),
    aperture: clean($("#supplemental-aperture").value),
    shutterSpeed: clean($("#supplemental-shutter-speed").value),
    lighting: clean($("#supplemental-lighting").value),
    photographer: clean($("#supplemental-photographer").value),
    captureDate: clean($("#supplemental-capture-date").value),
    license: clean($("#supplemental-license").value),
    notes: clean($("#supplemental-notes").value),
  };
}

function captureSummary(metadata = {}) {
  const parts = [CAPTURE_MODE_LABELS[metadata.captureMode] || metadata.captureMode, metadata.camera, metadata.lens, metadata.magnification];
  if (metadata.stackFrames) parts.push(`${metadata.stackFrames} frames`);
  if (metadata.stepMicrons) parts.push(`${metadata.stepMicrons} µm steps`);
  if (metadata.stackingSoftware) parts.push(metadata.stackingSoftware);
  return parts.filter(Boolean).join(" · ");
}

function captureMetadataMarkup(metadata = {}) {
  const stack = [metadata.stackFrames ? `${metadata.stackFrames} frames` : "", metadata.stepMicrons ? `${metadata.stepMicrons} µm steps` : ""].filter(Boolean).join(" · ");
  const rows = [
    ["Capture", CAPTURE_MODE_LABELS[metadata.captureMode] || metadata.captureMode],
    ["Camera", metadata.camera],
    ["Lens / objective", metadata.lens],
    ["Magnification", metadata.magnification],
    ["Focus stack", stack],
    ["Stacking software", metadata.stackingSoftware],
    ["ISO", metadata.iso],
    ["Aperture", metadata.aperture],
    ["Shutter speed", metadata.shutterSpeed],
    ["Lighting", metadata.lighting],
    ["Photographer", metadata.photographer],
    ["Capture date", metadata.captureDate],
    ["Licence", metadata.license],
    ["Notes", metadata.notes],
  ].filter(([, value]) => clean(value));
  if (!rows.length) return "";
  return `<dl class="research-capture-metadata">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function imageViewerPanLimits() {
  const stage = $("#image-viewer-stage");
  const image = $("#image-viewer-image");
  if (!stage || !image || imageViewer.scale <= 1) return { x: 0, y: 0 };
  return {
    x: Math.max(0, ((image.offsetWidth * imageViewer.scale) - stage.clientWidth) / 2),
    y: Math.max(0, ((image.offsetHeight * imageViewer.scale) - stage.clientHeight) / 2),
  };
}

function applyImageViewerTransform() {
  const image = $("#image-viewer-image");
  if (!image) return;
  const limits = imageViewerPanLimits();
  imageViewer.x = clamp(imageViewer.x, -limits.x, limits.x);
  imageViewer.y = clamp(imageViewer.y, -limits.y, limits.y);
  if (imageViewer.scale <= 1) imageViewer.x = imageViewer.y = 0;
  image.style.transform = `translate3d(${imageViewer.x}px, ${imageViewer.y}px, 0) scale(${imageViewer.scale})`;
  $("#image-zoom-level").value = `${Math.round(imageViewer.scale * 100)}%`;
  $("#image-zoom-out").disabled = imageViewer.scale <= 1;
  $("#image-zoom-in").disabled = imageViewer.scale >= 6;
  $$("#image-pan-left, #image-pan-up, #image-pan-down, #image-pan-right").forEach((button) => { button.disabled = imageViewer.scale <= 1; });
  $("#image-viewer-stage").classList.toggle("can-pan", imageViewer.scale > 1);
}

function resetImageViewer() {
  imageViewer.scale = 1;
  imageViewer.x = 0;
  imageViewer.y = 0;
  applyImageViewerTransform();
}

function zoomImageViewer(change) {
  imageViewer.scale = clamp(Math.round((imageViewer.scale + change) * 100) / 100, 1, 6);
  applyImageViewerTransform();
}

function panImageViewer(changeX, changeY) {
  if (imageViewer.scale <= 1) return;
  imageViewer.x += changeX;
  imageViewer.y += changeY;
  applyImageViewerTransform();
}

function closeImageViewer() {
  const dialog = $("#image-viewer-dialog");
  if (dialog?.open) dialog.close();
}

function releaseImageViewerSource() {
  if (imageViewer.objectUrl) URL.revokeObjectURL(imageViewer.objectUrl);
  imageViewer.objectUrl = "";
  const image = $("#image-viewer-image");
  if (image) {
    image.removeAttribute("src");
    image.alt = "";
  }
}

function openImageViewer(item, record) {
  const dialog = $("#image-viewer-dialog");
  const image = $("#image-viewer-image");
  if (!dialog || !image || !isDisplayableMime(item.mimeType || item.blob?.type)) return;
  releaseImageViewerSource();
  const label = item.photoLabel || protocolSlot(item.photoType)?.label || "Specimen photograph";
  imageViewer.objectUrl = !item.publicUrl && item.blob ? URL.createObjectURL(item.blob) : "";
  image.alt = `${titleFor(record)} — ${label}`;
  $("#image-viewer-title").textContent = `${label} · ${record.catalogNumber || titleFor(record)}`;
  image.onload = resetImageViewer;
  image.src = item.publicUrl || imageViewer.objectUrl;
  dialog.showModal();
  resetImageViewer();
  $("#image-viewer-stage").focus();
}

function bindImageViewer() {
  const dialog = $("#image-viewer-dialog");
  const stage = $("#image-viewer-stage");
  if (!dialog || !stage || dialog.dataset.bound) return;
  dialog.dataset.bound = "true";
  $("#close-image-viewer").addEventListener("click", closeImageViewer);
  $("#image-zoom-out").addEventListener("click", () => zoomImageViewer(-0.25));
  $("#image-zoom-in").addEventListener("click", () => zoomImageViewer(0.25));
  $("#image-pan-left").addEventListener("click", () => panImageViewer(-60, 0));
  $("#image-pan-up").addEventListener("click", () => panImageViewer(0, -60));
  $("#image-pan-down").addEventListener("click", () => panImageViewer(0, 60));
  $("#image-pan-right").addEventListener("click", () => panImageViewer(60, 0));
  $("#image-view-reset").addEventListener("click", resetImageViewer);
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomImageViewer(event.deltaY < 0 ? 0.25 : -0.25);
  }, { passive: false });
  stage.addEventListener("keydown", (event) => {
    const actions = {
      ArrowLeft: () => panImageViewer(-60, 0),
      ArrowRight: () => panImageViewer(60, 0),
      ArrowUp: () => panImageViewer(0, -60),
      ArrowDown: () => panImageViewer(0, 60),
      "+": () => zoomImageViewer(0.25),
      "=": () => zoomImageViewer(0.25),
      "-": () => zoomImageViewer(-0.25),
      "0": resetImageViewer,
    };
    if (!actions[event.key]) return;
    event.preventDefault();
    actions[event.key]();
  });
  stage.addEventListener("pointerdown", (event) => {
    if (imageViewer.scale <= 1) return;
    imageViewer.dragging = true;
    imageViewer.pointerId = event.pointerId;
    imageViewer.startX = event.clientX;
    imageViewer.startY = event.clientY;
    imageViewer.originX = imageViewer.x;
    imageViewer.originY = imageViewer.y;
    stage.setPointerCapture?.(event.pointerId);
    stage.classList.add("dragging");
  });
  stage.addEventListener("pointermove", (event) => {
    if (!imageViewer.dragging || event.pointerId !== imageViewer.pointerId) return;
    imageViewer.x = imageViewer.originX + event.clientX - imageViewer.startX;
    imageViewer.y = imageViewer.originY + event.clientY - imageViewer.startY;
    applyImageViewerTransform();
  });
  const stopDragging = (event) => {
    if (!imageViewer.dragging || (event.pointerId !== undefined && event.pointerId !== imageViewer.pointerId)) return;
    imageViewer.dragging = false;
    imageViewer.pointerId = null;
    stage.classList.remove("dragging");
  };
  stage.addEventListener("pointerup", stopDragging);
  stage.addEventListener("pointercancel", stopDragging);
  dialog.addEventListener("close", () => {
    stopDragging({});
    releaseImageViewerSource();
  });
  window.addEventListener("resize", applyImageViewerTransform);
  resetImageViewer();
}

function renderPhotoProtocol() {
  const host = $("#photo-protocol-grid");
  if (!host) return;
  const items = [...storedMediaFor(), ...state.pendingFiles];
  const documented = PHOTO_PROTOCOL.filter((slot) => items.some((item) => item.photoType === slot.id) || state.photoOmissions[slot.id]).length;
  $("#photo-score").textContent = `${documented} / ${PHOTO_PROTOCOL.length}`;
  $("#photo-progress-bar").style.width = `${Math.round((documented / PHOTO_PROTOCOL.length) * 100)}%`;
  host.innerHTML = PHOTO_PROTOCOL.map((slot, index) => {
    const count = items.filter((item) => item.photoType === slot.id).length;
    const omission = state.photoOmissions[slot.id] || "";
    const statusClass = count ? "captured" : (omission ? "omitted" : "missing");
    const status = count ? `${count} image${count === 1 ? "" : "s"} captured` : (PHOTO_OMISSION_LABELS[omission] || "Still needed");
    const kind = slot.core ? "Baseline" : (slot.conditional ? "Conditional" : "Detail");
    return `<article class="photo-slot ${statusClass}">
      <div class="photo-slot-top"><span class="photo-slot-number">${String(index + 1).padStart(2, "0")}</span><div class="photo-slot-copy"><h4>${escapeHtml(slot.label)}</h4><p>${escapeHtml(slot.guidance)}</p></div><span class="photo-kind ${slot.core ? "" : "detail"}">${kind}</span></div>
      <div class="photo-slot-actions">
        <label class="photo-add">Add photograph<input type="file" data-photo-input="${slot.id}" accept="image/*,.tif,.tiff,.dng,.nef,.cr2,.arw" multiple></label>
        ${orientationOptions(slot)}
        <select data-photo-omission="${slot.id}" aria-label="Omission status for ${escapeAttribute(slot.label)}"><option value="">Capture requested</option><option value="not_visible" ${omission === "not_visible" ? "selected" : ""}>Not visible</option><option value="not_applicable" ${omission === "not_applicable" ? "selected" : ""}>Not applicable</option><option value="restricted" ${omission === "restricted" ? "selected" : ""}>Restricted</option></select>
      </div>
      ${captureSettingsMarkup(slot)}
      <span class="photo-slot-state">${escapeHtml(status)}</span>
    </article>`;
  }).join("");
  $$('[data-photo-input]', host).forEach((input) => input.addEventListener("change", () => {
    const slot = protocolSlot(input.dataset.photoInput);
    const orientation = $(`[data-photo-orientation="${slot.id}"]`, input.closest(".photo-slot"))?.value || "";
    addPendingFiles([...input.files], { photoType: slot.id, photoLabel: slot.label, orientation, captureMetadata: { ...captureSettingsFor(slot.id) } });
  }));
  $$('[data-capture-setting]', host).forEach((control) => control.addEventListener("input", () => {
    const slotId = control.dataset.photoSlot;
    state.viewCaptureSettings[slotId] = { ...captureSettingsFor(slotId), [control.dataset.captureSetting]: control.value };
    for (const item of state.pendingFiles.filter((pending) => pending.photoType === slotId)) item.captureMetadata = { ...state.viewCaptureSettings[slotId] };
  }));
  $$('[data-photo-omission]', host).forEach((select) => select.addEventListener("change", () => {
    if (select.value) state.photoOmissions[select.dataset.photoOmission] = select.value;
    else delete state.photoOmissions[select.dataset.photoOmission];
    saveDraft();
    renderPhotoProtocol();
  }));
}

function addPendingFiles(files, metadata = {}) {
  const valid = files.filter((file) => file.size <= 100 * 1024 * 1024 && (file.type.startsWith("image/") || /\.(tif|tiff|dng|nef|cr2|arw)$/i.test(file.name)));
  state.pendingFiles.push(...valid.map((file) => ({ file, photoType: metadata.photoType || "general", photoLabel: metadata.photoLabel || "Additional image", orientation: metadata.orientation || "", captureMetadata: { ...(metadata.captureMetadata || { captureMode: "single" }) } })));
  if (valid.length !== files.length) toast("Some files were skipped. Research images must be a supported image type and under 100 MB.");
  renderPhotoProtocol();
  renderMediaPreview();
}

function applyWingCondition() {
  const value = $("#wing-condition")?.value || "";
  const reason = ["wingless", "not-applicable"].includes(value) ? "not_applicable" : (value === "lost-damaged" ? "not_visible" : "");
  for (const id of WING_PHOTO_TYPES) {
    if (reason) state.photoOmissions[id] = reason;
    else if (["not_applicable", "not_visible"].includes(state.photoOmissions[id])) delete state.photoOmissions[id];
  }
  saveDraft();
  renderPhotoProtocol();
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3200);
}

function setView(name) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  $(".sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "records") renderRecords();
  if (name === "catalogue") renderCatalogue();
  if (name === "publish") renderPublish();
}

function titleFor(record) {
  return record.scientificName || record.commonName || "Unidentified specimen";
}

function scientificNameFor(record) {
  return [record.scientificName, record.scientificNameAuthorship].map(clean).filter(Boolean).join(" ") || "Identification pending";
}

function locationFor(record) {
  return [record.site, record.locality, record.stateProvince, record.country].filter(Boolean).join(", ") || "Location not recorded";
}

function publicLocationFor(record) {
  const treatment = clean(record.localityPrivacy) || "withheld";
  if (treatment === "open") return locationFor(record);
  if (treatment === "generalized" && clean(record.publicLocality)) return clean(record.publicLocality);
  return [record.stateProvince, record.country].map(clean).filter(Boolean).join(", ") || "Locality withheld";
}

function localityDisclosureFor(record) {
  const treatment = clean(record.localityPrivacy) || "withheld";
  if (treatment === "open") return "Open locality - recorded locality and coordinates approved for publication";
  if (treatment === "generalized") return "Generalized locality - exact site and coordinates are protected";
  return "Locality withheld - exact site and coordinates are protected";
}

function citationFor(record) {
  if (clean(record.preferredCitation)) return clean(record.preferredCitation);
  const year = new Date(record.publishedAt || record.updatedAt || Date.now()).getFullYear();
  const repository = clean(record.institutionName) || "Bio-Heritage Collections";
  return `${repository} (${year}). ${record.catalogNumber || "Uncatalogued specimen"}: ${scientificNameFor(record)}. BHC Public Collection.`;
}

function publicCaptureMetadata(item, record) {
  return {
    ...(item.captureMetadata || {}),
    photographer: clean(item.captureMetadata?.photographer) || clean(record.imageCredit),
    license: clean(item.captureMetadata?.license) || clean(record.imageLicense) || "All rights reserved",
  };
}

function initials(record) {
  const source = record.scientificName || record.commonName || "BH";
  return source.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

async function refreshState() {
  state.records = await getRecords();
  state.media = await getMedia();
  renderAll();
}

function renderAll() {
  const queuedRecords = state.records.filter((record) => record.syncStatus === "queued").length;
  const queuedMedia = state.media.filter((item) => item.syncStatus === "queued").length;
  const queued = queuedRecords + queuedMedia;
  const ready = state.records.filter((record) => record.publicationStatus === "ready").length;
  const published = state.records.filter((record) => record.publicationStatus === "published").length;
  $("#metric-total").textContent = state.records.length;
  $("#metric-queued").textContent = queued;
  $("#metric-ready").textContent = ready;
  $("#metric-published").textContent = published;
  $("#queue-pill").textContent = `${queued} queued`;
  $("#publish-count").textContent = `${ready} record${ready === 1 ? "" : "s"} ready`;
  renderRecent();
  renderRecords();
  renderPublish();
  renderPhotoProtocol();
  updateLocationSuggestions();
  updateConnectionUI();
}

function renderRecent() {
  const host = $("#recent-records");
  const recent = state.records.slice(0, 4);
  if (!recent.length) {
    host.className = "record-list empty-state";
    host.innerHTML = `<p>No records yet.</p><button class="button secondary compact" data-go="capture">Start the first one</button>`;
    bindGoButtons(host);
    return;
  }
  host.className = "record-list";
  host.innerHTML = recent.map((record) => `
    <article class="record-row">
      <span class="record-avatar">${escapeHtml(initials(record))}</span>
      <div><strong>${escapeHtml(titleFor(record))}</strong><small>${escapeHtml(record.catalogNumber)} · ${escapeHtml(locationFor(record))}</small></div>
      <time>${new Date(record.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}</time>
    </article>`).join("");
}

async function checkCloudAvailability() {
  if (state.localPreview || !navigator.onLine) {
    state.cloudReady = false;
    updateConnectionUI();
    return false;
  }
  try {
    const response = await fetch("/api/health", { headers: { accept: "application/json" }, cache: "no-store" });
    const contentType = response.headers.get("content-type") || "";
    const payload = response.ok && contentType.includes("application/json") ? await response.json() : {};
    state.cloudDatabaseReady = payload.database === true;
    state.cloudImagesReady = payload.imageStorage === true;
    state.cloudReady = response.ok && payload.ok === true;
  } catch {
    state.cloudReady = false;
    state.cloudDatabaseReady = false;
    state.cloudImagesReady = false;
  }
  updateConnectionUI();
  return state.cloudReady;
}

function updateConnectionUI() {
  const online = navigator.onLine;
  const cloudReady = online && state.cloudReady;
  const queued = state.records.filter((record) => record.syncStatus === "queued").length + state.media.filter((item) => item.syncStatus === "queued").length;
  const label = state.localPreview
    ? "Local preview · cloud not connected"
    : (!online ? "Offline · device archive active" : (cloudReady ? "Online · cloud connected" : "Online · device-only mode"));
  $("#connection-label").textContent = label;
  $("#sidebar-status").textContent = state.localPreview ? "Local preview" : (!online ? "Working offline" : (cloudReady ? "Connected" : "Device-only mode"));
  $("#sidebar-detail").textContent = state.localPreview || !cloudReady ? "Saved on this device" : (queued ? `${queued} change${queued === 1 ? "" : "s"} waiting safely` : "Your work stays on this device");
  [$("#sidebar-dot"), $("#topbar-dot"), $("#sync-health-dot")].forEach((dot) => {
    dot.classList.toggle("online", cloudReady);
    dot.classList.toggle("offline", !cloudReady);
  });
  $("#sync-summary").textContent = state.localPreview
    ? "Records and photographs are stored on this device. Cloud publishing is not connected in this local preview."
    : (!online
      ? "The device archive is available offline. Changes will remain here until a connection returns."
      : (!cloudReady
        ? (state.cloudDatabaseReady && !state.cloudImagesReady
          ? "The Cloud database is ready, but image storage still needs activation. Records and photographs remain safely on this device until both are connected."
          : "Cloud database and image storage are not connected yet. Records and photographs remain on this device.")
        : (queued
          ? `${queued} change${queued === 1 ? " is" : "s are"} stored safely on this device and will move to the cloud when synchronized.`
          : "Nothing is waiting. This device and the cloud collection are aligned.")));
  $("#sync-button").disabled = state.syncing || !cloudReady;
  $("#overview-sync").disabled = state.syncing || !cloudReady;
}

function recordMatches(record, query, filter) {
  const text = [record.catalogNumber, record.scientificName, record.commonName, locationFor(record)].join(" ").toLowerCase();
  if (query && !text.includes(query)) return false;
  if (filter === "all") return true;
  if (filter === "queued") return record.syncStatus === "queued";
  return record.publicationStatus === filter;
}

function renderRecords() {
  const body = $("#records-body");
  if (!body) return;
  const query = clean($("#record-search")?.value).toLowerCase();
  const filter = $("#record-filter")?.value || "all";
  const records = state.records.filter((record) => recordMatches(record, query, filter));
  $("#records-empty").hidden = records.length > 0;
  body.innerHTML = records.map((record) => {
    const photoReview = photoReviewFor(record);
    return `<tr>
      <td><input type="checkbox" data-select-record="${record.id}" aria-label="Select ${escapeHtml(record.catalogNumber)}" ${state.selected.has(record.id) ? "checked" : ""}></td>
      <td><strong>${escapeHtml(record.catalogNumber)}</strong><small><i>${escapeHtml(titleFor(record))}</i>${record.commonName && record.scientificName ? ` · ${escapeHtml(record.commonName)}` : ""}</small></td>
      <td>${escapeHtml(locationFor(record))}</td>
      <td>${escapeHtml(record.eventDateStart || "Not recorded")}</td>
      <td><span class="badge photo-count ${photoReview.ready ? "" : "incomplete"}">${photoReview.documented}/${PHOTO_PROTOCOL.length}</span><small>${photoReview.ready ? "Research set documented" : "Needs review"}</small></td>
      <td><span class="badge ${record.publicationStatus}">${escapeHtml(record.publicationStatus)}</span></td>
      <td><span class="badge ${record.syncStatus}">${escapeHtml(record.syncStatus)}</span></td>
      <td><button class="table-action" data-edit-record="${record.id}">Edit</button> · <button class="table-action" data-delete-record="${record.id}">Delete</button></td>
    </tr>`;
  }).join("");
  $$('[data-select-record]', body).forEach((checkbox) => checkbox.addEventListener("change", () => {
    checkbox.checked ? state.selected.add(checkbox.dataset.selectRecord) : state.selected.delete(checkbox.dataset.selectRecord);
    renderPublish();
  }));
  $$('[data-edit-record]', body).forEach((button) => button.addEventListener("click", () => editRecord(button.dataset.editRecord)));
  $$('[data-delete-record]', body).forEach((button) => button.addEventListener("click", () => deleteRecord(button.dataset.deleteRecord)));
}

function renderPublish() {
  const selected = state.records.filter((record) => state.selected.has(record.id));
  const ready = state.records.filter((record) => record.publicationStatus === "ready").length;
  $("#publish-count").textContent = selected.length ? `${selected.length} selected for review` : `${ready} record${ready === 1 ? "" : "s"} ready`;
  const summary = $("#photo-review-summary");
  const overrideBox = $("#photo-override-box");
  if (!summary) return;
  if (!selected.length) {
    summary.textContent = "Select records to review photographic coverage.";
    if (overrideBox) {
      overrideBox.hidden = true;
      $("#check-photo-override").checked = false;
      $("#photo-override-reason").value = "";
      $("#photo-override-reason").disabled = true;
    }
    return;
  }
  const reviews = selected.map(photoReviewFor);
  const missingCore = reviews.reduce((total, review) => total + review.missingCore.length, 0);
  const undocumented = reviews.reduce((total, review) => total + review.undocumentedDetails.length, 0);
  summary.textContent = !missingCore && !undocumented
    ? "All selected records have documented research-photo coverage."
    : `${missingCore} missing core view${missingCore === 1 ? "" : "s"}; ${undocumented} diagnostic detail${undocumented === 1 ? "" : "s"} still need a photograph or omission reason.`;
  if (overrideBox) {
    overrideBox.hidden = !missingCore && !undocumented;
    if (overrideBox.hidden) {
      $("#check-photo-override").checked = false;
      $("#photo-override-reason").value = "";
      $("#photo-override-reason").disabled = true;
    }
  }
}

async function renderCatalogue() {
  let published = state.records.filter((record) => record.publicationStatus === "published");
  let media = state.media;
  let cloudCatalogueAvailable = false;
  if (navigator.onLine) {
    try {
      const response = await fetch("/api/public", { headers: { accept: "application/json" } });
      if (response.ok) {
        const payload = await response.json();
        cloudCatalogueAvailable = !payload.local;
        const remote = payload.records || [];
        const byId = new Map([...published, ...remote].map((record) => [record.id, record]));
        published = [...byId.values()];
        const mediaById = new Map(media.map((item) => [item.id, item]));
        for (const remoteItem of payload.media || []) {
          const localItem = mediaById.get(remoteItem.id) || {};
          mediaById.set(remoteItem.id, { ...remoteItem, ...localItem, publicUrl: remoteItem.publicUrl || localItem.publicUrl || "" });
        }
        media = [...mediaById.values()];
      }
    } catch { /* local catalogue remains available */ }
  }
  const query = clean($("#catalogue-search")?.value).toLowerCase();
  published = published.filter((record) => [record.catalogNumber, record.scientificName, record.scientificNameAuthorship, record.commonName, record.order, record.family, publicLocationFor(record)].join(" ").toLowerCase().includes(query));
  const host = $("#catalogue-grid");
  state.catalogueRecords = published;
  state.catalogueMedia = media;
  const sourceStatus = $("#catalogue-source-status");
  if (sourceStatus) sourceStatus.textContent = state.localPreview
    ? `Local preview: showing ${published.length} published record${published.length === 1 ? "" : "s"} and photographs saved on this device.`
    : (cloudCatalogueAvailable ? "Showing specimen records reviewed and published by Bio-Heritage Collections." : "Cloud collection unavailable - showing the last published copy held on this device.");
  $("#catalogue-empty").hidden = published.length > 0;
  host.innerHTML = published.map((record) => {
    const allRecordMedia = media.filter((item) => item.recordId === record.id && (item.publicUrl || item.blob));
    const recordMedia = allRecordMedia.filter((item) => isDisplayableMime(item.mimeType || item.blob?.type));
    const image = recordMedia.find((item) => item.photoType === "habitus-dorsal") || recordMedia[0];
    const source = image?.publicUrl || (image?.blob ? URL.createObjectURL(image.blob) : "");
    return `<article class="specimen-card">
      <div class="specimen-image">${source ? `<img src="${escapeAttribute(source)}" alt="${escapeAttribute(`${titleFor(record)} — ${image.photoLabel || "specimen photograph"}`)}"><span class="photo-signature" aria-hidden="true">tate</span>` : `<span class="monogram">${escapeHtml(initials(record))}</span>`}</div>
      <div class="specimen-card-body"><span class="catalog-id">${escapeHtml(record.catalogNumber)}</span><h2><i>${escapeHtml(scientificNameFor(record))}</i></h2><p class="common">${escapeHtml(record.commonName || record.identificationStatus)}</p><div class="specimen-meta"><span>Collected<strong>${escapeHtml(record.eventDateStart || "Not recorded")}</strong></span><span>Public locality<strong>${escapeHtml(publicLocationFor(record))}</strong></span></div><div class="specimen-card-actions"><span>${allRecordMedia.length} photograph${allRecordMedia.length === 1 ? "" : "s"}</span><button class="button secondary compact" data-open-specimen="${record.id}">View record</button></div></div>
    </article>`;
  }).join("");
  $$('[data-open-specimen]', host).forEach((button) => button.addEventListener("click", () => openSpecimen(button.dataset.openSpecimen)));
}

function openSpecimen(id) {
  const record = state.catalogueRecords.find((item) => item.id === id);
  if (!record) return;
  const requestSubject = encodeURIComponent(`BHC photograph request — ${record.catalogNumber || titleFor(record)}`);
  const requestBody = encodeURIComponent(`Specimen: ${titleFor(record)}\nCatalogue number: ${record.catalogNumber || "Not recorded"}\n\nRequested picture or viewing angle:\n`);
  const requestHref = `mailto:dochwiza@gmail.com?subject=${requestSubject}&body=${requestBody}`;
  const media = state.catalogueMedia.filter((item) => item.recordId === id && (item.publicUrl || item.blob));
  const gallery = media.map((item) => {
    const source = item.publicUrl || (item.blob ? URL.createObjectURL(item.blob) : "");
    const label = item.photoLabel || protocolSlot(item.photoType)?.label || "Specimen photograph";
    const orientation = item.orientation ? `${item.orientation} side` : "";
    const captureDetails = captureMetadataMarkup(publicCaptureMetadata(item, record));
    if (!isDisplayableMime(item.mimeType || item.blob?.type)) return `<figure class="research-photo research-file"><div class="media-file-fallback">Original research file</div><figcaption>${escapeHtml(label)}<span>${escapeHtml([item.fileName || item.mimeType || "Image file", orientation].filter(Boolean).join(" · "))}</span>${source ? `<a class="button secondary compact" href="${escapeAttribute(source)}" target="_blank" rel="noopener">Open original</a>` : ""}</figcaption>${captureDetails}</figure>`;
    return `<figure class="research-photo"><button type="button" class="research-photo-open" data-inspect-image="${escapeAttribute(item.id)}" aria-label="Zoom and pan ${escapeAttribute(label)}"><img src="${escapeAttribute(source)}" alt="${escapeAttribute(`${titleFor(record)} — ${label}`)}"><span class="photo-signature" aria-hidden="true">tate</span><span class="photo-view-action">Zoom &amp; pan</span></button><figcaption>${escapeHtml(label)}${orientation ? `<span>${escapeHtml(orientation)}</span>` : ""}</figcaption>${captureDetails}</figure>`;
  }).join("");
  const eventDate = [record.eventDateStart, record.eventDateEnd && record.eventDateEnd !== record.eventDateStart ? record.eventDateEnd : ""].filter(Boolean).join(" to ") || "Not recorded";
  const repository = [record.institutionName || "Bio-Heritage Collections", record.collectionCode].filter(Boolean).join(" - ");
  const identification = [record.identifiedBy ? `By ${record.identifiedBy}` : "", record.dateIdentified].filter(Boolean).join(" - ") || "Not recorded";
  const coordinates = record.localityPrivacy === "open" && clean(record.latitude) && clean(record.longitude) ? `${record.latitude}, ${record.longitude}${record.coordinateUncertainty ? ` (±${record.coordinateUncertainty} m)` : ""}` : "Protected";
  $("#specimen-dialog-content").innerHTML = `<article class="specimen-detail">
    <div class="specimen-detail-head"><div><span class="catalog-id">${escapeHtml(record.catalogNumber)}</span><h2 id="specimen-dialog-title"><i>${escapeHtml(scientificNameFor(record))}</i></h2><p>${escapeHtml(record.commonName || record.identificationStatus || "")}</p></div><div class="specimen-detail-facts"><span>Collected<strong>${escapeHtml(eventDate)}</strong></span><span>Public locality<strong>${escapeHtml(publicLocationFor(record))}</strong></span><span>Collector<strong>${escapeHtml(record.collector || "Not recorded")}</strong></span><span>Repository<strong>${escapeHtml(repository)}</strong></span><span>Life stage<strong>${escapeHtml(record.lifeStage || "Not recorded")}</strong></span><span>Coordinates<strong>${escapeHtml(coordinates)}</strong></span></div></div>
    <div class="specimen-record-sections">
      <section class="record-detail-panel"><p class="eyebrow">Identification and provenance</p><h3>Research record</h3><dl class="record-detail-list"><div><dt>Identification status</dt><dd>${escapeHtml(record.identificationStatus || "Not recorded")}</dd></div><div><dt>Identified</dt><dd>${escapeHtml(identification)}</dd></div><div><dt>Order / family</dt><dd>${escapeHtml([record.order, record.family].filter(Boolean).join(" / ") || "Not recorded")}</dd></div><div><dt>Preservation</dt><dd>${escapeHtml(record.preservation || "Not recorded")}</dd></div><div><dt>Sex</dt><dd>${escapeHtml(record.sex || "Not recorded")}</dd></div><div><dt>Last updated</dt><dd>${escapeHtml(record.updatedAt ? new Date(record.updatedAt).toLocaleDateString() : "Not recorded")}</dd></div></dl>${record.identificationRemarks ? `<p class="record-remarks">${escapeHtml(record.identificationRemarks)}</p>` : ""}</section>
      <section class="record-detail-panel rights-panel"><p class="eyebrow">Citation and reuse</p><h3>Use this record responsibly</h3><blockquote>${escapeHtml(citationFor(record))}</blockquote><dl class="record-detail-list"><div><dt>Rights holder</dt><dd>${escapeHtml(record.rightsHolder || "Bio-Heritage Collections")}</dd></div><div><dt>Record-data licence</dt><dd>${escapeHtml(record.recordLicense || "All rights reserved")}</dd></div><div><dt>Default image credit</dt><dd>${escapeHtml(record.imageCredit || "Tate / Bio-Heritage Collections")}</dd></div><div><dt>Default image licence</dt><dd>${escapeHtml(record.imageLicense || "All rights reserved")}</dd></div></dl><p class="privacy-note">${escapeHtml(localityDisclosureFor(record))}</p></section>
    </div>
    <aside class="specimen-photo-request"><div><strong>Would another picture or angle help your research?</strong><span>Send the catalogue number and requested view directly to Tate.</span></div><a class="button secondary compact" href="${escapeAttribute(requestHref)}">Request this specimen</a></aside>${gallery ? `<div class="research-gallery">${gallery}</div>` : `<div class="research-empty">No public research photographs are attached to this record.</div>`}</article>`;
  $$("[data-inspect-image]", $("#specimen-dialog-content")).forEach((button) => button.addEventListener("click", () => {
    const item = state.catalogueMedia.find((mediaItem) => mediaItem.id === button.dataset.inspectImage);
    if (item) openImageViewer(item, record);
  }));
  $("#specimen-dialog").showModal();
}

function formObject() {
  const form = $("#record-form");
  return Object.fromEntries(new FormData(form).entries());
}

async function saveForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = formObject();
  if (!clean(data.scientificName) && !clean(data.commonName)) {
    toast("Add a scientific name or a common name before saving.");
    $("#scientific-name").focus();
    return;
  }
  const existing = data.id ? await getRecord(data.id) : null;
  const timestamp = isoNow();
  const locationId = clean(data.locationId) || locationIdFor(data);
  const catalogNumber = existing?.catalogNumber || await reserveCatalogNumber();
  const record = {
    ...existing,
    ...data,
    id: data.id || uid("REC"),
    entityType: "specimen",
    locationId,
    catalogNumber,
    photoProtocolVersion: 1,
    photoOmissions: { ...state.photoOmissions },
    localityPrivacy: clean(data.localityPrivacy) || "generalized",
    rightsHolder: clean(data.rightsHolder) || "Bio-Heritage Collections",
    recordLicense: clean(data.recordLicense) || "All rights reserved",
    imageCredit: clean(data.imageCredit) || "Tate / Bio-Heritage Collections",
    imageLicense: clean(data.imageLicense) || "All rights reserved",
    institutionName: clean(data.institutionName) || "Bio-Heritage Collections",
    institutionCode: clean(data.institutionCode) || "BHC",
    collectionCode: clean(data.collectionCode) || "BHC Entomology",
    publicationStatus: existing?.publicationStatus || "draft",
    syncStatus: "queued",
    version: (existing?.version || 0) + 1,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  await putRecord(record);
  let updatedPhotoCount = 0;
  for (const [photoType, captureMetadata] of Object.entries(state.viewCaptureSettings)) {
    const savedImages = state.media.filter((item) => item.recordId === record.id && item.photoType === photoType);
    for (const item of savedImages) {
      await putMedia({ ...item, captureMetadata: { ...(item.captureMetadata || {}), ...captureMetadata }, syncStatus: "queued", updatedAt: timestamp });
      updatedPhotoCount += 1;
    }
  }
  for (const item of state.pendingFiles) {
    const file = item.file;
    await putMedia({ id: uid("IMG"), recordId: record.id, fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, blob: file, photoType: item.photoType, photoLabel: item.photoLabel, orientation: item.orientation, captureMetadata: { ...(item.captureMetadata || {}) }, syncStatus: "queued", createdAt: timestamp });
  }
  localStorage.removeItem(FORM_DRAFT_KEY);
  await resetForm();
  await refreshState();
  toast(`${record.catalogNumber} is saved safely on this device.${updatedPhotoCount ? ` Settings were updated for ${updatedPhotoCount} photograph${updatedPhotoCount === 1 ? "" : "s"}.` : ""}`);
  setView("records");
  if (navigator.onLine) syncNow({ quiet: true });
}

function locationIdFor(data) {
  const matched = state.records.find((record) => ["country", "stateProvince", "county", "locality", "site"].every((key) => clean(record[key]).toLowerCase() === clean(data[key]).toLowerCase()));
  return matched?.locationId || uid("LOC");
}

async function resetForm() {
  $("#record-form").reset();
  $("#record-id").value = "";
  await showNextCatalogNumber();
  $("#event-date-start").value = today();
  $("#form-heading").textContent = "New collection record";
  state.pendingFiles.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
  state.pendingFiles = [];
  state.editingRecordId = null;
  state.photoOmissions = {};
  state.viewCaptureSettings = {};
  renderPhotoProtocol();
  renderMediaPreview();
  updateLocationSuggestions();
}

async function editRecord(id) {
  const record = await getRecord(id);
  if (!record) return;
  const form = $("#record-form");
  for (const [key, value] of Object.entries(record)) {
    const field = form.elements.namedItem(key);
    if (field && typeof value !== "object") field.value = value ?? "";
  }
  $("#record-id").value = record.id;
  $("#form-heading").textContent = `Edit ${record.catalogNumber}`;
  state.pendingFiles = [];
  state.editingRecordId = record.id;
  state.photoOmissions = { ...(record.photoOmissions || {}) };
  state.viewCaptureSettings = {};
  applyWingCondition();
  renderPhotoProtocol();
  renderMediaPreview();
  updateLocationSuggestions();
  setView("capture");
}

async function deleteRecord(id) {
  const record = await getRecord(id);
  if (!record || !confirm(`Delete ${record.catalogNumber} from this device? This cannot be undone.`)) return;
  for (const item of await getMedia(id)) await removeMedia(item.id);
  await removeRecord(id);
  state.selected.delete(id);
  await refreshState();
  toast(`${record.catalogNumber} was removed from this device.`);
}

function renderMediaPreview() {
  const host = $("#media-preview");
  const items = [
    ...storedMediaFor().map((sourceItem) => ({ sourceItem, stored: true })),
    ...state.pendingFiles.map((sourceItem, index) => ({ sourceItem, index, stored: false })),
  ];
  host.innerHTML = items.map((item) => {
    const data = item.sourceItem;
    const blob = item.stored ? data.blob : data.file;
    const fileName = item.stored ? data.fileName : data.file.name;
    const mimeType = item.stored ? data.mimeType : data.file.type;
    const previewable = isDisplayableMime(mimeType || blob?.type);
    if (!data.previewUrl && blob && previewable) data.previewUrl = URL.createObjectURL(blob);
    const source = data.publicUrl || data.previewUrl || "";
    const label = data.photoLabel || protocolSlot(data.photoType)?.label || "Additional image";
    const details = [data.orientation ? `${data.orientation} side` : "", captureSummary(data.captureMetadata)].filter(Boolean).join(" · ");
    return `<figure class="media-thumb">${source ? `<img src="${escapeAttribute(source)}" alt="Preview of ${escapeAttribute(fileName)}">` : `<span class="media-file-fallback">${escapeHtml(fileName)}</span>`}${item.stored ? "" : `<button type="button" data-remove-file="${item.index}" aria-label="Remove ${escapeAttribute(fileName)}">×</button>`}<figcaption>${escapeHtml(label)}${details ? `<span>${escapeHtml(details)}</span>` : ""}</figcaption></figure>`;
  }).join("");
  $$('[data-remove-file]', host).forEach((button) => button.addEventListener("click", () => {
    const [removed] = state.pendingFiles.splice(Number(button.dataset.removeFile), 1);
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    renderPhotoProtocol();
    renderMediaPreview();
  }));
}

function fillDataList(id, values) {
  const element = $(`#${id}`);
  const unique = [...new Set(values.map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  element.replaceChildren(...unique.map((value) => Object.assign(document.createElement("option"), { value })));
}

function updateLocationSuggestions() {
  const values = formObject();
  fillDataList("countries", [...COUNTRY_SEEDS, ...state.records.map((record) => record.country)]);
  const byCountry = state.records.filter((record) => !clean(values.country) || clean(record.country).toLowerCase() === clean(values.country).toLowerCase());
  fillDataList("states", byCountry.map((record) => record.stateProvince));
  const byState = byCountry.filter((record) => !clean(values.stateProvince) || clean(record.stateProvince).toLowerCase() === clean(values.stateProvince).toLowerCase());
  fillDataList("counties", byState.map((record) => record.county));
  const byCounty = byState.filter((record) => !clean(values.county) || clean(record.county).toLowerCase() === clean(values.county).toLowerCase());
  fillDataList("localities", byCounty.map((record) => record.locality));
  const byLocality = byCounty.filter((record) => !clean(values.locality) || clean(record.locality).toLowerCase() === clean(values.locality).toLowerCase());
  fillDataList("sites", byLocality.map((record) => record.site));
  const exact = byLocality.filter((record) => !clean(values.site) || clean(record.site).toLowerCase() === clean(values.site).toLowerCase());
  $("#location-id").value = exact.length === 1 ? exact[0].locationId : (clean(values.country) && (clean(values.locality) || clean(values.site)) ? locationIdFor(values) : "");
}

async function syncNow({ quiet = false } = {}) {
  if (state.localPreview) {
    if (!quiet) toast("This local preview keeps your collection on this device. Cloud synchronization begins after deployment.");
    return;
  }
  if (state.syncing || !navigator.onLine) {
    if (!quiet) toast("No connection yet. Your changes remain safe on this device.");
    return;
  }
  if (!state.cloudReady && !await checkCloudAvailability()) {
    if (!quiet) toast("Cloud storage is not connected yet. Your changes remain safe on this device.");
    return;
  }
  state.syncing = true;
  $("#sync-button").textContent = "Syncing…";
  updateConnectionUI();
  try {
    const queued = state.records.filter((record) => record.syncStatus === "queued");
    if (queued.length) {
      const response = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ records: queued }) });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in is required to synchronize." : "The collection service did not accept the records.");
      const payload = await response.json();
      for (const id of payload.syncedIds || queued.map((record) => record.id)) {
        const record = await getRecord(id);
        if (record) await putRecord({ ...record, syncStatus: "synced", syncedAt: isoNow() });
      }
    }
    const queuedMedia = state.media.filter((item) => item.syncStatus === "queued");
    for (const item of queuedMedia) {
      const data = new FormData();
      data.append("id", item.id); data.append("recordId", item.recordId); data.append("file", item.blob, item.fileName);
      data.append("photoType", item.photoType || "general");
      data.append("photoLabel", item.photoLabel || "Additional image");
      data.append("orientation", item.orientation || "");
      data.append("captureMetadata", JSON.stringify(item.captureMetadata || {}));
      const response = await fetch("/api/media", { method: "POST", body: data });
      if (!response.ok) throw new Error("An image could not be uploaded.");
      const payload = await response.json();
      await putMedia({ ...item, syncStatus: "synced", syncedAt: isoNow(), publicUrl: payload.publicUrl });
    }
    const cloudResponse = await fetch("/api/records", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!cloudResponse.ok) throw new Error(cloudResponse.status === 401 ? "Manager sign-in is required to restore the Cloud archive." : "The Cloud archive could not be read.");
    const cloud = await cloudResponse.json();
    const localRecords = new Map((await getRecords()).map((record) => [record.id, record]));
    for (const record of cloud.records || []) {
      const local = localRecords.get(record.id);
      if (!local || (local.syncStatus !== "queued" && String(record.updatedAt || "") >= String(local.updatedAt || ""))) {
        await putRecord({ ...record, syncStatus: "synced", syncedAt: isoNow() });
      }
    }
    const localMedia = new Map((await getMedia()).map((item) => [item.id, item]));
    for (const item of cloud.media || []) {
      const local = localMedia.get(item.id);
      if (!local || local.syncStatus !== "queued") {
        await putMedia({ ...local, ...item, blob: local?.blob, syncStatus: "synced", syncedAt: isoNow() });
      }
    }
    await refreshState();
    if (!quiet) toast("Device and cloud collection are synchronized.");
  } catch (error) {
    toast(error.message || "Synchronization paused. Your local copy is safe.");
  } finally {
    state.syncing = false;
    $("#sync-button").textContent = "Sync now";
    updateConnectionUI();
  }
}

async function updateSelectedStatus(status, { overrideReason = "" } = {}) {
  const chosen = state.records.filter((record) => state.selected.has(record.id));
  if (!chosen.length) { toast("Select one or more records in the Records view first."); return false; }
  const reviews = chosen.map((record) => ({ record, review: photoReviewFor(record) }));
  const missingCore = reviews.reduce((total, item) => total + item.review.missingCore.length, 0);
  const undocumented = reviews.reduce((total, item) => total + item.review.undocumentedDetails.length, 0);
  if (["ready", "published"].includes(status)) {
    if (missingCore || undocumented) {
      if (status !== "published" || !clean(overrideReason)) {
        toast(`Photography review incomplete: ${missingCore} baseline view${missingCore === 1 ? "" : "s"} missing and ${undocumented} detail${undocumented === 1 ? "" : "s"} undocumented.`);
        return false;
      }
    }
  }
  const decisionAt = isoNow();
  for (const { record, review } of reviews) {
    const outstandingViews = [...review.missingCore, ...review.undocumentedDetails].map((slot) => ({ id: slot.id, label: slot.label }));
    const publicationOverride = status === "published" && outstandingViews.length
      ? { scope: "research-photography", reason: clean(overrideReason), decidedBy: "data-manager", decidedAt: decisionAt, outstandingViews }
      : record.publicationOverride || null;
    await putRecord({
      ...record,
      localityPrivacy: clean(record.localityPrivacy) || "withheld",
      rightsHolder: clean(record.rightsHolder) || "Bio-Heritage Collections",
      recordLicense: clean(record.recordLicense) || "All rights reserved",
      imageCredit: clean(record.imageCredit) || "Tate / Bio-Heritage Collections",
      imageLicense: clean(record.imageLicense) || "All rights reserved",
      institutionName: clean(record.institutionName) || "Bio-Heritage Collections",
      institutionCode: clean(record.institutionCode) || "BHC",
      collectionCode: clean(record.collectionCode) || "BHC Entomology",
      publicationStatus: status,
      publicationOverride,
      publishedAt: status === "published" ? decisionAt : record.publishedAt || null,
      syncStatus: "queued",
      version: record.version + 1,
      updatedAt: decisionAt,
    });
  }
  await refreshState();
  toast(`${chosen.length} record${chosen.length === 1 ? "" : "s"} marked ${status}${clean(overrideReason) ? " with a documented manager override" : ""}.`);
  if (navigator.onLine) syncNow({ quiet: true });
  return true;
}

function download(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement("a"), { href: url, download: name });
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function exportCsv() {
  const columns = ["occurrenceID", "catalogNumber", "scientificName", "scientificNameAuthorship", "vernacularName", "identifiedBy", "dateIdentified", "identificationRemarks", "eventDate", "country", "stateProvince", "county", "locality", "decimalLatitude", "decimalLongitude", "coordinateUncertaintyInMeters", "recordedBy", "samplingProtocol", "habitat", "sex", "lifeStage", "preparations", "institutionCode", "collectionCode", "rightsHolder", "license", "informationWithheld", "dataGeneralizations", "occurrenceStatus", "basisOfRecord", "associatedMedia", "photographicViews", "photographicOmissions", "photographicCaptureMetadata"];
  const rows = state.records.map((record) => {
    const media = storedMediaFor(record.id);
    const views = [...new Set(media.map((item) => item.photoLabel || protocolSlot(item.photoType)?.label).filter(Boolean))].join(" | ");
    const omissions = Object.entries(record.photoOmissions || {}).map(([id, reason]) => `${protocolSlot(id)?.label || id}: ${PHOTO_OMISSION_LABELS[reason] || reason}`).join(" | ");
    const associatedMedia = media.map((item) => item.publicUrl).filter(Boolean).join(" | ");
    const captureMetadata = JSON.stringify(media.map((item) => ({ fileName: item.fileName, view: item.photoLabel || protocolSlot(item.photoType)?.label || item.photoType, orientation: item.orientation || "", ...(item.captureMetadata || {}) })));
    const informationWithheld = record.localityPrivacy === "open" ? "" : "Exact locality and coordinates";
    const dataGeneralizations = record.localityPrivacy === "generalized" ? (record.publicLocality || "Locality generalized to state/province and country") : "";
    return [record.id, record.catalogNumber, record.scientificName, record.scientificNameAuthorship, record.commonName, record.identifiedBy, record.dateIdentified, record.identificationRemarks, record.eventDateStart, record.country, record.stateProvince, record.county, [record.locality, record.site].filter(Boolean).join(" — "), record.latitude, record.longitude, record.coordinateUncertainty, record.collector, record.samplingMethod, record.habitat, record.sex, record.lifeStage, record.preservation, record.institutionCode, record.collectionCode, record.rightsHolder, record.recordLicense, informationWithheld, dataGeneralizations, "present", "PreservedSpecimen", associatedMedia, views, omissions, captureMetadata];
  });
  download(`bhc-occurrences-${today()}.csv`, "text/csv;charset=utf-8", [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"));
}

function exportJson() {
  const media = state.media.map(({ blob, ...item }) => item);
  download(`bhc-field-backup-${today()}.json`, "application/json", JSON.stringify({ format: "BHC Field", version: 2, photoProtocolVersion: 1, exportedAt: isoNow(), records: state.records, media }, null, 2));
}

async function importJson(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (!Array.isArray(payload.records)) throw new Error("This is not a BHC Field backup.");
    const existing = new Map(state.records.map((record) => [record.id, record]));
    const merged = payload.records.map((record) => ({ ...record, syncStatus: "queued", updatedAt: record.updatedAt || isoNow() })).filter((record) => !existing.has(record.id) || existing.get(record.id).updatedAt < record.updatedAt);
    await mergeRecords(merged);
    await refreshState();
    toast(`${merged.length} record${merged.length === 1 ? "" : "s"} imported.`);
  } catch (error) { toast(error.message || "The backup could not be imported."); }
}

function saveDraft() {
  const data = formObject();
  if (!Object.values(data).some((value) => clean(value))) return;
  localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify({ ...data, __photoOmissions: state.photoOmissions, __viewCaptureSettings: state.viewCaptureSettings }));
}

function restoreDraft() {
  const raw = localStorage.getItem(FORM_DRAFT_KEY);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    state.photoOmissions = { ...(draft.__photoOmissions || {}) };
    state.viewCaptureSettings = { ...(draft.__viewCaptureSettings || {}) };
    for (const [key, value] of Object.entries(draft)) {
      if (["__photoOmissions", "__viewCaptureSettings"].includes(key)) continue;
      const field = $("#record-form").elements.namedItem(key);
      if (field) field.value = value;
    }
    renderPhotoProtocol();
  } catch { localStorage.removeItem(FORM_DRAFT_KEY); }
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
function escapeAttribute(value) { return escapeHtml(value); }

function bindGoButtons(root = document) {
  $$('[data-go]', root).forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  bindGoButtons();
  $("#menu-button").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
  $("#record-form").addEventListener("submit", saveForm);
  $("#record-form").addEventListener("input", () => { clearTimeout(saveDraft.timer); saveDraft.timer = setTimeout(saveDraft, 250); });
  ["country", "state-province", "county", "locality", "site"].forEach((id) => $(`#${id}`).addEventListener("input", updateLocationSuggestions));
  $("#wing-condition").addEventListener("change", applyWingCondition);
  $("#media-files").addEventListener("change", (event) => {
    addPendingFiles([...event.target.files], { captureMetadata: readSupplementalCaptureMetadata() });
    event.target.value = "";
  });
  $("#clear-form").addEventListener("click", async () => { if (confirm("Clear this unsaved form?")) { localStorage.removeItem(FORM_DRAFT_KEY); await resetForm(); } });
  $("#record-search").addEventListener("input", renderRecords);
  $("#record-filter").addEventListener("change", renderRecords);
  $("#catalogue-search").addEventListener("input", renderCatalogue);
  $("#select-all").addEventListener("change", (event) => { state.records.forEach((record) => event.target.checked ? state.selected.add(record.id) : state.selected.delete(record.id)); renderRecords(); renderPublish(); });
  $("#sync-button").addEventListener("click", () => syncNow());
  $("#overview-sync").addEventListener("click", () => syncNow());
  $("#mark-ready").addEventListener("click", () => updateSelectedStatus("ready"));
  $("#check-photo-override").addEventListener("change", (event) => {
    $("#photo-override-reason").disabled = !event.target.checked;
    if (event.target.checked) $("#photo-override-reason").focus();
    else $("#photo-override-reason").value = "";
  });
  $("#publish-selected").addEventListener("click", async () => {
    if (!["check-identification", "check-locality", "check-photography", "check-media"].every((id) => $(`#${id}`).checked)) { toast("Complete the four publication checks first."); return; }
    const useOverride = $("#check-photo-override").checked;
    const overrideReason = useOverride ? clean($("#photo-override-reason").value) : "";
    if (useOverride && !overrideReason) { toast("Add a reason for the data-manager override."); return; }
    const updated = await updateSelectedStatus("published", { overrideReason });
    if (updated) {
      $("#check-photo-override").checked = false;
      $("#photo-override-reason").value = "";
      $("#photo-override-reason").disabled = true;
    }
  });
  $("#export-csv").addEventListener("click", exportCsv);
  $("#export-json").addEventListener("click", exportJson);
  $("#import-json").addEventListener("change", (event) => { if (event.target.files[0]) importJson(event.target.files[0]); event.target.value = ""; });
  window.addEventListener("online", async () => { if (await checkCloudAvailability()) syncNow({ quiet: true }); });
  window.addEventListener("offline", () => { state.cloudReady = false; updateConnectionUI(); });
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); state.installPrompt = event; $("#install-button").hidden = false; });
  $("#install-button").addEventListener("click", async () => { if (!state.installPrompt) return; state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; $("#install-button").hidden = true; });
  $("#close-specimen-dialog").addEventListener("click", () => $("#specimen-dialog").close());
  bindImageViewer();
}

async function initializeVisitor() {
  document.body.classList.add("visitor-mode");
  document.title = "BHC Public Collection";
  $("#catalogue-search").addEventListener("input", renderCatalogue);
  $("#close-specimen-dialog").addEventListener("click", () => $("#specimen-dialog").close());
  bindImageViewer();
  if ("serviceWorker" in navigator) await navigator.serviceWorker.register("/sw.js");
  try {
    state.records = await getRecords();
    state.media = await getMedia();
  } catch (error) {
    console.error("The device catalogue could not be opened.", error);
  }
  await renderCatalogue();
}

async function initialize() {
  if (state.visitorMode) {
    await initializeVisitor();
    return;
  }
  $("#today-label").textContent = new Date().toLocaleDateString([], { year: "numeric", month: "short", day: "2-digit" }).toUpperCase();
  $("#event-date-start").value = today();
  bindEvents();
  restoreDraft();
  updateLocationSuggestions();
  try {
    await showNextCatalogNumber();
    if (navigator.storage?.persist) {
      const persisted = await navigator.storage.persist();
      $("#storage-status").textContent = persisted ? "Persistent storage" : "Storage ready";
    }
    if ("serviceWorker" in navigator) await navigator.serviceWorker.register("/sw.js");
    await refreshState();
    if (await checkCloudAvailability()) syncNow({ quiet: true });
  } catch (error) {
    console.error(error);
    toast("The device archive could not be opened in this browser.");
  }
}

initialize();
