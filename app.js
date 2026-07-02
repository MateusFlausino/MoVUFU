const DATA_URL = "data/dwg-map-raw.json";
const OSM_ACCESSIBILITY_URL = "data/osm-santa-monica-accessibility.geojson";
const OSM_OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const OSM_CAMPUS_BOUNDARY_ID = 804592441;
const OSM_CAMPUS_BBOX = [-18.92084, -48.26232, -18.91589, -48.25386];
const OSM_LIVE_TIMEOUT_MS = 20000;
const OSM_ROUTABLE_HIGHWAYS = new Set([
  "footway", "path"
]);
const SVG_NS = "http://www.w3.org/2000/svg";
const DUPLICATE_POINT_EPSILON = 0.000001;
const MILLIMETERS_PER_METER = 1000;
let MAPBOX_ACCESS_TOKEN = window.MOVUFU_MAPBOX_TOKEN || window.localStorage?.getItem("movufu-mapbox-token") || "";
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
const VOICE_LISTENING_TIMEOUT_MS = 15000;
const VOICE_MAX_ALTERNATIVES = 5;
const VOICE_GENETIC_DEFAULT_WEIGHTS = Object.freeze({
  phrase: 4.8,
  compact: 3.6,
  token: 1.7,
  edit: 2.4,
  blockCode: 5.5
});
const VOICE_GENETIC_POPULATION_SIZE = 8;
const VOICE_GENETIC_GENERATIONS = 5;
const VOICE_GENETIC_STORAGE_PREFIX = "movufu-voice-ga:v1:";
const PORTUGUESE_SPOKEN_LETTERS = {
  a: "a", be: "b", b: "b", ce: "c", c: "c", de: "d", d: "d", e: "e",
  efe: "f", f: "f", ge: "g", g: "g", aga: "h", h: "h", i: "i", jota: "j", j: "j",
  ka: "k", k: "k", ele: "l", l: "l", eme: "m", m: "m", ene: "n", n: "n", o: "o",
  pe: "p", p: "p", que: "q", q: "q", erre: "r", r: "r", esse: "s", s: "s",
  te: "t", t: "t", u: "u", ve: "v", v: "v", xis: "x", x: "x", ze: "z", z: "z"
};
const PORTUGUESE_LETTER_NAMES = {
  a: "a", b: "be", c: "ce", d: "de", e: "e", f: "efe", g: "ge", h: "aga", i: "i",
  j: "jota", k: "ka", l: "ele", m: "eme", n: "ene", o: "o", p: "pe", q: "que",
  r: "erre", s: "esse", t: "te", u: "u", v: "ve", x: "xis", z: "ze"
};

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
  gesturePointers: new Map(),
  installPromptEvent: null,
  mapboxReady: false,
  nodes: [],
  nodeById: new Map(),
  osmAccessibilityLayer: null,
  osmAdjacency: new Map(),
  osmDestinations: [],
  osmGeoJson: null,
  osmGraphNodes: new Map(),
  osmMap: null,
  osmReady: false,
  osmRouteLayer: null,
  pickTarget: "origin",
  rawData: null,
  rawRouteBounds: null,
  route: null,
  selectedBuildingId: null,
  threeDMap: null,
  voiceHadResult: false,
  voiceGeneticFitness: 0,
  voiceGeneticWeights: { ...VOICE_GENETIC_DEFAULT_WEIGHTS },
  voiceLastError: null,
  voiceListening: false,
  voiceMatchCache: new Map(),
  voiceSpeechDetected: false,
  voiceRecognition: null,
  voiceStopTimer: null,
  viewMode: "osm",
  viewBox: null
};

const refs = {};

document.addEventListener("DOMContentLoaded", initializeApp);

async function initializeApp() {
  cacheDom();
  bindEvents();
  window.lucide?.createIcons();
  initializeMapboxMap();
  await initializeOsmMap();
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Nao foi possivel registrar o service worker.", error);
    });
  });
}

function prepareInstallHint() {
  if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
    refs.installAppBtn.hidden = true;
    return;
  }

  if (isIosDevice()) {
    refs.installAppBtn.hidden = false;
    refs.installAppBtn.textContent = "Instalar";
  }
}

function handleBeforeInstallPrompt(event) {
  event.preventDefault();
  state.installPromptEvent = event;
  refs.installAppBtn.hidden = false;
  refs.installAppBtn.textContent = "Instalar";
}

async function installApp() {
  if (state.installPromptEvent) {
    state.installPromptEvent.prompt();
    await state.installPromptEvent.userChoice.catch(() => null);
    state.installPromptEvent = null;
    refs.installAppBtn.hidden = true;
    return;
  }

  if (isIosDevice()) {
    setStatus("No iPhone, toque em Compartilhar e depois em Adicionar a Tela de Inicio.", "info");
    return;
  }

  setStatus("Use o menu do navegador e escolha Instalar app ou Adicionar a tela inicial.", "info");
}

