import assert from "node:assert/strict";
import rampPhotoHandler from "../api/ramp-photo.js";
import rampPhotosHandler from "../api/ramp-photos.js";

const methodResponse = await rampPhotosHandler(new Request("http://localhost/api/ramp-photos", { method: "OPTIONS" }));
assert.equal(methodResponse.status, 405);

const invalidFeatureResponse = await rampPhotosHandler(new Request("http://localhost/api/ramp-photos?featureId=invalid"));
assert.equal(invalidFeatureResponse.status, 400);
assert.equal((await invalidFeatureResponse.json()).error, "Identificador de rampa inválido.");

const invalidPathResponse = await rampPhotoHandler(new Request("http://localhost/api/ramp-photo?pathname=private/secret.txt"));
assert.equal(invalidPathResponse.status, 400);

console.log("Vercel Blob API: 3 validation tests passed.");
