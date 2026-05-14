const DATA_URL = "data/dwg-map-raw.json";
const SVG_NS = "http://www.w3.org/2000/svg";
const DUPLICATE_POINT_EPSILON = 0.000001;
const MILLIMETERS_PER_METER = 1000;
const MAPBOX_ACCESS_TOKEN = window.MOVUFU_MAPBOX_TOKEN || "";
const MAPBOX_STYLE_URL = "mapbox://styles/emauburiti/cmb8mw0oh015401qy4kri8jnm";
const MAPBOX_UBERLANDIA_BOUNDS = [
  [-48.30, -19.00],
  [-48.10, -18.80]
];
const MAPBOX_ACCESSIBILITY_BOUNDS = {
  west: -48.2685,
  south: -18.9295,
  east: -48.2445,
  north: -18.9105
};
const MAPBOX_BUILDING_MIN_AREA = 100000;
const MAPBOX_BUILDING_MAX_COUNT = 240;
const BUILDING_HEIGHT_STORAGE_PREFIX = "ufu-building-heights:";
const DEFAULT_BUILDING_HEIGHT_MIN = 1;
const DEFAULT_BUILDING_HEIGHT_MAX = 120;

const state = {
  adjacency: new Map(),
  adminMode: false,
  baseViewBox: null,
  background: [],
  buildingLabels: [],
  buildingHeights: new Map(),
  buildings: [],
  bounds: null,
  dragging: null,
  edges: [],
  graphReady: false,
  mapboxReady: false,
  nodes: [],
  nodeById: new Map(),
  pickTarget: "origin",
  rawData: null,
  rawRouteBounds: null,
  route: null,
  selectedBuildingId: null,
  threeDMap: null,
  voiceHadResult: false,
  voiceLastError: null,
  voiceListening: false,
  voiceSpeechDetected: false,
  voiceRecognition: null,
  viewMode: "svg",
  viewBox: null
};

const refs = {};

document.addEventListener("DOMContentLoaded", initializeApp);

async function initializeApp() {
  cacheDom();
  bindEvents();
  initializeMapboxMap();
  await loadCurrentMapData();
}