function handleAppInstalled() {
  state.installPromptEvent = null;
  refs.installAppBtn.hidden = true;
  setStatus("MoV UFU instalado com sucesso.", "success");
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function cacheDom() {
  refs.routeForm = document.getElementById("routeForm");
  refs.originSelect = document.getElementById("originSelect");
  refs.destinationSelect = document.getElementById("destinationSelect");
  refs.swapBtn = document.getElementById("swapBtn");
  refs.toggleNavBtn = document.getElementById("toggleNavBtn");
  refs.installAppBtn = document.getElementById("installAppBtn");
  refs.navigatorCard = document.getElementById("navigatorCard");
  refs.voiceCommandForm = document.getElementById("voiceCommandForm");
  refs.voicePanelToggleBtn = document.getElementById("voicePanelToggleBtn");
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
  refs.routeDuration = document.getElementById("routeDuration");
  refs.clearRouteBtn = document.getElementById("clearRouteBtn");
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
  refs.osmViewBtn = document.getElementById("osmViewBtn");
  refs.svg = document.getElementById("campusMap");
  refs.mapboxMap = document.getElementById("mapboxMap");
  refs.osmMap = document.getElementById("osmMap");
  refs.backgroundLayer = document.getElementById("backgroundLayer");
  refs.buildingLayer = document.getElementById("buildingLayer");
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
  refs.toggleNavBtn.addEventListener("click", toggleNavigatorCard);
  refs.installAppBtn.addEventListener("click", installApp);
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
  refs.mapboxViewBtn.addEventListener("click", activateMapboxView);
  refs.osmViewBtn.addEventListener("click", () => setViewMode("osm"));
  refs.voiceBtn.addEventListener("click", toggleVoiceRecognition);
  refs.voicePanelToggleBtn.addEventListener("click", toggleVoiceRecognition);
  refs.clearRouteBtn.addEventListener("click", () => clearOsmRoute("Escolha uma nova origem e destino."));
  refs.voiceCommandForm.addEventListener("submit", handleManualVoiceCommand);

  refs.svg.addEventListener("wheel", handleMapWheel, { passive: false });
  refs.svg.addEventListener("pointerdown", handlePointerDown);
  refs.svg.addEventListener("pointermove", handlePointerMove);
  refs.svg.addEventListener("pointerup", stopDragging);
  refs.svg.addEventListener("pointerleave", stopDragging);
  refs.svg.addEventListener("pointercancel", stopDragging);
  window.addEventListener("resize", updateNodeSizing);
  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", handleAppInstalled);

  initializeVoiceRecognition();
  registerServiceWorker();
  prepareInstallHint();
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
  recognition.interimResults = true;
  recognition.maxAlternatives = VOICE_MAX_ALTERNATIVES;

  recognition.addEventListener("start", () => {
    state.voiceListening = true;
    state.voiceHadResult = false;
    state.voiceLastError = null;
    state.voiceSpeechDetected = false;
    refs.voiceBtn.textContent = "●";
    refs.voiceBtn.classList.add("is-listening");
    refs.voicePanelToggleBtn.classList.add("is-active");
    setStatus("Microfone ativo. Diga a origem e o destino.", "info");
    refs.voicePanel.classList.add("is-listening");
    refs.voiceState.textContent = "Ouvindo...";
    clearTimeout(state.voiceStopTimer);
    state.voiceStopTimer = setTimeout(() => recognition.stop(), VOICE_LISTENING_TIMEOUT_MS);
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
    clearTimeout(state.voiceStopTimer);
    state.voiceStopTimer = null;
    refs.voiceBtn.textContent = "🎙";
    refs.voiceBtn.classList.remove("is-listening");
    refs.voicePanelToggleBtn.classList.remove("is-active");
    refs.voicePanel.classList.remove("is-listening");

    if (!state.voiceLastError && !state.voiceHadResult && !state.voiceSpeechDetected) {
      refs.voiceState.textContent = "Nao detectei fala. Verifique o microfone ou tente falar mais perto.";
    }
  });

  recognition.addEventListener("error", (event) => {
    state.voiceLastError = event.error || "unknown";
    refs.voiceState.textContent = getVoiceErrorMessage(event.error);
    setStatus(getVoiceErrorMessage(event.error), "error");
  });

  recognition.addEventListener("result", (event) => {
    const result = event.results?.[event.resultIndex];

    if (!result) {
      return;
    }

    const alternatives = Array.from(result)
      .map((alternative) => ({
        confidence: Number(alternative.confidence || 0),
        transcript: String(alternative.transcript || "").trim()
      }))
      .filter((alternative) => alternative.transcript);
    const bestAlternative = selectBestVoiceAlternative(alternatives);

    if (!result.isFinal) {
      refs.voiceState.textContent = bestAlternative
        ? `Ouvindo: ${bestAlternative.transcript}...`
        : "Ouvindo...";
      return;
    }

    state.voiceHadResult = true;
    clearTimeout(state.voiceStopTimer);
    state.voiceStopTimer = null;
    recognition.stop();
    processVoiceCommand(bestAlternative?.transcript || alternatives[0]?.transcript || "");
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
  const hasRouteSeparator = command.split(" ").some((word) => ["para", "ate"].includes(word));
  const routePair = findVoiceRoutePair(command);
  const originId = routePair?.originId
    || (!hasRouteSeparator && findNodeAfterVoiceKeyword(command, ["origem", "de", "do", "da", "dos", "das", "desde", "partida", "inicio", "saindo"]));
  const destinationId = routePair?.destinationId
    || (!hasRouteSeparator && findNodeAfterVoiceKeyword(command, ["destino", "para", "ate", "chegada", "fim"]));
  let changed = false;

  if (hasRouteSeparator && !routePair) {
    refs.voiceState.textContent = `Nao consegui confirmar os dois blocos em “${transcript}”. Fale, por exemplo: do bloco 1E para o bloco 3E.`;
    return;
  }

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
    refs.destinationSelect.value = looseNodeId;
    calculateAndRenderRoute();
    refs.voiceState.textContent = `Entendi “${transcript}”. Destino: ${getNodeOptionLabel(state.nodeById.get(looseNodeId))}.`;
    return;
  }

  refs.voiceState.textContent = `Nao entendi: ${transcript}.`;

  if (command.includes("bloco") || command.includes("predio")) {
    refs.voiceState.textContent = `Nao encontrei esse bloco no mapa carregado: ${transcript}. Verifique se o DWG foi reexportado com DESCRISSAO ou BLOCO nos nos.`;
  }
}

function findVoiceRoutePair(command) {
  const words = normalizeVoiceText(command).split(" ").filter(Boolean);
  const separatorIndex = words.findIndex((word) => ["para", "ate"].includes(word));

  if (separatorIndex <= 0 || separatorIndex >= words.length - 1) {
    return null;
  }

  const originText = words.slice(0, separatorIndex).join(" ");
  const destinationText = words.slice(separatorIndex + 1).join(" ");
  const originId = findNodeInVoiceText(originText);
  const destinationId = findNodeInVoiceText(destinationText);

  return originId && destinationId ? { originId, destinationId } : null;
}

function findNodeAfterVoiceKeyword(command, keywords) {
  const words = command.split(" ").filter(Boolean);

  for (const keyword of keywords) {
    const keywordIndex = words.indexOf(keyword);

    if (keywordIndex !== -1) {
      const nextStopIndex = words.findIndex((word, index) => {
        return index > keywordIndex && ["origem", "de", "do", "da", "dos", "das", "destino", "para", "ate", "chegada", "fim"].includes(word);
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
  if (state.voiceMatchCache.has(normalizedText)) {
    return state.voiceMatchCache.get(normalizedText);
  }
  const matches = [];

  state.nodes.forEach((node) => {
    let bestScore = 0;

    buildVoiceNodeAliases(node).forEach((alias) => {
      const normalizedAlias = normalizeVoiceComparable(alias);

      if (!normalizedAlias) {
        return;
      }
      bestScore = Math.max(bestScore, scoreVoiceAlias(normalizedText, normalizedAlias, state.voiceGeneticWeights));
    });

    if (bestScore > 0) {
      matches.push({ id: node.id, score: bestScore });
    }
  });

  matches.sort((left, right) => right.score - left.score || naturalCompare(left.id, right.id));

  const minimumScore = 4.5;
  const minimumMargin = 0.35;

  if (!matches.length || matches[0].score < minimumScore || (matches[1] && matches[0].score - matches[1].score < minimumMargin)) {
    state.voiceMatchCache.set(normalizedText, null);
    return null;
  }

  state.voiceMatchCache.set(normalizedText, matches[0].id);
  return matches[0].id;
}

function scoreVoiceAlias(text, alias, weights = VOICE_GENETIC_DEFAULT_WEIGHTS) {
  const features = getVoiceMatchFeatures(text, alias);
  return scoreVoiceFeatures(features, weights);
}

function scoreVoiceFeatures(features, weights) {
  return features.phrase * weights.phrase
    + features.compact * weights.compact
    + features.token * weights.token
    + features.edit * weights.edit
    + features.blockCode * weights.blockCode;
}

function getVoiceMatchFeatures(text, alias) {
  const textCompact = text.replace(/\s+/g, "");
  const aliasCompact = alias.replace(/\s+/g, "");
  const textTokens = new Set(text.split(" ").filter(Boolean));
  const aliasTokens = new Set(alias.split(" ").filter(Boolean));
  const sharedTokens = [...aliasTokens].filter((token) => textTokens.has(token)).length;
  const tokenUnion = new Set([...textTokens, ...aliasTokens]).size || 1;
  const maxLength = Math.max(text.length, alias.length, 1);
  const edit = 1 - (levenshteinDistance(text, alias) / maxLength);
  const textCode = extractVoiceBlockCode(text);
  const aliasCode = extractVoiceBlockCode(alias);

  return {
    phrase: containsVoicePhrase(text, alias) ? 1 : 0,
    compact: aliasCompact.length >= 2 && textCompact.includes(aliasCompact) ? 1 : 0,
    token: sharedTokens / tokenUnion,
    edit: Math.max(0, edit),
    blockCode: textCode && aliasCode && textCode === aliasCode ? 1 : 0
  };
}

function extractVoiceBlockCode(value) {
  return normalizeVoiceComparable(value).match(/\b(\d+[a-z](?:-[a-z]+)?)\b/i)?.[1]?.toLowerCase() || "";
}

function buildVoiceNodeAliases(node) {
  const id = String(node?.id || "");
  const match = id.match(/^([a-zA-Z]+)(\d+)$/);
  const aliases = [
    id,
    id.replace(/[-_]/g, " "),
    node?.blockName,
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
    const codeMatch = blockCode.match(/^(\d+)([a-z])$/i);
    aliases.push(
      match[0],
      `bloco ${blockCode}`,
      `predio ${blockCode}`,
      `bloco ${blockCode.replace(/(\d)([a-z])/i, "$1 $2")}`,
      `predio ${blockCode.replace(/(\d)([a-z])/i, "$1 $2")}`
    );
    if (codeMatch) {
      const [, number, letter] = codeMatch;
      const spokenLetter = PORTUGUESE_LETTER_NAMES[letter.toLowerCase()] || letter;
      aliases.push(
        `${number} ${spokenLetter}`,
        `bloco ${number} ${spokenLetter}`,
        `predio ${number} ${spokenLetter}`
      );
    }
  }

  return aliases;
}

function normalizeVoiceComparable(value) {
  return normalizeVoiceText(value)
    .replace(/\b(\d+)\s+([a-z])\b/g, "$1$2")
    .replace(/\b(\d+[a-z])\s+(lab|[ab])\b/g, "$1-$2")
    .replace(/\b([a-z])\s+(\d+)\b/g, "$1$2");
}

function normalizeVoiceText(value) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeSpokenBlockCodes(replaceSpokenNumbers(normalized));
}

function normalizeSpokenBlockCodes(value) {
  return String(value || "").replace(/\b(\d+)\s+([a-z]+)\b/g, (match, number, spokenLetter) => {
    const letter = PORTUGUESE_SPOKEN_LETTERS[spokenLetter];
    return letter ? `${number}${letter}` : match;
  });
}

function replaceSpokenNumbers(value) {
  const numberWords = {
    zero: "0", um: "1", uma: "1", dois: "2", duas: "2", tres: "3", quatro: "4",
    cinco: "5", seis: "6", sete: "7", oito: "8", nove: "9", dez: "10",
    onze: "11", doze: "12", treze: "13", quatorze: "14", catorze: "14",
    quinze: "15", dezesseis: "16", dezassete: "17", dezessete: "17",
    dezoito: "18", dezenove: "19", vinte: "20"
  };

  return value.split(" ").map((word) => numberWords[word] || word).join(" ");
}

function containsVoicePhrase(text, phrase) {
  return ` ${text} `.includes(` ${phrase} `);
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function selectBestVoiceAlternative(alternatives) {
  return [...alternatives].sort((left, right) => {
    const leftScore = scoreVoiceTranscript(left.transcript) + left.confidence * 10;
    const rightScore = scoreVoiceTranscript(right.transcript) + right.confidence * 10;
    return rightScore - leftScore;
  })[0] || null;
}

function scoreVoiceTranscript(transcript) {
  const command = normalizeVoiceText(transcript);
  const keywordCount = ["origem", "destino", "de", "do", "da", "para", "ate", "rota", "bloco", "predio"]
    .filter((keyword) => containsVoicePhrase(command, keyword)).length;
  const nodeScore = findNodeInVoiceText(command) ? 30 : 0;
  return nodeScore + keywordCount * 5;
}

function scheduleVoiceGeneticOptimization() {
  const nodesSnapshot = [...state.nodes];
  const modelKey = VOICE_GENETIC_STORAGE_PREFIX + nodesSnapshot.map(getVoiceNodeBlockCode).filter(Boolean).sort().join(",");
  const storedModel = window.localStorage?.getItem(modelKey);
  state.voiceMatchCache.clear();

  if (storedModel) {
    try {
      const parsedModel = JSON.parse(storedModel);
      if (parsedModel?.weights && Number.isFinite(parsedModel.fitness)) {
        state.voiceGeneticWeights = parsedModel.weights;
        state.voiceGeneticFitness = parsedModel.fitness;
        return;
      }
    } catch (error) {
      window.localStorage?.removeItem(modelKey);
    }
  }

  const optimize = () => {
    const result = optimizeVoiceMatchingWeights(nodesSnapshot);
    state.voiceGeneticWeights = result.weights;
    state.voiceGeneticFitness = result.fitness;
    state.voiceMatchCache.clear();
    window.localStorage?.setItem(modelKey, JSON.stringify(result));
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(optimize, { timeout: 1200 });
  } else {
    setTimeout(optimize, 0);
  }
}

function optimizeVoiceMatchingWeights(nodes, options = {}) {
  const trainingSamples = buildVoiceGeneticTrainingSamples(nodes);

  if (trainingSamples.length < 2) {
    return { weights: { ...VOICE_GENETIC_DEFAULT_WEIGHTS }, fitness: 1, generations: 0 };
  }

  const populationSize = options.populationSize || VOICE_GENETIC_POPULATION_SIZE;
  const generations = options.generations || VOICE_GENETIC_GENERATIONS;
  const random = createSeededVoiceRandom(options.seed || 31513);
  let population = [Object.values(VOICE_GENETIC_DEFAULT_WEIGHTS)];

  while (population.length < populationSize) {
    population.push(Array.from({ length: 5 }, () => 0.4 + random() * 7.2));
  }

  for (let generation = 0; generation < generations; generation += 1) {
    const ranked = population
      .map((genes) => ({ genes, fitness: evaluateVoiceGenes(genes, trainingSamples) }))
      .sort((left, right) => right.fitness - left.fitness);
    const eliteCount = Math.max(2, Math.floor(populationSize * 0.25));
    const elites = ranked.slice(0, eliteCount).map((candidate) => candidate.genes);
    const nextPopulation = elites.map((genes) => [...genes]);

    while (nextPopulation.length < populationSize) {
      const parentA = elites[Math.floor(random() * elites.length)];
      const parentB = elites[Math.floor(random() * elites.length)];
      const child = parentA.map((gene, index) => {
        const inherited = random() < 0.5 ? gene : parentB[index];
        const mutation = random() < 0.28 ? (random() - 0.5) * 1.4 : 0;
        return Math.min(9, Math.max(0.2, inherited + mutation));
      });
      nextPopulation.push(child);
    }

    population = nextPopulation;
  }

  const winner = population
    .map((genes) => ({ genes, fitness: evaluateVoiceGenes(genes, trainingSamples) }))
    .sort((left, right) => right.fitness - left.fitness)[0];

  return {
    weights: voiceGenesToWeights(winner.genes),
    fitness: winner.fitness,
    generations
  };
}

function buildVoiceGeneticTrainingSamples(nodes) {
  const uniqueNodes = [];
  const seenCodes = new Set();

  nodes.forEach((node) => {
    const code = getVoiceNodeBlockCode(node);
    if (code && !seenCodes.has(code)) {
      seenCodes.add(code);
      uniqueNodes.push({ node, code });
    }
  });

  const candidates = uniqueNodes.map(({ node, code }) => ({
    id: node.id,
    aliases: [...new Set(buildSpokenBlockVariants(code).slice(0, 3).map(normalizeVoiceComparable).filter(Boolean))]
  }));
  const samples = [];

  uniqueNodes.forEach(({ node, code }) => {
    buildSpokenBlockVariants(code).slice(0, 3).forEach((phrase) => {
      const text = normalizeVoiceComparable(phrase);
      samples.push({
        expectedId: node.id,
        text,
        candidates: candidates.map((candidate) => ({
          id: candidate.id,
          features: candidate.aliases.map((alias) => getVoiceMatchFeatures(text, alias))
        }))
      });
    });
  });

  return samples;
}

function getVoiceNodeBlockCode(node) {
  const values = [
    getNodeAttribute(node, "bloco", "block", "building", "predio", "prédio"),
    node?.name,
    node?.blockName
  ];

  for (const value of values) {
    const normalized = normalizeVoiceComparable(value);
    const match = normalized.match(/\b(\d+[a-z](?:-[a-z]+)?)\b/i);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return "";
}

function buildSpokenBlockVariants(code) {
  const match = String(code).match(/^(\d+)([A-Z])(?:-([A-Z]+))?$/i);

  if (!match) {
    return [code];
  }

  const [, number, firstLetter, secondLetter] = match;
  const firstSpoken = PORTUGUESE_LETTER_NAMES[firstLetter.toLowerCase()] || firstLetter;
  const suffix = secondLetter
    ? ` ${secondLetter.toLowerCase().split("").map((letter) => PORTUGUESE_LETTER_NAMES[letter] || letter).join(" ")}`
    : "";
  const spokenCode = `${number} ${firstSpoken}${suffix}`;

  return [
    code,
    spokenCode,
    `bloco ${spokenCode}`,
    `do bloco ${spokenCode}`,
    `predio ${spokenCode}`
  ];
}

function evaluateVoiceGenes(genes, samples) {
  const weights = voiceGenesToWeights(genes);
  let correct = 0;
  let marginReward = 0;

  samples.forEach((sample) => {
    const ranked = sample.candidates.map((candidate) => ({
      id: candidate.id,
      score: candidate.features.reduce((best, features) => Math.max(best, scoreVoiceFeatures(features, weights)), 0)
    })).sort((left, right) => right.score - left.score);
    const margin = ranked[0].score - (ranked[1]?.score || 0);

    if (ranked[0].id === sample.expectedId && margin > 0.1) {
      correct += 1;
      marginReward += Math.min(margin, 3) / 3;
    }
  });

  return (correct + marginReward * 0.05) / samples.length;
}

function voiceGenesToWeights(genes) {
  return {
    phrase: genes[0],
    compact: genes[1],
    token: genes[2],
    edit: genes[3],
    blockCode: genes[4]
  };
}

function createSeededVoiceRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function updateVoiceRecognitionGrammar() {
  const SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;

  if (!state.voiceRecognition || !SpeechGrammarList || !state.nodes.length) {
    return;
  }

  const terms = state.nodes
    .flatMap(buildVoiceNodeAliases)
    .map(normalizeVoiceText)
    .filter((term) => term && term.length <= 60)
    .slice(0, 400);

  if (!terms.length) {
    return;
  }

  try {
    const grammarList = new SpeechGrammarList();
    grammarList.addFromString(`#JSGF V1.0; grammar locais; public <local> = ${terms.join(" | ")} ;`, 1);
    state.voiceRecognition.grammars = grammarList;
  } catch (error) {
    console.warn("O navegador ignorou a lista de locais para reconhecimento de voz.", error);
  }
}

function initializeMapboxMap() {
  if (state.threeDMap) {
    return true;
  }

  if (!refs.mapboxMap || !window.mapboxgl) {
    refs.mapboxViewBtn.disabled = true;
    refs.mapboxViewBtn.title = "Mapbox GL JS nao foi carregado.";
    return false;
  }

  if (!MAPBOX_ACCESS_TOKEN) {
    refs.mapboxViewBtn.hidden = true;
    return false;
  }

  refs.mapboxViewBtn.hidden = false;
  refs.mapboxViewBtn.disabled = false;
  refs.mapboxViewBtn.title = "Abrir visualizacao Mapbox 3D";
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
    updateMapboxOsmData();
  });
  state.threeDMap.on("error", (event) => {
    if (event?.error) {
      console.warn("Mapbox informou um erro.", event.error);
    }
  });
  return true;
}

function activateMapboxView() {
  if (!MAPBOX_ACCESS_TOKEN) {
    setStatus("Mapbox 3D indisponivel sem token configurado.", "info");
    return;
  }

  if (initializeMapboxMap()) {
    setViewMode("mapbox");
    setStatus("Visualizacao Mapbox 3D ativada. As rotas continuam usando os dados atuais do OpenStreetMap.", "success");
  }
}

function initializeOsmMap() {
  if (!refs.osmMap || !window.L) {
    refs.osmViewBtn.disabled = true;
    refs.osmViewBtn.title = "OpenStreetMap nao foi carregado.";
    return Promise.resolve();
  }

  const campusFocusBounds = L.latLngBounds(
    [OSM_CAMPUS_BBOX[0], OSM_CAMPUS_BBOX[1]],
    [OSM_CAMPUS_BBOX[2], OSM_CAMPUS_BBOX[3]]
  );
  const map = L.map(refs.osmMap, {
    attributionControl: true,
    zoomControl: false,
    maxBounds: campusFocusBounds,
    maxBoundsViscosity: 1,
    minZoom: 16
  }).setView([-18.9184, -48.2581], 17);
  const enforceCampusFocus = () => {
    const focusZoom = map.getBoundsZoom(campusFocusBounds, true);
    map.setMinZoom(Math.max(17, Number.isFinite(focusZoom) ? focusZoom : 17));
    map.panInsideBounds(campusFocusBounds, { animate: false });
  };
  enforceCampusFocus();
  map.on("resize", enforceCampusFocus);
  L.rectangle(campusFocusBounds, {
    color: "#2563eb",
    dashArray: "8 6",
    fill: false,
    interactive: false,
    opacity: 0.9,
    weight: 3
  }).addTo(map);

  const osmBaseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });
  const esriImageryLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 20,
      attribution: "Tiles &copy; Esri"
    }
  );
  const savedBaseLayer = window.localStorage?.getItem("movufu-osm-base-layer");
  (savedBaseLayer === "esri" ? esriImageryLayer : osmBaseLayer).addTo(map);
  const basemapControl = L.control({ position: "topright" });
  basemapControl.onAdd = () => {
    const button = L.DomUtil.create("button", "leaflet-basemap-toggle");
    button.type = "button";
    button.title = savedBaseLayer === "esri" ? "Usar mapa padrao" : "Usar imagem de satelite";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = '<span aria-hidden="true">◇</span>';
    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.on(button, "click", () => {
      const usingEsri = map.hasLayer(esriImageryLayer);
      if (usingEsri) {
        map.removeLayer(esriImageryLayer);
        osmBaseLayer.addTo(map);
      } else {
        map.removeLayer(osmBaseLayer);
        esriImageryLayer.addTo(map);
      }
      const nextLayerId = usingEsri ? "osm" : "esri";
      window.localStorage?.setItem("movufu-osm-base-layer", nextLayerId);
      setStatus(
        nextLayerId === "esri" ? "Imagem de satelite ativada." : "Mapa padrao ativado.",
        "info"
      );
      button.title = usingEsri ? "Usar imagem de satelite" : "Usar mapa padrao";
      button.setAttribute("aria-label", button.title);
    });
    return button;
  };
  basemapControl.addTo(map);
  map.on("baselayerchange", (event) => {
    const layerId = event.layer === esriImageryLayer ? "esri" : "osm";
    window.localStorage?.setItem("movufu-osm-base-layer", layerId);
    setStatus(
      layerId === "esri"
        ? "Plano de fundo alterado para Imagens globais da Esri. As rotas continuam usando OpenStreetMap."
        : "Plano de fundo alterado para OpenStreetMap padrao.",
      "info"
    );
  });
  L.control.zoom({ position: "topright" }).addTo(map);

  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = () => {
    const container = L.DomUtil.create("div", "osm-legend");
    container.innerHTML = [
      '<span class="osm-legend__item" title="Caminhos de pedestres"><i class="osm-legend__line"></i>Rotas</span>',
      '<span class="osm-legend__item" title="Rampa ou guia acessivel"><i class="osm-legend__wheelchair">♿</i>Acessibilidade</span>'
    ].join("");
    L.DomEvent.disableClickPropagation(container);
    return container;
  };
  legend.addTo(map);

  state.osmMap = map;
  return loadOsmAccessibilityLayer();
}

async function loadOsmAccessibilityLayer() {
  try {
    setStatus("Consultando a versao mais recente do OpenStreetMap...");
    const { geoJson, source } = await fetchCurrentOsmGeoJson();
    state.osmGeoJson = geoJson;
    loadOsmRoutingGraph(geoJson);
    updateMapboxOsmData();
    const layer = L.geoJSON(geoJson, {
      style(feature) {
        if (feature?.properties?.feature_class === "building_outline") {
          return { color: "#64748b", fillColor: "#94a3b8", fillOpacity: 0.06, opacity: 0.55, weight: 1.4 };
        }
        const isSteps = feature?.properties?.highway === "steps";
        const isCrossing = feature?.properties?.footway === "crossing";
        return {
          color: isSteps ? "#dc2626" : isCrossing ? "#2563eb" : "#0f766e",
          dashArray: isSteps ? "7 6" : null,
          lineCap: "round",
          lineJoin: "round",
          opacity: 0.9,
          weight: isCrossing ? 6 : 5
        };
      },
      pointToLayer(feature, latlng) {
        const properties = feature?.properties || {};
        const isDestination = properties.feature_class === "destination";
        if (isOsmWheelchairRamp(properties)) {
          return L.marker(latlng, {
            icon: L.divIcon({
              className: "osm-accessibility-div-icon",
              html: '<span class="osm-accessibility-icon" aria-hidden="true">♿</span>',
              iconAnchor: [16, 16],
              iconSize: [32, 32]
            }),
            keyboard: true,
            title: "Rampa ou guia acessivel"
          });
        }
        return L.circleMarker(latlng, {
          radius: isDestination ? 4.5 : 5.5,
          fillColor: isDestination ? "#2563eb" : "#f97316",
          fillOpacity: 0.95,
          color: "#ffffff",
          opacity: 1,
          weight: 3
        });
      },
      onEachFeature(feature, featureLayer) {
        const properties = feature?.properties || {};
        if (properties.feature_class === "destination") {
          const label = properties.label || properties.name || "Destino";
          featureLayer.bindTooltip(label, isOsmBlockLabel(label) ? {
            className: "osm-block-label",
            direction: "center",
            opacity: 0.92,
            permanent: true
          } : {
            direction: "top",
            opacity: 0.9
          });
        } else if (properties.feature_class === "entrance_point") {
          featureLayer.bindTooltip(properties.label || "Entrada/saida do bloco", {
            direction: "top",
            opacity: 0.9
          });
        } else if (isOsmWheelchairRamp(properties)) {
          featureLayer.bindPopup([
            "<strong>Rampa / guia acessivel</strong>",
            properties.kerb ? `<br>Guia: ${properties.kerb}` : "",
            properties.wheelchair ? `<br>Cadeira de rodas: ${properties.wheelchair}` : "",
            properties.tactile_paving ? `<br>Piso tatil: ${properties.tactile_paving}` : ""
          ].join(""));
        } else if (feature?.geometry?.type === "Point") {
          featureLayer.bindPopup([
            "<strong>Travessia mapeada</strong>",
            properties.crossing ? `<br>Tipo: ${properties.crossing}` : "",
            properties.tactile_paving ? `<br>Piso tatil: ${properties.tactile_paving}` : "",
            "<br><em>Verificar se existe rampa/rebaixamento.</em>"
          ].join(""));
        }
      }
    }).addTo(state.osmMap);

    state.osmAccessibilityLayer = layer;
    state.osmReady = true;
    setViewMode("osm");
    calculateAndRenderRoute();
    const metadata = geoJson.metadata || {};
    const sourceLabel = source === "live" ? "dados atuais" : "copia local de contingencia";
    setStatus(
      `OpenStreetMap (${sourceLabel}): ${metadata.pedestrian_path_count || 0} caminhos, ${metadata.accessibility_point_count || 0} pontos de acessibilidade e ${state.osmDestinations.length} destinos conectados.`,
      source === "live" ? "success" : "info"
    );
    if (layer.getBounds().isValid()) {
      state.osmMap.fitBounds(layer.getBounds(), { padding: [28, 28] });
    }
  } catch (error) {
    console.warn("Nao foi possivel carregar os caminhos OpenStreetMap.", error);
    refs.osmViewBtn.disabled = true;
    refs.osmViewBtn.title = "Caminhos OpenStreetMap indisponiveis.";
  }
}

async function fetchCurrentOsmGeoJson() {
  try {
    return { geoJson: await fetchLiveOsmGeoJson(), source: "live" };
  } catch (liveError) {
    console.warn("Consulta OSM ao vivo falhou; usando copia local.", liveError);
    const response = await fetch(`${OSM_ACCESSIBILITY_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("dados atuais e copia local do OSM indisponiveis");
    }
    return { geoJson: await response.json(), source: "fallback" };
  }
}

async function fetchLiveOsmGeoJson() {
  const [south, west, north, east] = OSM_CAMPUS_BBOX;
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:18];(
    way(${OSM_CAMPUS_BOUNDARY_ID});
    way["highway"~"^(footway|path)$"](${bbox});
    node["highway"="crossing"](${bbox});
    node["kerb"~"^(lowered|flush)$"](${bbox});
    node["wheelchair"](${bbox});
    node["ramp"](${bbox});
    node["tactile_paving"](${bbox});
    node["entrance"](${bbox});
    way["building"](${bbox});
    nwr["name"]["building"](${bbox}); nwr["ref"]["building"](${bbox});
    nwr["name"]["amenity"](${bbox}); nwr["ref"]["amenity"](${bbox});
    nwr["name"]["entrance"](${bbox}); nwr["ref"]["entrance"](${bbox});
    nwr["name"]["office"](${bbox}); nwr["ref"]["office"](${bbox});
    nwr["name"]["leisure"](${bbox}); nwr["ref"]["leisure"](${bbox});
  );out tags center geom;`;
  const errors = [];
  for (const endpoint of OSM_OVERPASS_URLS) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), OSM_LIVE_TIMEOUT_MS);
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`resposta ${response.status}`);
      }
      return overpassToGeoJson(await response.json());
    } catch (error) {
      errors.push(`${endpoint}: ${error.message}`);
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw new Error(`Servicos Overpass indisponiveis. ${errors.join(" | ")}`);
}

