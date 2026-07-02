const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const tests = String.raw`
state.nodes = [
  { id: "N1", blockName: "NODE_RAMP", name: "Entrada bloco 1E", attributes: { BLOCO: "1E" } },
  { id: "N2", blockName: "NODE_RAMP", name: "Entrada bloco 3E", attributes: { BLOCO: "3E" } },
  { id: "N3", blockName: "NODE_RAMP", name: "Entrada bloco 3Q", attributes: { BLOCO: "3Q" } },
  { id: "N4", blockName: "NODE_RAMP", name: "Entrada bloco 3D", attributes: { BLOCO: "3D" } },
  { id: "N5", blockName: "NODE_RAMP", name: "Entrada bloco 1A", attributes: { BLOCO: "1A" } },
  { id: "N20", blockName: "NODE_INTERSECTION", name: "Biblioteca", attributes: {} }
];

assert.equal(normalizeVoiceComparable("bloco um E"), "bloco 1e");
assert.equal(findNodeInVoiceText("quero ir para o bloco 3 e"), "N2");
assert.equal(findNodeInVoiceText("bibliotéca"), "N20");
assert.equal(findNodeInVoiceText("ene vinte"), "N20");
assert.equal(normalizeVoiceComparable("um e para tres que"), "1e para 3q");
assert.equal(findNodeInVoiceText("tres que"), "N3");
assert.equal(findNodeInVoiceText("bloco 3 quê"), "N3");
assert.equal(
  findNodeAfterVoiceKeyword(normalizeVoiceText("do bloco um e para o bloco tres que"), ["origem", "de", "do", "da"]),
  "N1"
);
assert.equal(
  findNodeAfterVoiceKeyword(normalizeVoiceText("do bloco um e para o bloco tres que"), ["destino", "para", "ate"]),
  "N3"
);
assert.equal(isOsmBlockLabel("1C"), true);
assert.equal(isOsmBlockLabel("Biblioteca"), false);
assert.equal(osmPointInPolygon([1, 1], [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]), true);
assert.equal(JSON.stringify(findVoiceRoutePair("3D para 1E")), JSON.stringify({ originId: "N4", destinationId: "N1" }));
assert.equal(JSON.stringify(findVoiceRoutePair("tres de para um e")), JSON.stringify({ originId: "N4", destinationId: "N1" }));
assert.equal(normalizeNodeCategory("ramp", "RAMP", "NODE_CROSSWALK", "A-ATRAVESSIA"), "crosswalk");
assert.equal(normalizeNodeCategory("ramp", "RAMP", "NODE_DOOR", "A-PORTAS"), "door");
assert.equal(
  findNodeAfterVoiceKeyword(normalizeVoiceText("do bloco 1E para o bloco 3E"), ["origem", "de", "do", "da"]),
  "N1"
);
assert.equal(
  findNodeAfterVoiceKeyword(normalizeVoiceText("do bloco 1E para o bloco 3E"), ["destino", "para", "ate"]),
  "N2"
);
refs.originSelect = { value: "N5" };
refs.destinationSelect = { value: "N5" };
refs.voiceState = { textContent: "" };
processVoiceCommand("do bloco 1E para o bloco inexistente");
assert.equal(refs.originSelect.value, "N5");
assert.equal(refs.destinationSelect.value, "N5");
assert.match(refs.voiceState.textContent, /confirmar os dois blocos/);

const campusBlockCodes = [
  "1A", "1B", "1C", "1D", "1E", "1F", "1G", "1H", "1I", "1J", "1K", "1L", "1M",
  "1N", "1O", "1P", "1Q", "1R", "1T", "1U", "1V", "1W", "1X", "1Y", "1Z", "3D",
  "3E", "3J", "3L", "3M", "3N", "3O", "3Q", "3S", "3U", "5D", "5E-LAB", "5F", "5G",
  "5H", "5J", "5K", "5L", "5M", "5O-A", "5O-B", "5P", "5R", "5S", "5T"
];

state.nodes = campusBlockCodes.map((code, index) => ({
  id: "BLOCK_" + index,
  blockName: "NODE_DOOR",
  name: "Entrada do bloco " + code,
  attributes: { BLOCO: code }
}));
state.nodeById = new Map(state.nodes.map((node) => [node.id, node]));
state.voiceMatchCache.clear();

const geneticResult = optimizeVoiceMatchingWeights(state.nodes, { populationSize: 8, generations: 5, seed: 31513 });
assert.ok(geneticResult.fitness > 0.95, "fitness genetico insuficiente: " + geneticResult.fitness);
state.voiceGeneticWeights = geneticResult.weights;

let directedPairCount = 0;
campusBlockCodes.forEach((originCode, originIndex) => {
  campusBlockCodes.forEach((destinationCode, destinationIndex) => {
    if (originIndex === destinationIndex) return;
    assert.deepEqual(
      findVoiceRoutePair("do bloco " + originCode + " para o bloco " + destinationCode),
      { originId: "BLOCK_" + originIndex, destinationId: "BLOCK_" + destinationIndex }
    );
    directedPairCount += 1;
  });
});

assert.equal(directedPairCount, 2450);
assert.deepEqual(findVoiceRoutePair("do bloco um e para o bloco tres e"), { originId: "BLOCK_4", destinationId: "BLOCK_26" });
assert.deepEqual(findVoiceRoutePair("do bloco tres e para um e"), { originId: "BLOCK_26", destinationId: "BLOCK_4" });
assert.deepEqual(findVoiceRoutePair("tres de para um e"), { originId: "BLOCK_25", destinationId: "BLOCK_4" });

console.log("Voice and OSM parser: 21 unit tests + " + directedPairCount + " directed route pairs passed. GA fitness: " + geneticResult.fitness.toFixed(4) + ".");
`;

vm.runInNewContext(`${appSource}\n${tests}`, {
  assert,
  clearTimeout,
  console,
  document: { addEventListener() {} },
  fetch,
  Map,
  navigator: {},
  Option: function Option() {},
  Set,
  setTimeout,
  URL,
  window: {}
});
