import { createHmac, timingSafeEqual } from "node:crypto";
import { del, list, put } from "@vercel/blob";

const MAX_PHOTOS_PER_RAMP = 3;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export default async function handler(request) {
  try {
    if (request.method === "GET") {
      return await listRampPhotos(request);
    }
    if (request.method === "PUT" || request.method === "POST") {
      return await uploadRampPhoto(request);
    }
    if (request.method === "DELETE") {
      return await removeRampPhoto(request);
    }
    return jsonResponse({ error: "Método não permitido." }, 405, { Allow: "GET, PUT, DELETE" });
  } catch (error) {
    const status = Number(error?.statusCode)
      || (/BLOB_READ_WRITE_TOKEN|store/i.test(String(error?.message || "")) ? 503 : 500);
    if (status >= 500) {
      console.error("Falha na API de fotos das rampas.", error);
    }
    return jsonResponse({
      error: status === 400
        ? error.message
        : status === 503
        ? "O Vercel Blob ainda não está conectado a este ambiente."
        : "Não foi possível processar a foto."
    }, status);
  }
}

async function listRampPhotos(request) {
  const featureId = new URL(request.url).searchParams.get("featureId");
  const prefix = getRampPrefix(featureId);
  const { blobs } = await list({ prefix, limit: MAX_PHOTOS_PER_RAMP + 1 });
  const photos = blobs.slice(0, MAX_PHOTOS_PER_RAMP).map((blob) => ({
    pathname: blob.pathname,
    size: blob.size,
    uploadedAt: blob.uploadedAt,
    imageUrl: `/api/ramp-photo?pathname=${encodeURIComponent(blob.pathname)}`
  }));
  return jsonResponse({ photos, limit: MAX_PHOTOS_PER_RAMP });
}

async function uploadRampPhoto(request) {
  const form = await request.formData();
  const featureId = String(form.get("featureId") || "");
  const prefix = getRampPrefix(featureId);
  const file = form.get("file");

  if (!file || typeof file.arrayBuffer !== "function") {
    return jsonResponse({ error: "Nenhuma foto foi enviada." }, 400);
  }
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    return jsonResponse({ error: "Use uma imagem JPG, PNG ou WebP." }, 415);
  }
  if (!file.size || file.size > MAX_FILE_BYTES) {
    return jsonResponse({ error: "A foto deve ter no máximo 4 MB." }, 413);
  }

  const current = await list({ prefix, limit: MAX_PHOTOS_PER_RAMP });
  if (current.blobs.length >= MAX_PHOTOS_PER_RAMP) {
    return jsonResponse({ error: `Esta rampa já possui ${MAX_PHOTOS_PER_RAMP} fotos.` }, 409);
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const blob = await put(`${prefix}photo.${extension}`, file, {
    access: "private",
    addRandomSuffix: true,
    contentType: file.type,
    cacheControlMaxAge: 3600
  });
  return jsonResponse({
    photo: {
      pathname: blob.pathname,
      imageUrl: `/api/ramp-photo?pathname=${encodeURIComponent(blob.pathname)}`
    },
    deleteToken: createDeleteToken(blob.pathname)
  }, 201);
}

async function removeRampPhoto(request) {
  const body = await request.json().catch(() => ({}));
  const featureId = String(body.featureId || "");
  const pathname = String(body.pathname || "");
  const deleteToken = String(body.deleteToken || "");
  const prefix = getRampPrefix(featureId);

  if (!pathname.startsWith(prefix) || !isValidDeleteToken(pathname, deleteToken)) {
    return jsonResponse({ error: "Você não tem autorização para excluir esta foto." }, 403);
  }

  await del(pathname);
  return jsonResponse({ deleted: true });
}

function getRampPrefix(featureId) {
  if (!/^(node|osm)\/\d+$/.test(String(featureId || ""))) {
    const error = new Error("Identificador de rampa inválido.");
    error.statusCode = 400;
    throw error;
  }
  return `ramp-photos/${featureId.replace("/", "-")}/`;
}

function createDeleteToken(pathname) {
  const secret = process.env.BLOB_READ_WRITE_TOKEN;
  if (!secret) {
    throw new Error("BLOB_READ_WRITE_TOKEN não configurado.");
  }
  return createHmac("sha256", secret).update(pathname).digest("base64url");
}

function isValidDeleteToken(pathname, token) {
  if (!token) {
    return false;
  }
  const expected = createDeleteToken(pathname);
  const actualBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}