function overpassToGeoJson(data) {
  const features = [];
  const destinationKeys = new Set();
  let pathwayCount = 0;
  let accessibilityPointCount = 0;
  let destinationCount = 0;
  const boundaryElement = (data.elements || []).find(
    (element) => element.type === "way" && element.id === OSM_CAMPUS_BOUNDARY_ID
  );
  const campusBoundary = (boundaryElement?.geometry || []).map((point) => [point.lon, point.lat]);

  (data.elements || []).forEach((element) => {
    const properties = element.tags || {};
    const id = `${element.type}/${element.id}`;
    if (element.type === "way" && properties.building) {
      const outline = (element.geometry || []).map((point) => [point.lon, point.lat]);
      const center = element.center ? [element.center.lon, element.center.lat] : outline[0];
      if (outline.length >= 3 && osmPointInPolygon(center, campusBoundary)) {
        if (osmCoordinateKey(outline[0]) !== osmCoordinateKey(outline.at(-1))) {
          outline.push(outline[0]);
        }
        features.push({
          type: "Feature",
          id: `building/${id}`,
          properties: { osm_id: element.id, feature_class: "building_outline", ...properties },
          geometry: { type: "Polygon", coordinates: [outline] }
        });
      }
    }
    if (element.type === "way" && isOsmRoutableWay(properties)) {
      const coordinates = (element.geometry || []).map((point) => [point.lon, point.lat]);
      if (coordinates.length >= 2 && coordinates.some((coordinate) => osmPointInPolygon(coordinate, campusBoundary))) {
        features.push({ type: "Feature", id, properties: { osm_id: element.id, feature_class: "pedestrian_path", ...properties }, geometry: { type: "LineString", coordinates } });
        pathwayCount += 1;
      }
      return;
    }

    const coordinate = element.type === "node"
      ? [element.lon, element.lat]
      : element.center ? [element.center.lon, element.center.lat] : null;
    if (!coordinate || coordinate.some((value) => !Number.isFinite(value))) {
      return;
    }
    if (element.id === OSM_CAMPUS_BOUNDARY_ID || !osmPointInPolygon(coordinate, campusBoundary)) {
      return;
    }

    const isAccessibilityPoint = element.type === "node" && (
      properties.highway === "crossing" || /^(lowered|flush)$/.test(properties.kerb || "") ||
      Object.hasOwn(properties, "wheelchair") || Object.hasOwn(properties, "tactile_paving")
    );
    if (isAccessibilityPoint) {
      features.push({ type: "Feature", id, properties: { osm_id: element.id, feature_class: "accessibility_point", ...properties }, geometry: { type: "Point", coordinates: coordinate } });
      accessibilityPointCount += 1;
    }

    if (element.type === "node" && Object.hasOwn(properties, "entrance")) {
      features.push({
        type: "Feature",
        id: `entrance/${id}`,
        properties: {
          osm_id: element.id,
          feature_class: "entrance_point",
          label: properties.name || properties.ref || "Entrada/saida do bloco",
          ...properties
        },
        geometry: { type: "Point", coordinates: coordinate }
      });
    }

    const isDestination = Boolean(properties.name || properties.ref) && Boolean(
      properties.building || properties.amenity || properties.entrance || properties.office || properties.leisure
    );
    if (isDestination) {
      const label = properties.ref || properties.name || String(element.id);
      const key = `${label.toLocaleLowerCase("pt-BR")}|${(properties.name || "").toLocaleLowerCase("pt-BR")}`;
      if (!destinationKeys.has(key)) {
        destinationKeys.add(key);
        features.push({ type: "Feature", id: `destination/${id}`, properties: { osm_id: element.id, feature_class: "destination", label, ...properties }, geometry: { type: "Point", coordinates: coordinate } });
        destinationCount += 1;
      }
    }
  });

  return {
    type: "FeatureCollection",
    name: "UFU Campus Santa Monica - OpenStreetMap ao vivo",
    metadata: {
      source: "OpenStreetMap contributors via Overpass API",
      source_url: "https://www.openstreetmap.org/copyright",
      retrieved_at: new Date().toISOString(),
      pedestrian_path_count: pathwayCount,
      accessibility_point_count: accessibilityPointCount,
      destination_count: destinationCount,
      warning: "Dados colaborativos; validar rampas e condicoes de acessibilidade em campo."
    },
    features
  };
}

function osmPointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    return true;
  }
  const [x, y] = point;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const [x1, y1] = polygon[previous];
    const [x2, y2] = polygon[current];
    const crosses = (y1 > y) !== (y2 > y)
      && x < ((x2 - x1) * (y - y1)) / ((y2 - y1) || Number.EPSILON) + x1;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

function isOsmRoutableWay(properties = {}) {
  if (!OSM_ROUTABLE_HIGHWAYS.has(properties.highway)) {
    return false;
  }
  if (properties.foot === "no" || properties.foot === "use_sidepath" || properties.access === "no") {
    return false;
  }
  return true;
}

function isOsmWheelchairRamp(properties = {}) {
  return properties.feature_class === "accessibility_point" && (
    /^(lowered|flush)$/.test(properties.kerb || "")
    || /^(yes|designated)$/.test(properties.wheelchair || "")
    || properties.ramp === "yes"
  );
}

function isOsmBlockLabel(value) {
  return /^\d+\s*[a-z](?:[-\s].*)?$/i.test(String(value || "").trim());
}

function loadOsmRoutingGraph(geoJson) {
  const graphNodes = new Map();
  const adjacency = new Map();
  let edgeCount = 0;

  (geoJson.features || []).forEach((feature) => {
    if (feature?.properties?.feature_class !== "pedestrian_path" || feature?.geometry?.type !== "LineString") {
      return;
    }

    const coordinates = feature.geometry.coordinates || [];
    coordinates.forEach((coordinate) => {
      const key = osmCoordinateKey(coordinate);
      graphNodes.set(key, coordinate);
      if (!adjacency.has(key)) {
        adjacency.set(key, []);
      }
    });

    for (let index = 1; index < coordinates.length; index += 1) {
      const fromCoordinate = coordinates[index - 1];
      const toCoordinate = coordinates[index];
      const from = osmCoordinateKey(fromCoordinate);
      const to = osmCoordinateKey(toCoordinate);
      const distance = haversineDistance(fromCoordinate, toCoordinate);
      const properties = feature.properties || {};
      const accessibilityPenalty = getOsmAccessibilityPenalty(properties);
      const weight = distance * accessibilityPenalty;

      adjacency.get(from)?.push({ from, to, distance, weight, properties });
      adjacency.get(to)?.push({ from: to, to: from, distance, weight, properties });
      edgeCount += 1;
    }
  });

  const routingGraphNodes = graphNodes;
  const routingAdjacency = adjacency;
  const entranceCoordinates = (geoJson.features || [])
    .filter((feature) => feature?.properties?.feature_class === "entrance_point" && feature?.geometry?.type === "Point")
    .map((feature) => feature.geometry.coordinates);
  const buildingOutlines = new Map(
    (geoJson.features || [])
      .filter((feature) => feature?.properties?.feature_class === "building_outline" && feature?.geometry?.type === "Polygon")
      .map((feature) => [String(feature.properties.osm_id), feature.geometry.coordinates?.[0] || []])
  );
  const destinations = (geoJson.features || [])
    .filter((feature) => feature?.properties?.feature_class === "destination" && feature?.geometry?.type === "Point")
    .map((feature, index) => {
      const coordinate = feature.geometry.coordinates;
      const properties = feature.properties || {};
      const outline = buildingOutlines.get(String(properties.osm_id));
      const entrancesInsideBuilding = outline?.length
        ? entranceCoordinates.filter((entrance) => osmPointInPolygon(entrance, outline))
        : [];
      const nearestEntrance = findNearestOsmEntrance(coordinate, entrancesInsideBuilding, Infinity)
        || findNearestOsmEntrance(coordinate, entranceCoordinates, 40);
      const graphNodeKey = findNearestOsmGraphNode(nearestEntrance || coordinate, graphNodes);
      const id = `OSM-${properties.osm_id || index + 1}`;
      const label = String(properties.label || properties.ref || properties.name || `Destino ${index + 1}`).trim();

      return {
        id,
        accessible: properties.wheelchair === "yes" || properties.wheelchair === "designated",
        attributes: {
          BLOCO: properties.ref || "",
          DESCRICAO: properties.name || label,
          WHEELCHAIR: properties.wheelchair || ""
        },
        blockName: properties.building || properties.amenity || "OSM",
        category: properties.entrance ? "entrance" : "node",
        flow: "BOTH",
        graphNodeKey,
        layer: "OpenStreetMap",
        level: properties.level || "",
        name: label,
        position: { x: coordinate[0], y: coordinate[1], z: 0 },
        type: properties.amenity || properties.building || "destination"
      };
    })
    .filter((destination) => destination.graphNodeKey)
    .sort((left, right) => naturalCompare(left.name, right.name));

  state.osmGraphNodes = routingGraphNodes;
  state.osmAdjacency = routingAdjacency;
  state.osmDestinations = destinations;
  state.nodes = destinations;
  state.nodeById = new Map(destinations.map((destination) => [destination.id, destination]));
  state.graphReady = routingGraphNodes.size > 0 && destinations.length > 1;
  refs.nodeCount.textContent = String(routingGraphNodes.size);
  refs.edgeCount.textContent = String(
    [...routingAdjacency.values()].reduce((total, edges) => total + edges.length, 0) / 2
  );
  populateOsmControls();
  updateVoiceRecognitionGrammar();
  scheduleVoiceGeneticOptimization();
}

