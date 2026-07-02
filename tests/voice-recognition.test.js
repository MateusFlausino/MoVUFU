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

console.log("Voice and OSM parser: 16 tests passed.");
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
