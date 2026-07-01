const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const tests = String.raw`
state.nodes = [
  { id: "N1", blockName: "NODE_RAMP", name: "Entrada bloco 1E", attributes: { BLOCO: "1E" } },
  { id: "N2", blockName: "NODE_RAMP", name: "Entrada bloco 3E", attributes: { BLOCO: "3E" } },
  { id: "N20", blockName: "NODE_INTERSECTION", name: "Biblioteca", attributes: {} }
];

assert.equal(normalizeVoiceComparable("bloco um E"), "bloco 1e");
assert.equal(findNodeInVoiceText("quero ir para o bloco 3 e"), "N2");
assert.equal(findNodeInVoiceText("bibliotéca"), "N20");
assert.equal(findNodeInVoiceText("ene vinte"), "N20");
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

console.log("Voice recognition parser: 8 tests passed.");
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