function findNearestOsmEntrance(coordinate, entranceCoordinates, maximumDistance = 90) {
  let nearest = null;
  let distance = Infinity;
  entranceCoordinates.forEach((candidate) => {
    const candidateDistance = haversineDistance(coordinate, candidate);
    if (candidateDistance < distance) {
      distance = candidateDistance;
      nearest = candidate;
    }
  });
  return distance <= maximumDistance ? nearest : null;
}

function populateOsmControls() {
  refs.originSelect.replaceChildren();
  refs.destinationSelect.replaceChildren();

  state.osmDestinations.forEach((destination) => {
    refs.originSelect.appendChild(new Option(destination.name, destination.id));
    refs.destinationSelect.appendChild(new Option(destination.name, destination.id));
  });

  const origin = state.osmDestinations.find((item) => normalizeVoiceComparable(item.name) === "1a")
    || state.osmDestinations[0];
  const destination = state.osmDestinations.find((item) => normalizeVoiceComparable(item.name) === "3e")
    || state.osmDestinations.at(-1);
  refs.originSelect.value = origin?.id || "";
  refs.destinationSelect.value = destination?.id || origin?.id || "";
}

function osmCoordinateKey(coordinate) {
  return `${Number(coordinate?.[0]).toFixed(7)},${Number(coordinate?.[1]).toFixed(7)}`;
}