async function loadCurrentMapData(statusText = "Carregando planta...") {
  try {
    setStatus(statusText);
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Falha ao abrir ${DATA_URL}`);
    }

    const rawData = await response.json();
    loadGraph(rawData);
    populateControls();
    renderMap();
    calculateAndRenderRoute();
    setStatus(buildLoadedStatus(rawData));
  } catch (error) {
    console.error(error);
    setStatus(`Nao foi possivel carregar a planta: ${error.message}`, "error");
  }
}

function cacheDom() {
  refs.routeForm = document.getElementById("routeForm");
  refs.originSelect = document.getElementById("originSelect");
  refs.destinationSelect = document.getElementById("destinationSelect");
  refs.swapBtn = document.getElementById("swapBtn");
  refs.voiceCommandForm = document.getElementById("voiceCommandForm");
  refs.voiceCommandInput = document.getElementById("voiceCommandInput");
  refs.voiceBtn = document.getElementById("voiceBtn");
  refs.voicePanel = document.querySelector(".voice-panel");
  refs.voiceState = document.getElementById("voiceState");
  refs.pickOriginBtn = document.getElementById("pickOriginBtn");
  refs.pickDestinationBtn = document.getElementById("pickDestinationBtn");
  refs.adminPanel = document.querySelector(".admin-panel");
  refs.adminToggleBtn = document.getElementById("adminToggleBtn");
  refs.adminEditor = document.getElementById("adminEditor");
  refs.buildingSelect = document.getElementById("buildingSelect");
  refs.buildingHeightInput = document.getElementById("buildingHeightInput");
  refs.saveBuildingHeightBtn = document.getElementById("saveBuildingHeightBtn");
  refs.resetBuildingHeightBtn = document.getElementById("resetBuildingHeightBtn");
  refs.resetAllBuildingHeightsBtn = document.getElementById("resetAllBuildingHeightsBtn");
  refs.nodeCount = document.getElementById("nodeCount");
  refs.edgeCount = document.getElementById("edgeCount");
  refs.routeDistance = document.getElementById("routeDistance");
  refs.pathText = document.getElementById("pathText");
  refs.segmentList = document.getElementById("segmentList");
  refs.nodeList = document.getElementById("nodeList");
  refs.statusText = document.getElementById("statusText");
  refs.fitBtn = document.getElementById("fitBtn");
  refs.zoomInBtn = document.getElementById("zoomInBtn");
  refs.zoomOutBtn = document.getElementById("zoomOutBtn");
  refs.resetViewBtn = document.getElementById("resetViewBtn");
  refs.svgViewBtn = document.getElementById("svgViewBtn");
  refs.mapboxViewBtn = document.getElementById("mapboxViewBtn");
  refs.svg = document.getElementById("campusMap");
  refs.mapboxMap = document.getElementById("mapboxMap");
  refs.backgroundLayer = document.getElementById("backgroundLayer");
  refs.edgeLayer = document.getElementById("edgeLayer");
  refs.routeLayer = document.getElementById("routeLayer");
  refs.nodeLayer = document.getElementById("nodeLayer");
}

function bindEvents() {
  refs.routeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    calculateAndRenderRoute();
  });

  refs.originSelect.addEventListener("change", calculateAndRenderRoute);
  refs.destinationSelect.addEventListener("change", calculateAndRenderRoute);
  refs.swapBtn.addEventListener("click", swapRouteEndpoints);
  refs.pickOriginBtn.addEventListener("click", () => setPickTarget("origin"));
  refs.pickDestinationBtn.addEventListener("click", () => setPickTarget("destination"));
  refs.adminToggleBtn.addEventListener("click", toggleAdminMode);
  refs.buildingSelect.addEventListener("change", () => selectBuilding(refs.buildingSelect.value));
  refs.saveBuildingHeightBtn.addEventListener("click", saveSelectedBuildingHeight);
  refs.resetBuildingHeightBtn.addEventListener("click", resetSelectedBuildingHeight);
  refs.resetAllBuildingHeightsBtn.addEventListener("click", resetAllBuildingHeights);
  refs.fitBtn.addEventListener("click", resetView);
  refs.zoomInBtn.addEventListener("click", () => zoomView(0.82));
  refs.zoomOutBtn.addEventListener("click", () => zoomView(1.18));
  refs.resetViewBtn.addEventListener("click", resetView);
  refs.svgViewBtn.addEventListener("click", () => setViewMode("svg"));
  refs.mapboxViewBtn.addEventListener("click", () => setViewMode("mapbox"));
  refs.voiceBtn.addEventListener("click", toggleVoiceRecognition);
  refs.voiceCommandForm.addEventListener("submit", handleManualVoiceCommand);

  refs.svg.addEventListener("wheel", handleMapWheel, { passive: false });
  refs.svg.addEventListener("pointerdown", handlePointerDown);
  refs.svg.addEventListener("pointermove", handlePointerMove);
  refs.svg.addEventListener("pointerup", stopDragging);
  refs.svg.addEventListener("pointerleave", stopDragging);
  window.addEventListener("resize", updateNodeSizing);

  initializeVoiceRecognition();
}

function initializeVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    refs.voiceBtn.disabled = true;
    refs.voiceState.textContent = "Comando de voz indisponivel neste navegador.";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "pt-BR";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.addEventListener("start", () => {
    state.voiceListening = true;
    state.voiceHadResult = false;
    state.voiceLastError = null;
    state.voiceSpeechDetected = false;
    refs.voiceBtn.textContent = "Ouvindo";
    refs.voiceBtn.classList.add("is-listening");
    refs.voicePanel.classList.add("is-listening");
    refs.voiceState.textContent = "Ouvindo...";
  });

  recognition.addEventListener("audiostart", () => {
    refs.voiceState.textContent = "Microfone ativo. Pode falar.";
  });

  recognition.addEventListener("soundstart", () => {
    refs.voiceState.textContent = "Som detectado. Continue falando.";
  });

  recognition.addEventListener("speechstart", () => {
    state.voiceSpeechDetected = true;
    refs.voiceState.textContent = "Fala detectada. Processando...";
  });

  recognition.addEventListener("nomatch", () => {
    refs.voiceState.textContent = "Ouvi, mas nao reconheci o comando. Tente: origem N1 destino N5.";
  });

  recognition.addEventListener("end", () => {
    state.voiceListening = false;
    refs.voiceBtn.textContent = "Falar";
    refs.voiceBtn.classList.remove("is-listening");
    refs.voicePanel.classList.remove("is-listening");

    if (!state.voiceLastError && !state.voiceHadResult && !state.voiceSpeechDetected) {
      refs.voiceState.textContent = "Nao detectei fala. Verifique o microfone ou tente falar mais perto.";
    }
  });

  recognition.addEventListener("error", (event) => {
    state.voiceLastError = event.error || "unknown";
    refs.voiceState.textContent = getVoiceErrorMessage(event.error);
  });

  recognition.addEventListener("result", (event) => {
    state.voiceHadResult = true;
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    processVoiceCommand(transcript);
  });

  state.voiceRecognition = recognition;
}

async function toggleVoiceRecognition() {
  if (!state.voiceRecognition) {
    return;
  }

  if (state.voiceListening) {
    state.voiceRecognition.stop();
    return;
  }

  const microphoneReady = await ensureMicrophoneAccess();

  if (!microphoneReady) {
    return;
  }

  try {
    state.voiceRecognition.start();
  } catch (error) {
    refs.voiceState.textContent = "A escuta ja esta ativa.";
  }
}

async function ensureMicrophoneAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    refs.voiceState.textContent = "Este navegador nao permite testar o microfone nesta pagina.";
    return true;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (error) {
    refs.voiceState.textContent = error?.name === "NotAllowedError"
      ? "Permissao do microfone negada. Libere o microfone no navegador."
      : "Nao consegui acessar o microfone deste navegador.";
    return false;
  }
}

function getVoiceErrorMessage(errorCode) {
  const messages = {
    "aborted": "Escuta cancelada.",
    "audio-capture": "Nenhum microfone foi encontrado pelo navegador.",
    "network": "O servico de reconhecimento de voz falhou. Tente de novo.",
    "no-speech": "Nao detectei fala. Tente falar logo apos tocar em Falar.",
    "not-allowed": "Permissao do microfone negada. Libere o microfone no navegador.",
    "service-not-allowed": "Reconhecimento de voz bloqueado neste navegador.",
    "language-not-supported": "Idioma pt-BR nao suportado neste navegador."
  };

  return messages[errorCode] || "Nao consegui ouvir o comando.";
}

function handleManualVoiceCommand(event) {
  event.preventDefault();
  const command = refs.voiceCommandInput.value.trim();

  if (!command) {
    refs.voiceState.textContent = "Digite um comando como: origem N1 destino N5.";
    return;
  }

  processVoiceCommand(command);
  refs.voiceCommandInput.value = "";
}

function processVoiceCommand(transcript) {
  const command = normalizeVoiceText(transcript);
  const originId = findNodeAfterVoiceKeyword(command, ["origem", "de", "partida", "inicio"]);
  const destinationId = findNodeAfterVoiceKeyword(command, ["destino", "para", "ate", "chegada", "fim"]);
  let changed = false;

  if (originId) {
    refs.originSelect.value = originId;
    changed = true;
  }

  if (destinationId) {
    refs.destinationSelect.value = destinationId;
    changed = true;
  }

  if (command.includes("inverter") || command.includes("trocar")) {
    swapRouteEndpoints();
    refs.voiceState.textContent = `Comando: ${transcript}. Pontos invertidos.`;
    return;
  }

  if (changed || command.includes("calcular") || command.includes("rota")) {
    calculateAndRenderRoute();
    refs.voiceState.textContent = `Comando: ${transcript}.`;
    return;
  }

  const looseNodeId = findNodeInVoiceText(command);
  if (looseNodeId) {
    selectNodeFromMap(looseNodeId);
    refs.voiceState.textContent = `Comando: ${transcript}. Ponto ${looseNodeId} selecionado.`;
    return;
  }

  refs.voiceState.textContent = `Nao entendi: ${transcript}.`;

  if (command.includes("bloco") || command.includes("predio")) {
    refs.voiceState.textContent = `Nao encontrei esse bloco no mapa carregado: ${transcript}. Verifique se o DWG foi reexportado com DESCRISSAO ou BLOCO nos nos.`;
  }
}

function findNodeAfterVoiceKeyword(command, keywords) {
  const words = command.split(" ").filter(Boolean);

  for (const keyword of keywords) {
    const keywordIndex = words.indexOf(keyword);

    if (keywordIndex !== -1) {
      const nextStopIndex = words.findIndex((word, index) => {
        return index > keywordIndex && ["origem", "de", "destino", "para", "ate", "chegada", "fim"].includes(word);
      });
      const segmentEnd = nextStopIndex === -1 ? keywordIndex + 7 : nextStopIndex;
      const segment = words.slice(keywordIndex + 1, segmentEnd).join(" ");
      const nodeId = findNodeInVoiceText(segment);

      if (nodeId) {
        return nodeId;
      }
    }
  }

  return null;
}

function findNodeInVoiceText(text) {
  const normalizedText = normalizeVoiceComparable(text);

  return state.nodes.find((node) => {
    return buildVoiceNodeAliases(node).some((alias) => {
      const normalizedAlias = normalizeVoiceComparable(alias);
      return normalizedText === normalizedAlias
        || normalizedText.includes(` ${normalizedAlias} `)
        || normalizedText.startsWith(`${normalizedAlias} `)
        || normalizedText.endsWith(` ${normalizedAlias}`);
    });
  })?.id || null;
}

function buildVoiceNodeAliases(node) {
  const id = String(node?.id || "");
  const match = id.match(/^([a-zA-Z]+)(\d+)$/);
  const aliases = [
    id,
    node?.name,
    getNodeAttribute(node, "descricao", "descrição", "description", "label"),
    getNodeAttribute(node, "bloco", "block", "building", "predio", "prédio")
  ].filter(Boolean);

  [
    node?.name,
    getNodeAttribute(node, "descricao", "descrição", "description", "label"),
    getNodeAttribute(node, "bloco", "block", "building", "predio", "prédio")
  ].filter(Boolean).forEach((value) => {
    extractBlockAliases(value).forEach((alias) => aliases.push(alias));
  });

  if (!match) {
    return [...new Set(aliases)];
  }

  const [, prefix, number] = match;
  aliases.push(`${prefix} ${number}`);

  if (prefix.toUpperCase() === "N") {
    aliases.push(`ene ${number}`, `no ${number}`, `ponto ${number}`);
  }

  return [...new Set(aliases)];
}

function extractBlockAliases(value) {
  const normalized = normalizeVoiceText(value);
  const aliases = [];
  const blockMatches = normalized.matchAll(/\b(?:bloco|predio)\s+(\d+\s*[a-z]?|[a-z]\s*\d+|[a-z0-9]+)\b/g);

  for (const match of blockMatches) {
    const blockCode = match[1].replace(/\s+/g, "");
    aliases.push(
      match[0],
      `bloco ${blockCode}`,
      `predio ${blockCode}`,
      `bloco ${blockCode.replace(/(\d)([a-z])/i, "$1 $2")}`,
      `predio ${blockCode.replace(/(\d)([a-z])/i, "$1 $2")}`
    );
  }

  return aliases;
}

function normalizeVoiceComparable(value) {
  return normalizeVoiceText(value)
    .replace(/\b(\d+)\s+([a-z])\b/g, "$1$2")
    .replace(/\b([a-z])\s+(\d+)\b/g, "$1$2");
}

function normalizeVoiceText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function initializeMapboxMap() {
  if (!refs.mapboxMap || !window.mapboxgl) {
    refs.mapboxViewBtn.disabled = true;
    refs.mapboxViewBtn.title = "Mapbox GL JS nao foi carregado.";
    return;
  }

  if (!MAPBOX_ACCESS_TOKEN) {
    refs.mapboxViewBtn.disabled = true;
    refs.mapboxViewBtn.title = "Configure window.MOVUFU_MAPBOX_TOKEN para ativar o mapa 3D.";
    return;
  }

  mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
  state.threeDMap = new mapboxgl.Map({
    container: refs.mapboxMap,
    style: MAPBOX_STYLE_URL,
    center: [-48.258, -18.919],
    zoom: window.innerWidth <= 768 ? 14.5 : 15,
    pitch: window.innerWidth <= 768 ? 0 : 45,
    bearing: window.innerWidth <= 768 ? 0 : -17.6,
    antialias: true,
    maxBounds: MAPBOX_UBERLANDIA_BOUNDS,
    minZoom: 14,
    maxZoom: 20,
    attributionControl: false,
    renderWorldCopies: false
  });

  state.threeDMap.on("load", () => {
    state.mapboxReady = true;
    addMapboxBaseControls();
    addMapboxAccessibilityLayers();
    updateMapboxAccessibilityData();
  });
}

function addMapboxBaseControls() {
  state.threeDMap.addControl(new mapboxgl.NavigationControl(), "top-right");
  state.threeDMap.addControl(new mapboxgl.FullscreenControl(), "top-right");
  state.threeDMap.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");

  try {
    if (!state.threeDMap.getLayer("osm-3d-buildings")) {
      state.threeDMap.addLayer({
        id: "osm-3d-buildings",
        source: "composite",
        "source-layer": "building",
        filter: ["==", "extrude", "true"],
        type: "fill-extrusion",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": [
            "match",
            ["get", "type"],
            "education", "#4285F4",
            "commercial", "#EA4335",
            "residential", "#FBBC05",
            "government", "#34A853",
            "#a13025"
          ],
          "fill-extrusion-height": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            0,
            16,
            ["get", "height"]
          ],
          "fill-extrusion-base": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            0,
            16,
            ["get", "min_height"]
          ],
          "fill-extrusion-opacity": 0.86
        }
      });
    }
  } catch (error) {
    console.warn("Nao foi possivel adicionar edificios 3D OSM.", error);
  }
}

function addMapboxAccessibilityLayers() {
  const map = state.threeDMap;

  map.addSource("accessibility-edges", {
    type: "geojson",
    data: createFeatureCollection([])
  });
  map.addSource("accessibility-route", {
    type: "geojson",
    data: createFeatureCollection([])
  });
  map.addSource("accessibility-nodes", {
    type: "geojson",
    data: createFeatureCollection([])
  });
  map.addSource("accessibility-buildings", {
    type: "geojson",
    data: createFeatureCollection([])
  });
  map.addSource("accessibility-building-labels", {
    type: "geojson",
    data: createFeatureCollection([])
  });

  map.addLayer({
    id: "accessibility-buildings-extrusion",
    type: "fill-extrusion",
    source: "accessibility-buildings",
    paint: {
      "fill-extrusion-color": [
        "case",
        ["boolean", ["get", "selected"], false],
        "#f59e0b",
        [
          "interpolate",
          ["linear"],
          ["get", "height"],
          8,
          "#8aa4b8",
          28,
          "#506b7d"
        ]
      ],
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.72
    }
  });

  map.addLayer({
    id: "accessibility-edges-line",
    type: "line",
    source: "accessibility-edges",
    paint: {
      "line-color": "#0f766e",
      "line-width": ["interpolate", ["linear"], ["zoom"], 14, 2.2, 18, 6],
      "line-opacity": 0.78
    }
  });

  map.addLayer({
    id: "accessibility-route-line-casing",
    type: "line",
    source: "accessibility-route",
    paint: {
      "line-color": "#ffffff",
      "line-width": ["interpolate", ["linear"], ["zoom"], 14, 7, 18, 15],
      "line-opacity": 0.94
    }
  });

  map.addLayer({
    id: "accessibility-route-line",
    type: "line",
    source: "accessibility-route",
    paint: {
      "line-color": "#f59e0b",
      "line-width": ["interpolate", ["linear"], ["zoom"], 14, 4, 18, 10],
      "line-opacity": 0.98
    }
  });

  map.addLayer({
    id: "accessibility-nodes-circle",
    type: "circle",
    source: "accessibility-nodes",
    paint: {
      "circle-color": [
        "match",
        ["get", "status"],
        "origin",
        "#0f766e",
        "destination",
        "#2563eb",
        "route",
        "#f59e0b",
        [
          "match",
          ["get", "category"],
          "ramp",
          "#dc2626",
          "crosswalk",
          "#7c3aed",
          "intersection",
          "#2563eb",
          "door",
          "#059669",
          "entrance",
          "#059669",
          "accessible_entrance",
          "#059669",
          "elevator",
          "#0891b2",
          "restroom",
          "#9333ea",
          "#17212b"
        ]
      ],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 4, 18, 9],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2
    }
  });

  map.addLayer({
    id: "accessibility-nodes-label",
    type: "symbol",
    source: "accessibility-nodes",
    minzoom: 16,
    layout: {
      "text-field": ["get", "label"],
      "text-size": 12,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
      "text-allow-overlap": false
    },
    paint: {
      "text-color": "#17212b",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.4
    }
  });

  map.addLayer({
    id: "accessibility-building-labels",
    type: "symbol",
    source: "accessibility-building-labels",
    minzoom: 15,
    layout: {
      "text-field": ["get", "name"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 15, 11, 18, 16],
      "text-letter-spacing": 0.02,
      "text-anchor": "center",
      "text-allow-overlap": false
    },
    paint: {
      "text-color": "#10202b",
      "text-halo-color": "#f8fafc",
      "text-halo-width": 1.6
    }
  });

  map.on("click", "accessibility-nodes-circle", (event) => {
    const nodeId = event.features?.[0]?.properties?.id;
    if (nodeId) {
      selectNodeFromMap(nodeId);
    }
  });

  map.on("click", "accessibility-buildings-extrusion", (event) => {
    const buildingId = event.features?.[0]?.properties?.id;
    if (buildingId && state.adminMode) {
      selectBuilding(buildingId);
    }
  });

  map.on("mouseenter", "accessibility-nodes-circle", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "accessibility-nodes-circle", () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("mouseenter", "accessibility-buildings-extrusion", () => {
    if (state.adminMode) {
      map.getCanvas().style.cursor = "pointer";
    }
  });
  map.on("mouseleave", "accessibility-buildings-extrusion", () => {
    map.getCanvas().style.cursor = "";
  });
}

function setViewMode(mode) {
  state.viewMode = mode === "mapbox" ? "mapbox" : "svg";
  refs.svg.classList.toggle("is-hidden", state.viewMode === "mapbox");
  refs.mapboxMap.classList.toggle("is-active", state.viewMode === "mapbox");
  refs.svgViewBtn.classList.toggle("is-active", state.viewMode === "svg");
  refs.mapboxViewBtn.classList.toggle("is-active", state.viewMode === "mapbox");
  refs.zoomInBtn.parentElement.classList.toggle("is-hidden", state.viewMode === "mapbox");

  if (state.viewMode === "mapbox" && state.threeDMap) {
    state.threeDMap.resize();
    fitMapboxAccessibilityBounds();
  }
}

function getBuildingHeightStorageKey(rawData = state.rawData) {
  const source = String(rawData?.source || rawData?.summary?.source || DATA_URL);
  return `${BUILDING_HEIGHT_STORAGE_PREFIX}${source}`;
}

function loadBuildingHeightOverrides(rawData) {
  try {
    const stored = localStorage.getItem(getBuildingHeightStorageKey(rawData));
    const parsed = stored ? JSON.parse(stored) : {};

    return new Map(Object.entries(parsed)
      .map(([buildingId, height]) => [buildingId, Number(height)])
      .filter(([, height]) => Number.isFinite(height)));
  } catch (error) {
    console.warn("Nao foi possivel carregar as alturas editadas.", error);
    return new Map();
  }
}

function persistBuildingHeightOverrides() {
  try {
    const payload = Object.fromEntries(state.buildingHeights);

    if (state.buildingHeights.size) {
      localStorage.setItem(getBuildingHeightStorageKey(), JSON.stringify(payload));
      return;
    }

    localStorage.removeItem(getBuildingHeightStorageKey());
  } catch (error) {
    console.warn("Nao foi possivel salvar as alturas editadas.", error);
    setStatus("Altura aplicada, mas nao foi possivel gravar no navegador.", "warning");
  }
}

function loadGraph(rawData) {
  const nodes = normalizeNodes(rawData.nodes || []);
  const background = normalizePathItems(rawData.background || []);
  const buildings = normalizePathItems(rawData.buildings || []);
  const buildingLabels = normalizeBuildingLabels(rawData.buildingLabels || []);
  const routeBounds = calculateRawBounds(rawData, nodes, { includeBackground: false });
  const fullBounds = calculateRawBounds(rawData, nodes, { includeBackground: true });
  const snapTolerance = getSnapTolerance(routeBounds);
  const displayBounds = expandRawBounds(fullBounds, getDisplayMargin(fullBounds));
  const segments = extractSegments(rawData.polylines || [], nodes, snapTolerance);
  const adjacency = buildAdjacency(nodes, segments);

  state.rawData = rawData;
  state.background = background;
  state.buildings = buildings;
  state.buildingLabels = buildingLabels;
  state.buildingHeights = loadBuildingHeightOverrides(rawData);
  state.nodes = nodes;
  state.nodeById = new Map(nodes.map((node) => [node.id, node]));
  state.rawRouteBounds = routeBounds;
  state.edges = segments;
  state.adjacency = adjacency;
  state.bounds = rawBoundsToSvgBounds(displayBounds);
  state.baseViewBox = buildViewBox(state.bounds);
  state.viewBox = { ...state.baseViewBox };
  state.graphReady = nodes.length > 0;
  state.selectedBuildingId = getBuildingCandidates()[0]?.item.id || null;

  refs.nodeCount.textContent = String(nodes.length);
  refs.edgeCount.textContent = String(segments.length);
  renderBuildingAdminControls();
  updateMapboxAccessibilityData();
}

function normalizeNodes(rawNodes) {
  const nodesById = new Map();

  rawNodes.forEach((item) => {
    const id = String(item?.id || "").trim();
    const position = normalizePoint(item?.position);

    if (!id || !position || nodesById.has(id)) {
      return;
    }

    nodesById.set(id, {
      id,
      accessible: Boolean(item.accessible),
      attributes: item.attributes && typeof item.attributes === "object" ? item.attributes : {},
      blockName: String(item.blockName || "").trim(),
      category: normalizeNodeCategory(item.category, item.type),
      flow: String(item.flow || "").trim(),
      layer: String(item.layer || "").trim(),
      level: String(item.level || getNodeAttribute(item, "nivel", "level", "floor", "pavimento") || "").trim(),
      name: String(item.name || getNodeAttribute(item, "descricao", "descrição", "description", "label", "bloco", "predio", "building") || "").trim(),
      type: String(item.type || "").trim(),
      position
    });
  });

  return [...nodesById.values()].sort((left, right) => naturalCompare(left.id, right.id));
}

function getNodeAttribute(item, ...names) {
  const attributes = item?.attributes;

  if (!attributes || typeof attributes !== "object") {
    return "";
  }

  const normalizedNames = names.map(normalizeAttributeKey);
  const entries = Object.entries(attributes);

  for (const [key, value] of entries) {
    const normalizedKey = normalizeAttributeKey(key);

    if (normalizedNames.includes(normalizedKey)) {
      return value;
    }
  }

  for (const [key, value] of entries) {
    const normalizedKey = normalizeAttributeKey(key);

    if (normalizedNames.some((name) => normalizedKey.startsWith(name.slice(0, 6)))) {
      return value;
    }
  }

  return "";
}

function normalizeAttributeKey(value) {
  return normalizeVoiceText(value).replace(/[^a-z0-9]/g, "");
}

function normalizePathItems(rawItems) {
  return rawItems
    .map((item, index) => {
      const points = (item?.points || [])
        .map(normalizePoint)
        .filter(Boolean);

      if (points.length < 2) {
        return null;
      }

      return {
        id: String(item.id || `path-${index + 1}`),
        closed: Boolean(item.closed),
        layer: String(item.layer || ""),
        points,
        type: String(item.type || "PATH")
      };
    })
    .filter(Boolean);
}

function normalizeBuildingLabels(rawItems) {
  return rawItems
    .map((item, index) => {
      const position = normalizePoint(item?.position);
      const name = String(item?.name || "").trim();

      if (!position || !name) {
        return null;
      }

      return {
        id: String(item.id || `building-label-${index + 1}`),
        layer: String(item.layer || ""),
        name,
        position,
        type: String(item.type || "TEXT")
      };
    })
    .filter(Boolean);
}

function normalizePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  const z = Number(point?.z || 0);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y, z: Number.isFinite(z) ? z : 0 };
}

function extractSegments(rawPolylines, nodes, snapTolerance) {
  const segments = [];

  rawPolylines.forEach((polyline, polylineIndex) => {
    const points = (polyline.points || [])
      .map(normalizePoint)
      .filter(Boolean);
    const cleanPoints = removeConsecutiveDuplicatePoints(points);

    if (cleanPoints.length < 2) {
      return;
    }

    let lastSnap = null;

    cleanPoints.forEach((point, pointIndex) => {
      const snap = findNearestNode(point, nodes, snapTolerance);

      if (!snap) {
        return;
      }

      if (!lastSnap) {
        lastSnap = { node: snap.node, pointIndex };
        return;
      }

      if (snap.node.id === lastSnap.node.id) {
        return;
      }

      const segmentPoints = cleanPoints.slice(lastSnap.pointIndex, pointIndex + 1);
      const length = calculatePolylineLength(segmentPoints);

      if (length > DUPLICATE_POINT_EPSILON) {
        segments.push({
          id: `${polyline.id || `pline-${polylineIndex + 1}`}:${segments.length + 1}`,
          from: lastSnap.node.id,
          to: snap.node.id,
          layer: String(polyline.layer || ""),
          length,
          points: segmentPoints,
          sourcePolylineId: String(polyline.id || `pline-${polylineIndex + 1}`)
        });
      }

      lastSnap = { node: snap.node, pointIndex };
    });
  });

  return segments;
}

function removeConsecutiveDuplicatePoints(points) {
  return points.filter((point, index) => {
    if (index === 0) {
      return true;
    }

    return getPointDistance(point, points[index - 1]) > DUPLICATE_POINT_EPSILON;
  });
}

function findNearestNode(point, nodes, maxDistance) {
  let bestMatch = null;

  nodes.forEach((node) => {
    const distance = getPointDistance(point, node.position);
    if (distance <= maxDistance && (!bestMatch || distance < bestMatch.distance)) {
      bestMatch = { node, distance };
    }
  });

  return bestMatch;
}

function buildAdjacency(nodes, segments) {
  const adjacency = new Map(nodes.map((node) => [node.id, []]));

  segments.forEach((segment) => {
    adjacency.get(segment.from)?.push({
      from: segment.from,
      to: segment.to,
      length: segment.length,
      segment,
      points: segment.points
    });
    adjacency.get(segment.to)?.push({
      from: segment.to,
      to: segment.from,
      length: segment.length,
      segment,
      points: [...segment.points].reverse()
    });
  });

  adjacency.forEach((edges) => {
    edges.sort((left, right) => {
      if (left.length !== right.length) {
        return left.length - right.length;
      }
      return naturalCompare(left.to, right.to);
    });
  });

  return adjacency;
}

function populateControls() {
  refs.originSelect.innerHTML = "";
  refs.destinationSelect.innerHTML = "";

  state.nodes.forEach((node) => {
    refs.originSelect.appendChild(new Option(getNodeOptionLabel(node), node.id));
    refs.destinationSelect.appendChild(new Option(getNodeOptionLabel(node), node.id));
  });

  const defaultOrigin = state.nodeById.has("N1") ? "N1" : state.nodes[0]?.id || "";
  const defaultDestination = state.nodeById.has("N5")
    ? "N5"
    : state.nodes.at(-1)?.id || defaultOrigin;

  refs.originSelect.value = defaultOrigin;
  refs.destinationSelect.value = defaultDestination;
  renderNodeList();
}

function renderNodeList() {
  refs.nodeList.innerHTML = "";

  state.nodes.forEach((node) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "node-chip";
    button.classList.add(`is-${node.category}`);
    button.dataset.nodeId = node.id;
    button.title = getNodeTitle(node);
    button.append(
      createNodeChipText("node-chip__id", getNodeLabel(node)),
      createNodeChipText("node-chip__name", getNodeDisplayName(node))
    );
    button.addEventListener("click", () => selectNodeFromMap(node.id));
    refs.nodeList.appendChild(button);
  });
}

function createNodeChipText(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function toggleAdminMode() {
  state.adminMode = !state.adminMode;
  refs.adminPanel.classList.toggle("is-active", state.adminMode);
  refs.adminEditor.hidden = !state.adminMode;
  refs.adminToggleBtn.textContent = state.adminMode ? "Desativar" : "Ativar";

  if (state.adminMode && state.viewMode !== "mapbox") {
    setViewMode("mapbox");
  }

  renderBuildingAdminControls();
  updateMapboxAccessibilityData();
}

function renderBuildingAdminControls() {
  if (!refs.buildingSelect) {
    return;
  }

  const candidates = getBuildingCandidates();
  refs.buildingSelect.innerHTML = "";

  candidates.forEach((candidate, index) => {
    const buildingId = candidate.item.id || `building-${index + 1}`;
    const label = findNearestBuildingLabel(candidate.centroid);
    const defaultHeight = calculateDefaultBuildingHeight(candidate.area);
    const height = getBuildingHeight(buildingId, defaultHeight);
    const option = new Option(`${label?.name || buildingId} - ${roundNumber(height, 1)} m`, buildingId);
    refs.buildingSelect.appendChild(option);
  });

  if (!candidates.some((candidate, index) => (candidate.item.id || `building-${index + 1}`) === state.selectedBuildingId)) {
    state.selectedBuildingId = candidates[0]?.item.id || null;
  }

  refs.buildingSelect.disabled = !candidates.length;
  refs.buildingHeightInput.disabled = !candidates.length;
  refs.saveBuildingHeightBtn.disabled = !candidates.length;
  refs.resetBuildingHeightBtn.disabled = !candidates.length;
  refs.resetAllBuildingHeightsBtn.disabled = !state.buildingHeights.size;

  syncSelectedBuildingEditor();
}

function selectBuilding(buildingId) {
  if (!buildingId) {
    return;
  }

  state.selectedBuildingId = String(buildingId);
  syncSelectedBuildingEditor();
  updateMapboxAccessibilityData();
}

function syncSelectedBuildingEditor() {
  if (!refs.buildingSelect || !state.selectedBuildingId) {
    if (refs.buildingHeightInput) {
      refs.buildingHeightInput.value = "";
    }
    return;
  }

  const candidates = getBuildingCandidates();
  const selected = candidates.find((candidate, index) => (
    (candidate.item.id || `building-${index + 1}`) === state.selectedBuildingId
  ));

  if (!selected) {
    refs.buildingHeightInput.value = "";
    return;
  }

  const defaultHeight = calculateDefaultBuildingHeight(selected.area);
  refs.buildingSelect.value = state.selectedBuildingId;
  refs.buildingHeightInput.value = String(roundNumber(getBuildingHeight(state.selectedBuildingId, defaultHeight), 1));
}

function saveSelectedBuildingHeight() {
  if (!state.selectedBuildingId) {
    setStatus("Selecione um predio para editar a altura.", "warning");
    return;
  }

  const rawHeight = Number(refs.buildingHeightInput.value);
  if (!Number.isFinite(rawHeight)) {
    setStatus("Informe uma altura valida em metros.", "warning");
    return;
  }

  const height = clampNumber(rawHeight, DEFAULT_BUILDING_HEIGHT_MIN, DEFAULT_BUILDING_HEIGHT_MAX);
  state.buildingHeights.set(state.selectedBuildingId, roundNumber(height, 2));
  persistBuildingHeightOverrides();
  renderBuildingAdminControls();
  updateMapboxAccessibilityData();
  setStatus(`Altura do predio ${state.selectedBuildingId} salva com ${roundNumber(height, 1)} m.`, "success");
}

function resetSelectedBuildingHeight() {
  if (!state.selectedBuildingId) {
    return;
  }

  state.buildingHeights.delete(state.selectedBuildingId);
  persistBuildingHeightOverrides();
  renderBuildingAdminControls();
  updateMapboxAccessibilityData();
  setStatus(`Altura do predio ${state.selectedBuildingId} voltou ao valor automatico.`, "success");
}

function resetAllBuildingHeights() {
  state.buildingHeights.clear();
  persistBuildingHeightOverrides();
  renderBuildingAdminControls();
  updateMapboxAccessibilityData();
  setStatus("Todas as alturas editadas voltaram ao calculo automatico.", "success");
}

function renderMap() {
  clearSvgLayer(refs.backgroundLayer);
  clearSvgLayer(refs.edgeLayer);
  clearSvgLayer(refs.nodeLayer);
  clearSvgLayer(refs.routeLayer);

  if (!state.graphReady || !state.bounds) {
    return;
  }

  setViewBox(state.viewBox);
  renderBackground();
  renderEdges();
  renderNodes();
}

function renderBackground() {
  state.background.forEach((item) => {
    const path = createSvgElement("path", {
      class: "map-background",
      d: pointsToPath(item.points, item.closed)
    });

    path.dataset.layer = item.layer;
    path.dataset.type = item.type;
    refs.backgroundLayer.appendChild(path);
  });
}

function renderEdges() {
  state.edges.forEach((edge) => {
    const path = createSvgElement("path", {
      class: "map-edge",
      d: pointsToPath(edge.points)
    });

    path.dataset.segmentId = edge.id;
    refs.edgeLayer.appendChild(path);
  });
}

function renderNodes() {
  const metrics = getNodeVisualMetrics();

  state.nodes.forEach((node) => {
    const point = toSvgPoint(node.position);
    const group = createSvgElement("g", {
      class: `map-node is-${node.category}`,
      tabindex: "0",
      role: "button",
      "aria-label": getNodeTitle(node),
      transform: `translate(${point.x} ${point.y})`
    });
    group.dataset.nodeId = node.id;
    group.dataset.category = node.category;

    const hitTarget = createSvgElement("circle", {
      class: "map-node-hit"
    });
    const symbol = createNodeSymbol(node);
    const label = createSvgElement("text", {
      class: "map-node-label",
      x: 0,
      "text-anchor": "middle"
    });
    label.textContent = getNodeLabel(node);

    group.append(hitTarget, symbol, label);
    applyNodeSizing(group, metrics);
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      selectNodeFromMap(node.id);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNodeFromMap(node.id);
      }
    });

    refs.nodeLayer.appendChild(group);
  });
}

function createNodeSymbol(node) {
  const symbol = createSvgElement("g", {
    class: `map-node-symbol is-${node.category}`
  });

  if (node.category === "ramp") {
    symbol.appendChild(createSvgElement("path", {
      class: "map-node-shape map-node-ramp"
    }));
    return symbol;
  }

  if (node.category === "crosswalk") {
    symbol.appendChild(createSvgElement("rect", {
      class: "map-node-shape map-node-crosswalk-box"
    }));
    for (let index = 0; index < 3; index += 1) {
      symbol.appendChild(createSvgElement("line", {
        class: "map-node-mark",
        "data-stripe": index
      }));
    }
    return symbol;
  }

  if (node.category === "intersection") {
    symbol.appendChild(createSvgElement("path", {
      class: "map-node-shape map-node-intersection"
    }));
    symbol.appendChild(createSvgElement("line", {
      class: "map-node-mark",
      "data-axis": "x"
    }));
    symbol.appendChild(createSvgElement("line", {
      class: "map-node-mark",
      "data-axis": "y"
    }));
    return symbol;
  }

  symbol.appendChild(createSvgElement("circle", {
    class: "map-node-shape map-node-default"
  }));
  return symbol;
}

function calculateAndRenderRoute() {
  if (!state.graphReady) {
    return;
  }

  const originId = refs.originSelect.value;
  const destinationId = refs.destinationSelect.value;

  if (!originId || !destinationId) {
    clearRoute("Escolha origem e destino.");
    return;
  }

  if (originId === destinationId) {
    clearRoute("Origem e destino iguais.");
    return;
  }

  const route = findShortestPath(originId, destinationId);
  state.route = route;

  if (!route) {
    clearSvgLayer(refs.routeLayer);
    refs.routeDistance.textContent = "-";
    refs.pathText.textContent = "Sem conexao";
    refs.segmentList.innerHTML = "";
    updateMapboxAccessibilityData();
    setStatus(`Nao existe caminho conectado de ${originId} para ${destinationId}.`, "warning");
    syncActiveNodes();
    return;
  }

  renderRoute(route);
  updateMapboxAccessibilityData();
  refs.routeDistance.textContent = formatDistance(route.distance);
  refs.pathText.textContent = route.nodeIds.map(formatRouteNodeLabel).join(" -> ");
  renderSegmentList(route);
  syncActiveNodes();
  setStatus(`Rota calculada de ${originId} para ${destinationId}.`, "success");
}

function clearRoute(message) {
  state.route = null;
  clearSvgLayer(refs.routeLayer);
  updateMapboxAccessibilityData();
  refs.routeDistance.textContent = "-";
  refs.pathText.textContent = message;
  refs.segmentList.innerHTML = "";
  setStatus(message, "warning");
  syncActiveNodes();
}

function renderRoute(route) {
  clearSvgLayer(refs.routeLayer);

  const casing = createSvgElement("path", {
    class: "map-route-casing",
    d: pointsToPath(route.points)
  });
  const path = createSvgElement("path", {
    class: "map-route",
    d: pointsToPath(route.points)
  });

  refs.routeLayer.append(casing, path);
}

function updateMapboxAccessibilityData() {
  if (!state.mapboxReady || !state.threeDMap || !state.rawRouteBounds) {
    return;
  }

  const edgesSource = state.threeDMap.getSource("accessibility-edges");
  const routeSource = state.threeDMap.getSource("accessibility-route");
  const nodesSource = state.threeDMap.getSource("accessibility-nodes");
  const buildingsSource = state.threeDMap.getSource("accessibility-buildings");
  const buildingLabelsSource = state.threeDMap.getSource("accessibility-building-labels");

  if (!edgesSource || !routeSource || !nodesSource || !buildingsSource || !buildingLabelsSource) {
    return;
  }

  buildingsSource.setData(createBuildingsGeoJson());
  buildingLabelsSource.setData(createBuildingLabelsGeoJson());
  edgesSource.setData(createEdgesGeoJson());
  routeSource.setData(createRouteGeoJson());
  nodesSource.setData(createNodesGeoJson());
}

function createBuildingsGeoJson() {
  const candidates = getBuildingCandidates();

  return createFeatureCollection(candidates.map((candidate, index) => {
    const defaultHeight = calculateDefaultBuildingHeight(candidate.area);
    const buildingId = candidate.item.id || `building-${index + 1}`;
    const height = getBuildingHeight(buildingId, defaultHeight);
    const label = findNearestBuildingLabel(candidate.centroid);
    const coordinates = candidate.item.points.map(rawPointToLngLat);
    const first = coordinates[0];
    const last = coordinates.at(-1);

    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
      coordinates.push(first);
    }

    return {
      type: "Feature",
      properties: {
        id: buildingId,
        label: label?.name || buildingId,
        height: roundNumber(height, 2),
        defaultHeight: roundNumber(defaultHeight, 2),
        area: roundNumber(candidate.area, 2),
        selected: buildingId === state.selectedBuildingId
      },
      geometry: {
        type: "Polygon",
        coordinates: [coordinates]
      }
    };
  }));
}

function getBuildingCandidates() {
  const officialBuildings = state.buildings.filter((item) => item.closed && item.points.length >= 4);
  const seenSignatures = new Set();

  return officialBuildings
    .filter((item) => item.closed && item.points.length >= 4)
    .map((item) => ({
      item,
      area: calculatePolygonArea(item.points),
      centroid: calculatePolygonCentroid(item.points)
    }))
    .filter((candidate) => (
      candidate.area >= MAPBOX_BUILDING_MIN_AREA
        && isPointInsideExpandedBounds(candidate.centroid, state.rawRouteBounds, 0.75)
    ))
    .filter((candidate) => {
      const signature = getBuildingGeometrySignature(candidate);
      if (seenSignatures.has(signature)) {
        return false;
      }
      seenSignatures.add(signature);
      return true;
    })
    .sort((left, right) => right.area - left.area)
    .slice(0, MAPBOX_BUILDING_MAX_COUNT);
}

function getBuildingGeometrySignature(candidate) {
  const centroid = candidate.centroid || { x: 0, y: 0 };
  return [
    Math.round(centroid.x / 100),
    Math.round(centroid.y / 100),
    Math.round(candidate.area / 10000)
  ].join(":");
}

function calculateDefaultBuildingHeight(area) {
  return clampNumber(8 + Math.sqrt(area) / 5200, 8, 34);
}

function getBuildingHeight(buildingId, fallbackHeight) {
  const override = state.buildingHeights.get(buildingId);

  if (Number.isFinite(override)) {
    return override;
  }

  return fallbackHeight;
}

function findNearestBuildingLabel(point) {
  if (!point || !state.buildingLabels.length) {
    return null;
  }

  let bestLabel = null;
  let bestDistance = Infinity;

  state.buildingLabels.forEach((label) => {
    const distance = getPointDistance(point, label.position);
    if (distance < bestDistance) {
      bestLabel = label;
      bestDistance = distance;
    }
  });

  return bestLabel;
}

function createBuildingLabelsGeoJson() {
  return createFeatureCollection(state.buildingLabels.map((label) => ({
    type: "Feature",
    properties: {
      id: label.id,
      name: label.name,
      layer: label.layer
    },
    geometry: {
      type: "Point",
      coordinates: rawPointToLngLat(label.position)
    }
  })));
}

function createEdgesGeoJson() {
  return createFeatureCollection(state.edges.map((edge) => ({
    type: "Feature",
    properties: {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      length: edge.length
    },
    geometry: {
      type: "LineString",
      coordinates: edge.points.map(rawPointToLngLat)
    }
  })));
}

function createRouteGeoJson() {
  if (!state.route?.points?.length) {
    return createFeatureCollection([]);
  }

  return createFeatureCollection([{
    type: "Feature",
    properties: {
      distance: state.route.distance
    },
    geometry: {
      type: "LineString",
      coordinates: state.route.points.map(rawPointToLngLat)
    }
  }]);
}

function createNodesGeoJson() {
  const originId = refs.originSelect.value;
  const destinationId = refs.destinationSelect.value;
  const routeNodeIds = new Set(state.route?.nodeIds || []);

  return createFeatureCollection(state.nodes.map((node) => ({
    type: "Feature",
    properties: {
      id: node.id,
      category: node.category,
      label: getNodeLabel(node),
      title: getNodeTitle(node),
      status: node.id === originId
        ? "origin"
        : node.id === destinationId
          ? "destination"
          : routeNodeIds.has(node.id)
            ? "route"
            : "default"
    },
    geometry: {
      type: "Point",
      coordinates: rawPointToLngLat(node.position)
    }
  })));
}

function createFeatureCollection(features) {
  return {
    type: "FeatureCollection",
    features
  };
}

function rawPointToLngLat(point) {
  const bounds = state.rawRouteBounds || calculateBounds([point]);
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const xRatio = clampNumber((point.x - bounds.minX) / width, 0, 1);
  const yRatio = clampNumber((point.y - bounds.minY) / height, 0, 1);

  const lng = MAPBOX_ACCESSIBILITY_BOUNDS.west
    + xRatio * (MAPBOX_ACCESSIBILITY_BOUNDS.east - MAPBOX_ACCESSIBILITY_BOUNDS.west);
  const lat = MAPBOX_ACCESSIBILITY_BOUNDS.south
    + yRatio * (MAPBOX_ACCESSIBILITY_BOUNDS.north - MAPBOX_ACCESSIBILITY_BOUNDS.south);

  return [roundNumber(lng, 7), roundNumber(lat, 7)];
}

function fitMapboxAccessibilityBounds() {
  if (!state.threeDMap || !state.nodes.length) {
    return;
  }

  const bounds = new mapboxgl.LngLatBounds();
  state.nodes.forEach((node) => bounds.extend(rawPointToLngLat(node.position)));

  if (!bounds.isEmpty()) {
    state.threeDMap.fitBounds(bounds, {
      padding: 80,
      pitch: 45,
      bearing: -17.6,
      duration: 700
    });
  }
}

function renderSegmentList(route) {
  refs.segmentList.innerHTML = "";

  route.edges.forEach((edge, index) => {
    const item = document.createElement("li");
    item.textContent = `${index + 1}. ${edge.from} -> ${edge.to} (${formatDistance(edge.length)})`;
    refs.segmentList.appendChild(item);
  });
}

function syncActiveNodes() {
  const originId = refs.originSelect.value;
  const destinationId = refs.destinationSelect.value;
  const routeNodeIds = new Set(state.route?.nodeIds || []);

  refs.nodeLayer.querySelectorAll(".map-node").forEach((nodeElement) => {
    const nodeId = nodeElement.dataset.nodeId;
    nodeElement.classList.toggle("is-origin", nodeId === originId);
    nodeElement.classList.toggle("is-destination", nodeId === destinationId);
    nodeElement.classList.toggle("is-in-route", routeNodeIds.has(nodeId));
  });

  refs.nodeList.querySelectorAll(".node-chip").forEach((button) => {
    const nodeId = button.dataset.nodeId;
    button.classList.toggle("is-origin", nodeId === originId);
    button.classList.toggle("is-destination", nodeId === destinationId);
    button.classList.toggle("is-in-route", routeNodeIds.has(nodeId));
  });
}

function findShortestPath(originId, destinationId) {
  const distances = new Map(state.nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const previous = new Map();
  const unvisited = new Set(state.nodes.map((node) => node.id));

  distances.set(originId, 0);

  while (unvisited.size > 0) {
    const currentId = getClosestUnvisitedNode(unvisited, distances);

    if (!currentId || distances.get(currentId) === Number.POSITIVE_INFINITY) {
      break;
    }

    unvisited.delete(currentId);

    if (currentId === destinationId) {
      break;
    }

    (state.adjacency.get(currentId) || []).forEach((edge) => {
      if (!unvisited.has(edge.to)) {
        return;
      }

      const nextDistance = distances.get(currentId) + edge.length;
      if (nextDistance < distances.get(edge.to)) {
        distances.set(edge.to, nextDistance);
        previous.set(edge.to, { nodeId: currentId, edge });
      }
    });
  }

  if (!previous.has(destinationId)) {
    return null;
  }

  const routeNodeIds = [destinationId];
  const routeEdges = [];
  let cursor = destinationId;

  while (cursor !== originId) {
    const step = previous.get(cursor);

    if (!step) {
      return null;
    }

    routeEdges.unshift(step.edge);
    routeNodeIds.unshift(step.nodeId);
    cursor = step.nodeId;
  }

  return {
    distance: roundNumber(distances.get(destinationId), 2),
    edges: routeEdges,
    nodeIds: routeNodeIds,
    points: mergeRoutePoints(routeEdges)
  };
}

function getClosestUnvisitedNode(unvisited, distances) {
  let closestId = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  unvisited.forEach((nodeId) => {
    const distance = distances.get(nodeId);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestId = nodeId;
    }
  });

  return closestId;
}

function mergeRoutePoints(routeEdges) {
  const points = [];

  routeEdges.forEach((edge) => {
    edge.points.forEach((point) => {
      const previousPoint = points.at(-1);
      if (!previousPoint || getPointDistance(previousPoint, point) > DUPLICATE_POINT_EPSILON) {
        points.push(point);
      }
    });
  });

  return points;
}

function swapRouteEndpoints() {
  const originId = refs.originSelect.value;
  refs.originSelect.value = refs.destinationSelect.value;
  refs.destinationSelect.value = originId;
  calculateAndRenderRoute();
}

function selectNodeFromMap(nodeId) {
  if (state.pickTarget === "origin") {
    refs.originSelect.value = nodeId;
    setPickTarget("destination");
  } else {
    refs.destinationSelect.value = nodeId;
    setPickTarget("origin");
  }

  calculateAndRenderRoute();
}

function setPickTarget(target) {
  state.pickTarget = target === "destination" ? "destination" : "origin";
  refs.pickOriginBtn.classList.toggle("is-active", state.pickTarget === "origin");
  refs.pickDestinationBtn.classList.toggle("is-active", state.pickTarget === "destination");
}

function calculateRawBounds(rawData, nodes, options = {}) {
  const includeBackground = options.includeBackground !== false;
  const points = [
    ...nodes.map((node) => node.position),
    ...(rawData.polylines || []).flatMap((polyline) => (polyline.points || []).map(normalizePoint).filter(Boolean)),
    ...(includeBackground
      ? [
          ...(rawData.background || []).flatMap((item) => (item.points || []).map(normalizePoint).filter(Boolean)),
          ...(rawData.buildings || []).flatMap((building) => (building.points || []).map(normalizePoint).filter(Boolean)),
          ...(rawData.buildingLabels || []).map((label) => normalizePoint(label.position)).filter(Boolean)
        ]
      : [])
  ];

  return calculateBounds(points);
}

function calculateSvgBounds(rawData, nodes, options = {}) {
  const rawBounds = calculateRawBounds(rawData, nodes, options);
  return rawBoundsToSvgBounds(rawBounds);
}

function rawBoundsToSvgBounds(rawBounds) {
  return {
    minX: rawBounds.minX,
    maxX: rawBounds.maxX,
    minY: -rawBounds.maxY,
    maxY: -rawBounds.minY
  };
}

function expandRawBounds(bounds, margin) {
  return {
    minX: bounds.minX - margin,
    maxX: bounds.maxX + margin,
    minY: bounds.minY - margin,
    maxY: bounds.maxY + margin
  };
}

function getDisplayMargin(bounds) {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  return Math.max(Math.hypot(width, height) * 0.18, 30000);
}

function calculateBounds(points) {
  const fallback = { minX: 0, maxX: 100, minY: 0, maxY: 100 };

  if (!points.length) {
    return fallback;
  }

  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxY: Math.max(bounds.maxY, point.y)
  }), {
    minX: points[0].x,
    maxX: points[0].x,
    minY: points[0].y,
    maxY: points[0].y
  });
}

function calculatePolygonArea(points) {
  if (!points.length) {
    return 0;
  }

  let area = 0;
  for (let index = 0, previousIndex = points.length - 1; index < points.length; previousIndex = index, index += 1) {
    area += (points[previousIndex].x + points[index].x) * (points[previousIndex].y - points[index].y);
  }

  return Math.abs(area / 2);
}

function calculatePolygonCentroid(points) {
  if (!points.length) {
    return { x: 0, y: 0, z: 0 };
  }

  const total = points.reduce((sum, point) => ({
    x: sum.x + point.x,
    y: sum.y + point.y,
    z: sum.z + (point.z || 0)
  }), { x: 0, y: 0, z: 0 });

  return {
    x: total.x / points.length,
    y: total.y / points.length,
    z: total.z / points.length
  };
}

function isPointInsideExpandedBounds(point, bounds, expansionRatio = 0) {
  if (!point || !bounds) {
    return false;
  }

  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const xMargin = width * expansionRatio;
  const yMargin = height * expansionRatio;

  return point.x >= bounds.minX - xMargin
    && point.x <= bounds.maxX + xMargin
    && point.y >= bounds.minY - yMargin
    && point.y <= bounds.maxY + yMargin;
}

function buildViewBox(bounds) {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const padding = Math.max(width, height) * 0.12;

  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: width + padding * 2,
    height: height + padding * 2
  };
}

function getSnapTolerance(bounds) {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  return Math.max(Math.hypot(width, height) * 0.004, 0.5);
}

function handleMapWheel(event) {
  if (!state.viewBox) {
    return;
  }

  event.preventDefault();
  const factor = event.deltaY < 0 ? 0.88 : 1.14;
  zoomView(factor, getSvgPointFromEvent(event));
}

function handlePointerDown(event) {
  if (!state.viewBox || event.target.closest(".map-node")) {
    return;
  }

  refs.svg.setPointerCapture(event.pointerId);
  state.dragging = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    viewBox: { ...state.viewBox }
  };
  refs.svg.classList.add("is-dragging");
}

function handlePointerMove(event) {
  if (!state.dragging || event.pointerId !== state.dragging.pointerId) {
    return;
  }

  const rect = refs.svg.getBoundingClientRect();
  const deltaX = event.clientX - state.dragging.x;
  const deltaY = event.clientY - state.dragging.y;

  state.viewBox = {
    ...state.dragging.viewBox,
    x: state.dragging.viewBox.x - deltaX * (state.dragging.viewBox.width / rect.width),
    y: state.dragging.viewBox.y - deltaY * (state.dragging.viewBox.height / rect.height)
  };
  setViewBox(state.viewBox);
}

function stopDragging(event) {
  if (!state.dragging) {
    return;
  }

  if (event?.pointerId === state.dragging.pointerId && refs.svg.hasPointerCapture(event.pointerId)) {
    refs.svg.releasePointerCapture(event.pointerId);
  }

  state.dragging = null;
  refs.svg.classList.remove("is-dragging");
}

function zoomView(factor, focalPoint = null) {
  if (!state.viewBox) {
    return;
  }

  const center = focalPoint || {
    x: state.viewBox.x + state.viewBox.width / 2,
    y: state.viewBox.y + state.viewBox.height / 2
  };
  const nextWidth = state.viewBox.width * factor;
  const nextHeight = state.viewBox.height * factor;
  const xRatio = (center.x - state.viewBox.x) / state.viewBox.width;
  const yRatio = (center.y - state.viewBox.y) / state.viewBox.height;

  state.viewBox = {
    x: center.x - nextWidth * xRatio,
    y: center.y - nextHeight * yRatio,
    width: nextWidth,
    height: nextHeight
  };
  setViewBox(state.viewBox);
  updateNodeSizing();
}

function resetView() {
  if (!state.baseViewBox) {
    return;
  }

  state.viewBox = { ...state.baseViewBox };
  setViewBox(state.viewBox);
  updateNodeSizing();
}

function setViewBox(viewBox) {
  refs.svg.setAttribute(
    "viewBox",
    `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`
  );
}

function updateNodeSizing() {
  if (!refs.nodeLayer) {
    return;
  }

  const metrics = getNodeVisualMetrics();
  refs.nodeLayer.querySelectorAll(".map-node").forEach((group) => {
    applyNodeSizing(group, metrics);
  });
}

function getNodeVisualMetrics() {
  const viewBox = state.viewBox || state.baseViewBox || { width: 100, height: 100 };
  const baseViewBox = state.baseViewBox || viewBox;
  const rect = refs.svg?.getBoundingClientRect?.() || { width: 1000, height: 700 };
  const unitsPerPixel = Math.max(
    viewBox.width / Math.max(rect.width || 1, 1),
    viewBox.height / Math.max(rect.height || 1, 1)
  );
  const zoomRatio = Math.max(
    Math.min(viewBox.width / Math.max(baseViewBox.width, 1), viewBox.height / Math.max(baseViewBox.height, 1)),
    0.02
  );
  const screenRadius = clampNumber(20 * Math.pow(zoomRatio, 0.65), 6, 20);
  const radius = screenRadius * unitsPerPixel;

  return {
    radius,
    screenRadius,
    strokeWidth: Math.max(unitsPerPixel * 2.1, radius * 0.12),
    markWidth: Math.max(unitsPerPixel * 1.7, radius * 0.1),
    labelSize: radius * 0.82,
    showLabel: screenRadius >= 8
  };
}

function applyNodeSizing(group, metrics) {
  const radius = metrics.radius;
  const hitTarget = group.querySelector(".map-node-hit");
  const label = group.querySelector(".map-node-label");
  const defaultCircle = group.querySelector(".map-node-default");
  const ramp = group.querySelector(".map-node-ramp");
  const crosswalkBox = group.querySelector(".map-node-crosswalk-box");
  const intersection = group.querySelector(".map-node-intersection");

  if (hitTarget) {
    hitTarget.setAttribute("r", String(radius * 1.45));
  }

  if (defaultCircle) {
    defaultCircle.setAttribute("r", String(radius));
  }

  if (ramp) {
    ramp.setAttribute(
      "d",
      `M 0 ${-radius * 1.18} L ${radius * 1.16} ${radius * 0.9} L ${-radius * 1.16} ${radius * 0.9} Z`
    );
  }

  if (crosswalkBox) {
    crosswalkBox.setAttribute("x", String(-radius * 1.15));
    crosswalkBox.setAttribute("y", String(-radius * 0.76));
    crosswalkBox.setAttribute("width", String(radius * 2.3));
    crosswalkBox.setAttribute("height", String(radius * 1.52));
    group.querySelectorAll("[data-stripe]").forEach((stripe, index) => {
      const offset = (index - 1) * radius * 0.55;
      stripe.setAttribute("x1", String(offset - radius * 0.28));
      stripe.setAttribute("y1", String(-radius * 0.58));
      stripe.setAttribute("x2", String(offset + radius * 0.28));
      stripe.setAttribute("y2", String(radius * 0.58));
    });
  }

  if (intersection) {
    intersection.setAttribute(
      "d",
      `M 0 ${-radius * 1.2} L ${radius * 1.2} 0 L 0 ${radius * 1.2} L ${-radius * 1.2} 0 Z`
    );
    group.querySelector("[data-axis='x']")?.setAttribute("x1", String(-radius * 0.72));
    group.querySelector("[data-axis='x']")?.setAttribute("y1", "0");
    group.querySelector("[data-axis='x']")?.setAttribute("x2", String(radius * 0.72));
    group.querySelector("[data-axis='x']")?.setAttribute("y2", "0");
    group.querySelector("[data-axis='y']")?.setAttribute("x1", "0");
    group.querySelector("[data-axis='y']")?.setAttribute("y1", String(-radius * 0.72));
    group.querySelector("[data-axis='y']")?.setAttribute("x2", "0");
    group.querySelector("[data-axis='y']")?.setAttribute("y2", String(radius * 0.72));
  }

  group.querySelectorAll(".map-node-shape").forEach((shape) => {
    shape.setAttribute("stroke-width", String(metrics.strokeWidth));
  });
  group.querySelectorAll(".map-node-mark").forEach((mark) => {
    mark.setAttribute("stroke-width", String(metrics.markWidth));
  });

  if (label) {
    label.setAttribute("y", String(radius * 1.82));
    label.setAttribute("font-size", String(metrics.labelSize));
    label.style.display = metrics.showLabel ? "" : "none";
  }
}

function getSvgPointFromEvent(event) {
  const rect = refs.svg.getBoundingClientRect();
  return {
    x: state.viewBox.x + ((event.clientX - rect.left) / rect.width) * state.viewBox.width,
    y: state.viewBox.y + ((event.clientY - rect.top) / rect.height) * state.viewBox.height
  };
}

function pointsToPath(points, closed = false) {
  const commands = points
    .map(toSvgPoint)
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  return closed ? `${commands} Z` : commands;
}

function toSvgPoint(point) {
  return {
    x: point.x,
    y: -point.y
  };
}

function createSvgElement(tagName, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tagName);

  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, String(value));
  });

  return element;
}

function clearSvgLayer(layer) {
  layer.replaceChildren();
}

function calculatePolylineLength(points) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += getPointDistance(points[index - 1], points[index]);
  }

  return roundNumber(total, 4);
}

function getPointDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDistance(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const meters = value / MILLIMETERS_PER_METER;
  return `${roundNumber(meters, 2).toLocaleString("pt-BR")} m`;
}

function naturalCompare(left, right) {
  return String(left).localeCompare(String(right), "pt-BR", {
    numeric: true,
    sensitivity: "base"
  });
}

function buildLoadedStatus(rawData) {
  const sourceName = String(rawData.source || "DWG").split(/[\\/]/).at(-1);
  const counts = countNodeCategories(state.nodes);
  const buildingCount = getBuildingCandidates().length;
  const buildingText = buildingCount
    ? `, ${buildingCount} blocos 3D`
    : "";
  const details = [
    counts.ramp ? `${counts.ramp} rampas` : "",
    counts.crosswalk ? `${counts.crosswalk} travessias` : "",
    counts.intersection ? `${counts.intersection} cruzamentos` : ""
  ].filter(Boolean).join(", ");
  const featureText = details ? ` (${details})` : "";
  return `${sourceName}: ${state.nodes.length} nos${featureText}, ${state.edges.length} ligacoes${buildingText} e ${state.background.length} linhas de planta carregadas.`;
}

function setStatus(text, tone = "info") {
  refs.statusText.textContent = text;
  refs.statusText.dataset.tone = tone;
}

function normalizeNodeCategory(category, type = "") {
  const normalized = normalizeVoiceText(category || type || "node").replace(/\s+/g, "_");
  const typeNormalized = normalizeVoiceText(type || "").replace(/\s+/g, "_");
  const candidate = normalized === "node" && typeNormalized ? typeNormalized : normalized;
  const categoryMap = {
    acessivel: "accessible_entrance",
    accessible: "accessible_entrance",
    accessible_entrance: "accessible_entrance",
    banheiro: "restroom",
    crosswalk: "crosswalk",
    door: "door",
    elevator: "elevator",
    elevador: "elevator",
    entrada: "entrance",
    entrance: "entrance",
    faixa: "crosswalk",
    intersection: "intersection",
    intersecao: "intersection",
    node: "node",
    porta: "door",
    ramp: "ramp",
    rampa: "ramp",
    restroom: "restroom",
    travessia: "crosswalk"
  };

  return categoryMap[candidate] || "node";
}

function getNodeLabel(node) {
  const prefixes = {
    accessible_entrance: "EA",
    door: "P",
    elevator: "E",
    entrance: "EN",
    ramp: "R",
    restroom: "B",
    crosswalk: "T",
    intersection: "C",
    node: ""
  };
  const id = String(node.id || "").trim();
  const prefix = prefixes[node.category] || "";

  if (!prefix || id.toUpperCase().startsWith(prefix)) {
    return id;
  }

  return `${prefix}-${id}`;
}

function getNodeDisplayName(node) {
  return node.name
    || getNodeAttribute(node, "descricao", "descrição", "description", "label")
    || getNodeAttribute(node, "bloco", "block", "building", "predio", "prédio")
    || node.type
    || node.blockName
    || "Sem descricao";
}

function getNodeOptionLabel(node) {
  const label = getNodeLabel(node);
  const displayName = getNodeDisplayName(node);

  return displayName && displayName !== "Sem descricao"
    ? `${label} - ${displayName}`
    : label;
}

function formatRouteNodeLabel(nodeId) {
  const node = state.nodeById.get(nodeId);

  if (!node) {
    return nodeId;
  }

  const displayName = getNodeDisplayName(node);
  return displayName && displayName !== "Sem descricao"
    ? `${getNodeLabel(node)} (${displayName})`
    : getNodeLabel(node);
}

function getNodeTitle(node) {
  const names = {
    accessible_entrance: "Entrada acessivel",
    door: "Porta",
    elevator: "Elevador",
    entrance: "Entrada",
    ramp: "Rampa",
    restroom: "Banheiro",
    crosswalk: "Travessia",
    intersection: "Cruzamento",
    node: "No"
  };
  const parts = [
    node.name || `${names[node.category] || "No"} ${node.id}`,
    node.id ? `id ${node.id}` : "",
    node.flow ? `fluxo ${node.flow}` : "",
    node.level ? `nivel ${node.level}` : "",
    node.accessible ? "acessivel" : "",
    node.blockName ? `bloco ${node.blockName}` : "",
    node.layer ? `layer ${node.layer}` : ""
  ].filter(Boolean);

  return parts.join(" | ");
}

function countNodeCategories(nodes) {
  return nodes.reduce((counts, node) => {
    counts[node.category] = (counts[node.category] || 0) + 1;
    return counts;
  }, {});
}