function findNearestOsmGraphNode(coordinate, graphNodes = state.osmGraphNodes) {
  let nearestKey = null;
  let nearestDistance = Infinity;

  graphNodes.forEach((candidate, key) => {
    const distance = haversineDistance(coordinate, candidate);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestKey = key;
    }
  });

  return nearestKey;
}

function getOsmAccessibilityPenalty(properties) {
  if (properties.highway === "steps" || properties.wheelchair === "no") {
    return 1000;
  }
  if (properties.wheelchair === "limited" || properties.surface === "unpaved") {
    return 4;
  }
  return 1;
}

function haversineDistance(left, right) {
  const earthRadius = 6371000;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const lat1 = toRadians(Number(left?.[1] || 0));
  const lat2 = toRadians(Number(right?.[1] || 0));
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(Number(right?.[0] || 0) - Number(left?.[0] || 0));
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(value));
}

function calculateAndRenderOsmRoute() {
  const origin = state.nodeById.get(refs.originSelect.value);
  const destination = state.nodeById.get(refs.destinationSelect.value);

  if (!origin || !destination || origin.id === destination.id) {
    clearOsmRoute("Escolha origem e destino diferentes.");
    return;
  }

  const route = findOsmShortestPath(origin.graphNodeKey, destination.graphNodeKey);
  if (!route) {
    clearOsmRoute(`Sem caminho conectado entre ${origin.name} e ${destination.name}.`);
    return;
  }

  if (state.osmRouteLayer) {
    state.osmRouteLayer.remove();
  }

  const latLngs = route.nodeKeys.map((key) => {
    const coordinate = state.osmGraphNodes.get(key);
    return [coordinate[1], coordinate[0]];
  });
  const casing = L.polyline(latLngs, { color: "#ffffff", opacity: 0.96, weight: 12 });
  const line = L.polyline(latLngs, { color: "#f59e0b", opacity: 1, weight: 7 });
  state.osmRouteLayer = L.layerGroup([casing, line]).addTo(state.osmMap);
  updateMapboxOsmRoute(route.nodeKeys);
  state.route = route;
  refs.navigatorCard.classList.add("has-route");
  document.querySelector(".map-panel")?.classList.add("has-route");
  refs.routeDistance.textContent = `${roundNumber(route.distance, 1).toLocaleString("pt-BR")} m`;
  refs.routeDuration.textContent = `${Math.max(1, Math.ceil(route.distance / 66))} min`;
  refs.pathText.textContent = `${origin.name} → ${destination.name}`;
  state.osmMap.fitBounds(line.getBounds(), { padding: [70, 70] });
  setStatus(`Rota OpenStreetMap calculada de ${origin.name} para ${destination.name}.`, "success");
}

function updateMapboxOsmData() {
  if (!state.mapboxReady || !state.threeDMap || !state.osmGeoJson) {
    return;
  }

  const features = state.osmGeoJson.features || [];
  const paths = features.filter((feature) => feature?.properties?.feature_class === "pedestrian_path");
  const points = features
    .filter((feature) => feature?.geometry?.type === "Point")
    .map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        category: feature.properties?.feature_class === "destination" ? "building" : "ramp"
      }
    }));
  state.threeDMap.getSource("accessibility-edges")?.setData(createFeatureCollection(paths));
  state.threeDMap.getSource("accessibility-nodes")?.setData(createFeatureCollection(points));
}

function updateMapboxOsmRoute(nodeKeys = []) {
  if (!state.mapboxReady || !state.threeDMap) {
    return;
  }

  const coordinates = nodeKeys.map((key) => state.osmGraphNodes.get(key)).filter(Boolean);
  const features = coordinates.length >= 2 ? [{
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates }
  }] : [];
  state.threeDMap.getSource("accessibility-route")?.setData(createFeatureCollection(features));
}

function clearOsmRoute(message) {
  state.osmRouteLayer?.remove();
  state.osmRouteLayer = null;
  updateMapboxOsmRoute();
  state.route = null;
  refs.navigatorCard.classList.remove("has-route");
  document.querySelector(".map-panel")?.classList.remove("has-route");
  refs.routeDistance.textContent = "-";
  refs.routeDuration.textContent = "-";
  refs.pathText.textContent = message;
  setStatus(message, "warning");
}

function findOsmShortestPath(originKey, destinationKey) {
  const distances = new Map([...state.osmGraphNodes.keys()].map((key) => [key, Infinity]));
  const physicalDistances = new Map([...state.osmGraphNodes.keys()].map((key) => [key, Infinity]));
  const previous = new Map();
  const unvisited = new Set(state.osmGraphNodes.keys());
  distances.set(originKey, 0);
  physicalDistances.set(originKey, 0);

  while (unvisited.size) {
    let current = null;
    let currentDistance = Infinity;
    unvisited.forEach((key) => {
      if (distances.get(key) < currentDistance) {
        current = key;
        currentDistance = distances.get(key);
      }
    });
    if (!current || currentDistance === Infinity) {
      break;
    }
    unvisited.delete(current);
    if (current === destinationKey) {
      break;
    }

    (state.osmAdjacency.get(current) || []).forEach((edge) => {
      if (!unvisited.has(edge.to)) {
        return;
      }
      const nextDistance = currentDistance + edge.weight;
      if (nextDistance < distances.get(edge.to)) {
        distances.set(edge.to, nextDistance);
        physicalDistances.set(edge.to, physicalDistances.get(current) + edge.distance);
        previous.set(edge.to, current);
      }
    });
  }

  if (!previous.has(destinationKey)) {
    return null;
  }

  const nodeKeys = [destinationKey];
  let cursor = destinationKey;
  while (cursor !== originKey) {
    cursor = previous.get(cursor);
    if (!cursor) {
      return null;
    }
    nodeKeys.unshift(cursor);
  }

  return { nodeKeys, distance: physicalDistances.get(destinationKey) };
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
  state.viewMode = ["mapbox", "osm"].includes(mode) ? mode : "svg";
  refs.svg.classList.toggle("is-hidden", state.viewMode !== "svg");
  refs.mapboxMap.classList.toggle("is-active", state.viewMode === "mapbox");
  refs.osmMap.classList.toggle("is-active", state.viewMode === "osm");
  refs.svgViewBtn.classList.toggle("is-active", state.viewMode === "svg");
  refs.mapboxViewBtn.classList.toggle("is-active", state.viewMode === "mapbox");
  refs.osmViewBtn.classList.toggle("is-active", state.viewMode === "osm");
  refs.zoomInBtn.parentElement.classList.toggle("is-hidden", state.viewMode !== "svg");

  if (state.viewMode === "mapbox" && state.threeDMap) {
    state.threeDMap.resize();
    fitMapboxAccessibilityBounds();
  }

  if (state.viewMode === "osm" && state.osmMap) {
    state.osmMap.invalidateSize();
    if (state.osmAccessibilityLayer?.getBounds().isValid()) {
      state.osmMap.fitBounds(state.osmAccessibilityLayer.getBounds(), { padding: [28, 28] });
    }
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

  updateVoiceRecognitionGrammar();
  scheduleVoiceGeneticOptimization();

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

    if (!id || !position || nodesById.has(id) || (position.x === 0 && position.y === 0)) {
      return;
    }

    nodesById.set(id, {
      id,
      accessible: Boolean(item.accessible),
      attributes: item.attributes && typeof item.attributes === "object" ? item.attributes : {},
      blockName: String(item.blockName || "").trim(),
      category: normalizeNodeCategory(item.category, item.type, item.blockName, item.layer),
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
  clearSvgLayer(refs.buildingLayer);
  clearSvgLayer(refs.edgeLayer);
  clearSvgLayer(refs.nodeLayer);
  clearSvgLayer(refs.routeLayer);

  if (!state.graphReady || !state.bounds) {
    return;
  }

  setViewBox(state.viewBox);
  renderBackground();
  renderBuildings();
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

function renderBuildings() {
  state.buildings.forEach((item, index) => {
    if (!item.closed || item.points.length < 3) {
      return;
    }

    const path = createSvgElement("path", {
      class: `map-building is-building-${index % 6}`,
      d: pointsToPath(item.points, true)
    });

    path.dataset.buildingId = item.id;
    path.dataset.layer = item.layer;
    path.dataset.type = item.type;
    refs.buildingLayer.appendChild(path);
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
  if (state.osmReady) {
    calculateAndRenderOsmRoute();
    return;
  }

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

function toggleNavigatorCard() {
  const collapsed = refs.navigatorCard.classList.toggle("is-collapsed");
  refs.toggleNavBtn.textContent = collapsed ? "Mostrar" : "Ocultar";
  refs.toggleNavBtn.setAttribute("aria-expanded", String(!collapsed));
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

  state.gesturePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY
  });
  refs.svg.setPointerCapture(event.pointerId);

  if (state.gesturePointers.size >= 2) {
    state.dragging = createPinchGestureState();
    refs.svg.classList.remove("is-dragging");
    return;
  }

  state.dragging = {
    mode: "pan",
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    viewBox: { ...state.viewBox }
  };
  refs.svg.classList.add("is-dragging");
}

function handlePointerMove(event) {
  if (!state.gesturePointers.has(event.pointerId)) {
    return;
  }

  state.gesturePointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY
  });

  if (state.gesturePointers.size >= 2) {
    if (!state.dragging || state.dragging.mode !== "pinch") {
      state.dragging = createPinchGestureState();
    }

    handlePinchMove();
    return;
  }

  if (!state.dragging || state.dragging.mode !== "pan" || event.pointerId !== state.dragging.pointerId) {
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
  if (event?.pointerId !== undefined) {
    state.gesturePointers.delete(event.pointerId);
  } else {
    state.gesturePointers.clear();
  }

  if (event?.pointerId !== undefined && refs.svg.hasPointerCapture(event.pointerId)) {
    refs.svg.releasePointerCapture(event.pointerId);
  }

  if (state.gesturePointers.size >= 2) {
    state.dragging = createPinchGestureState();
    return;
  }

  if (state.gesturePointers.size === 1) {
    const [pointerId, pointer] = [...state.gesturePointers.entries()][0];
    state.dragging = {
      mode: "pan",
      pointerId,
      x: pointer.x,
      y: pointer.y,
      viewBox: { ...state.viewBox }
    };
    refs.svg.classList.add("is-dragging");
    return;
  }

  state.dragging = null;
  refs.svg.classList.remove("is-dragging");
}

function createPinchGestureState() {
  const pointers = [...state.gesturePointers.values()].slice(0, 2);
  const center = getPointerCenter(pointers);

  return {
    mode: "pinch",
    distance: getPointerDistance(pointers),
    focalPoint: screenPointToSvgPoint(center),
    viewBox: { ...state.viewBox }
  };
}

function handlePinchMove() {
  if (!state.dragging || state.dragging.mode !== "pinch" || !state.viewBox) {
    return;
  }

  const pointers = [...state.gesturePointers.values()].slice(0, 2);
  const distance = getPointerDistance(pointers);

  if (!distance || !state.dragging.distance) {
    return;
  }

  const center = getPointerCenter(pointers);
  const focalPoint = screenPointToSvgPoint(center, state.dragging.viewBox);
  const factor = clampNumber(state.dragging.distance / distance, 0.35, 2.8);
  const nextWidth = state.dragging.viewBox.width * factor;
  const nextHeight = state.dragging.viewBox.height * factor;
  const xRatio = (focalPoint.x - state.dragging.viewBox.x) / state.dragging.viewBox.width;
  const yRatio = (focalPoint.y - state.dragging.viewBox.y) / state.dragging.viewBox.height;

  state.viewBox = {
    x: focalPoint.x - nextWidth * xRatio,
    y: focalPoint.y - nextHeight * yRatio,
    width: nextWidth,
    height: nextHeight
  };
  setViewBox(state.viewBox);
  updateNodeSizing();
}

function getPointerDistance(pointers) {
  if (pointers.length < 2) {
    return 0;
  }

  return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
}

function getPointerCenter(pointers) {
  return {
    x: (pointers[0].x + pointers[1].x) / 2,
    y: (pointers[0].y + pointers[1].y) / 2
  };
}

function screenPointToSvgPoint(point, viewBox = state.viewBox) {
  const rect = refs.svg.getBoundingClientRect();

  return {
    x: viewBox.x + ((point.x - rect.left) / rect.width) * viewBox.width,
    y: viewBox.y + ((point.y - rect.top) / rect.height) * viewBox.height
  };
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

function normalizeNodeCategory(category, type = "", blockName = "", layer = "") {
  const structuralSource = normalizeVoiceText(`${blockName} ${layer}`).replace(/\s+/g, "_");
  const structuralCategories = [
    ["crosswalk", ["crosswalk", "travessia", "atravessia", "faixa"]],
    ["intersection", ["intersection", "intersecao", "cruzamento"]],
    ["accessible_entrance", ["accessible_entrance", "entrada_acessivel"]],
    ["elevator", ["elevator", "elevador"]],
    ["restroom", ["restroom", "banheiro"]],
    ["door", ["door", "porta"]],
    ["entrance", ["entrance", "entrada"]],
    ["ramp", ["ramp", "rampa"]]
  ];

  for (const [normalizedCategory, keywords] of structuralCategories) {
    if (keywords.some((keyword) => structuralSource.includes(keyword))) {
      return normalizedCategory;
    }
  }

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
