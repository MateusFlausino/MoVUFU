const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFile } = require("child_process");
const { DatabaseSync } = require("node:sqlite");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "ufu_accessibility.sqlite");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const MAP_JSON_PATH = path.join(DATA_DIR, "dwg-map-raw.json");
const EXPORT_LISP_PATH = path.join(ROOT, "tools", "export_dwg_map.lsp");
const ACCORECONSOLE_PATH = "C:\\Program Files\\Autodesk\\AutoCAD 2025\\accoreconsole.exe";
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const NO_CACHE_HEADERS = Object.freeze({
  "Cache-Control": "no-store, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0"
});

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const database = new DatabaseSync(DB_PATH);
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS ramps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    slope REAL,
    slopeUnit TEXT NOT NULL,
    widthCm REAL,
    condition TEXT NOT NULL,
    notes TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    verticesJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS route_segments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    verticesJson TEXT NOT NULL,
    slope REAL,
    widthCm REAL,
    condition TEXT NOT NULL,
    notes TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

const selectRampsStatement = database.prepare(`
  SELECT id, name, lat, lng, slope, slopeUnit, widthCm, condition, notes, createdAt, updatedAt
  FROM ramps
  ORDER BY updatedAt DESC, name COLLATE NOCASE ASC
`);

const selectBlocksStatement = database.prepare(`
  SELECT id, name, verticesJson, createdAt, updatedAt
  FROM blocks
  ORDER BY updatedAt DESC, name COLLATE NOCASE ASC
`);

const selectRouteSegmentsStatement = database.prepare(`
  SELECT id, name, verticesJson, slope, widthCm, condition, notes, createdAt, updatedAt
  FROM route_segments
  ORDER BY updatedAt DESC, name COLLATE NOCASE ASC
`);

const insertRampStatement = database.prepare(`
  INSERT INTO ramps (
    id, name, lat, lng, slope, slopeUnit, widthCm, condition, notes, createdAt, updatedAt
  ) VALUES (
    $id, $name, $lat, $lng, $slope, $slopeUnit, $widthCm, $condition, $notes, $createdAt, $updatedAt
  )
`);

const insertBlockStatement = database.prepare(`
  INSERT INTO blocks (
    id, name, verticesJson, createdAt, updatedAt
  ) VALUES (
    $id, $name, $verticesJson, $createdAt, $updatedAt
  )
`);

const insertRouteSegmentStatement = database.prepare(`
  INSERT INTO route_segments (
    id, name, verticesJson, slope, widthCm, condition, notes, createdAt, updatedAt
  ) VALUES (
    $id, $name, $verticesJson, $slope, $widthCm, $condition, $notes, $createdAt, $updatedAt
  )
`);

function respondJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...NO_CACHE_HEADERS
  });
  response.end(JSON.stringify(payload));
}

function respondText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...NO_CACHE_HEADERS
  });
  response.end(message);
}

function getFilePath(requestUrl) {
  const cleanUrl = decodeURIComponent((requestUrl || "/").split("?")[0]);
  const relativePath = cleanUrl === "/" ? "index.html" : cleanUrl.replace(/^\/+/, "");
  return path.resolve(ROOT, relativePath);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_UPLOAD_BYTES) {
        reject(new Error("Arquivo maior que o limite permitido."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8").trim();
      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(new Error("JSON inválido no corpo da requisição."));
      }
    });

    request.on("error", reject);
  });
}

function readBinaryBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_UPLOAD_BYTES) {
        reject(new Error("Arquivo maior que o limite permitido."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function getMultipartBoundary(contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match ? match[1] || match[2] : "";
}

function parseMultipartUpload(bodyBuffer, boundary) {
  if (!boundary) {
    throw new Error("Requisicao sem boundary multipart.");
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(bodyBuffer, delimiter);

  for (const rawPart of parts) {
    let part = rawPart;

    if (part.length === 0 || part.equals(Buffer.from("--\r\n")) || part.equals(Buffer.from("--"))) {
      continue;
    }

    if (part.subarray(0, 2).toString("latin1") === "\r\n") {
      part = part.subarray(2);
    }

    if (part.subarray(part.length - 2).toString("latin1") === "\r\n") {
      part = part.subarray(0, part.length - 2);
    }

    if (part.subarray(part.length - 2).toString("latin1") === "--") {
      part = part.subarray(0, part.length - 2);
    }

    const headerEndIndex = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEndIndex === -1) {
      continue;
    }

    const rawHeaders = part.subarray(0, headerEndIndex).toString("latin1");
    const content = part.subarray(headerEndIndex + 4);
    const disposition = rawHeaders
      .split(/\r\n/)
      .find((line) => line.toLowerCase().startsWith("content-disposition:")) || "";
    const filenameMatch = disposition.match(/filename="([^"]+)"/i);

    if (filenameMatch) {
      return {
        buffer: content,
        filename: path.basename(filenameMatch[1])
      };
    }
  }

  throw new Error("Nenhum arquivo DWG foi enviado.");
}

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let searchStart = 0;
  let delimiterIndex = buffer.indexOf(delimiter, searchStart);

  while (delimiterIndex !== -1) {
    if (delimiterIndex > searchStart) {
      parts.push(buffer.subarray(searchStart, delimiterIndex));
    }
    searchStart = delimiterIndex + delimiter.length;
    delimiterIndex = buffer.indexOf(delimiter, searchStart);
  }

  if (searchStart < buffer.length) {
    parts.push(buffer.subarray(searchStart));
  }

  return parts;
}

function sanitizeUploadName(filename) {
  const extension = path.extname(filename).toLowerCase();
  const baseName = path.basename(filename, extension)
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "planta";

  return `${baseName}-${Date.now()}${extension}`;
}

function toAutoLispPath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function exportDwgToMapJson(dwgPath) {
  return new Promise((resolve, reject) => {
    const tempJsonPath = path.join(UPLOAD_DIR, `export-${Date.now()}.json`);
    const scriptPath = path.join(UPLOAD_DIR, `export-${Date.now()}.scr`);
    const scriptContent = [
      '(setvar "SECURELOAD" 0)',
      `(load "${toAutoLispPath(EXPORT_LISP_PATH)}")`,
      `(export-dwg-map "${toAutoLispPath(tempJsonPath)}")`,
      "_.QUIT",
      ""
    ].join("\n");

    fs.writeFileSync(scriptPath, scriptContent, "utf8");

    execFile(
      ACCORECONSOLE_PATH,
      ["/i", dwgPath, "/s", scriptPath],
      {
        cwd: ROOT,
        timeout: 180000,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        try {
          if (error) {
            reject(new Error(`Falha ao exportar DWG: ${error.message}`));
            return;
          }

          const exportedData = JSON.parse(fs.readFileSync(tempJsonPath, "utf8"));
          if (!Number(exportedData.summary?.nodes)) {
            reject(new Error("O DWG foi lido, mas nenhum no acessivel foi encontrado nos layers/blocos configurados."));
            return;
          }

          fs.copyFileSync(tempJsonPath, MAP_JSON_PATH);
          resolve({
            stdout,
            stderr,
            summary: exportedData.summary || {},
            source: exportedData.source || dwgPath
          });
        } catch (parseError) {
          reject(new Error(`DWG exportado, mas o JSON ficou invalido: ${parseError.message}`));
        } finally {
          fs.rm(scriptPath, { force: true }, () => {});
          fs.rm(tempJsonPath, { force: true }, () => {});
        }
      }
    );
  });
}

async function handleDwgUploadRequest(request, response) {
  if (request.method !== "POST") {
    respondText(response, 405, "Method not allowed");
    return true;
  }

  try {
    const boundary = getMultipartBoundary(request.headers["content-type"]);
    const upload = parseMultipartUpload(await readBinaryBody(request), boundary);

    if (path.extname(upload.filename).toLowerCase() !== ".dwg") {
      throw new Error("Envie um arquivo .dwg.");
    }

    const uploadPath = path.join(UPLOAD_DIR, sanitizeUploadName(upload.filename));
    fs.writeFileSync(uploadPath, upload.buffer);

    const exportResult = await exportDwgToMapJson(uploadPath);
    respondJson(response, 200, {
      filename: path.basename(uploadPath),
      source: exportResult.source,
      summary: exportResult.summary
    });
  } catch (error) {
    respondJson(response, 400, {
      error: error.message || "Nao foi possivel atualizar a planta."
    });
  }

  return true;
}

function normalizeCoordinateValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(6)) : null;
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRampRecord(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const lat = normalizeCoordinateValue(item.lat);
  const lng = normalizeCoordinateValue(item.lng);
  if (lat === null || lng === null) {
    return null;
  }

  const normalizedId = typeof item.id === "string" && item.id.trim()
    ? item.id.trim()
    : `ramp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const normalizedName = String(item.name || "Rampa sem nome").trim() || "Rampa sem nome";
  const normalizedCondition = ["bom", "medio", "ruim"].includes(item.condition)
    ? item.condition
    : "medio";
  const nowIso = new Date().toISOString();

  return {
    id: normalizedId,
    name: normalizedName,
    lat,
    lng,
    slope: normalizeOptionalNumber(item.slope),
    slopeUnit: item.slopeUnit === "graus" ? "graus" : "%",
    widthCm: normalizeOptionalNumber(item.widthCm ?? item.width),
    condition: normalizedCondition,
    notes: String(item.notes || item.observations || "").trim(),
    createdAt: typeof item.createdAt === "string" ? item.createdAt : nowIso,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : nowIso
  };
}

function normalizeBlockRecord(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const vertices = Array.isArray(item.vertices)
    ? item.vertices
    : Array.isArray(item.perimeter)
      ? item.perimeter
      : [];

  const normalizedVertices = vertices
    .map((vertex) => {
      if (!vertex || typeof vertex !== "object") {
        return null;
      }

      const lat = normalizeCoordinateValue(vertex.lat);
      const lng = normalizeCoordinateValue(vertex.lng);
      if (lat === null || lng === null) {
        return null;
      }

      return { lat, lng };
    })
    .filter(Boolean);

  if (normalizedVertices.length < 3) {
    return null;
  }

  const nowIso = new Date().toISOString();

  return {
    id: typeof item.id === "string" && item.id.trim()
      ? item.id.trim()
      : `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(item.name || "Bloco sem nome").trim() || "Bloco sem nome",
    vertices: normalizedVertices,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : nowIso,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : nowIso
  };
}

function normalizeRouteSegmentRecord(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const vertices = Array.isArray(item.vertices)
    ? item.vertices
    : Array.isArray(item.points)
      ? item.points
      : [];

  const normalizedVertices = vertices
    .map((vertex) => {
      if (!vertex || typeof vertex !== "object") {
        return null;
      }

      const lat = normalizeCoordinateValue(vertex.lat);
      const lng = normalizeCoordinateValue(vertex.lng);
      if (lat === null || lng === null) {
        return null;
      }

      return { lat, lng };
    })
    .filter(Boolean);

  if (normalizedVertices.length < 2) {
    return null;
  }

  const nowIso = new Date().toISOString();

  return {
    id: typeof item.id === "string" && item.id.trim()
      ? item.id.trim()
      : `route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(item.name || "Trecho sem nome").trim() || "Trecho sem nome",
    vertices: normalizedVertices,
    slope: normalizeOptionalNumber(item.slope),
    widthCm: normalizeOptionalNumber(item.widthCm ?? item.width),
    condition: ["bom", "medio", "ruim"].includes(item.condition) ? item.condition : "medio",
    notes: String(item.notes || "").trim(),
    createdAt: typeof item.createdAt === "string" ? item.createdAt : nowIso,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : nowIso
  };
}

function getStoredMapData() {
  const ramps = selectRampsStatement.all().map((ramp) => ({
    ...ramp,
    slope: ramp.slope === null ? null : Number(ramp.slope),
    widthCm: ramp.widthCm === null ? null : Number(ramp.widthCm)
  }));

  const blocks = selectBlocksStatement.all().map((block) => ({
    id: block.id,
    name: block.name,
    vertices: JSON.parse(block.verticesJson),
    createdAt: block.createdAt,
    updatedAt: block.updatedAt
  }));

  const routeSegments = selectRouteSegmentsStatement.all().map((segment) => ({
    id: segment.id,
    name: segment.name,
    vertices: JSON.parse(segment.verticesJson),
    slope: segment.slope === null ? null : Number(segment.slope),
    widthCm: segment.widthCm === null ? null : Number(segment.widthCm),
    condition: segment.condition,
    notes: segment.notes,
    createdAt: segment.createdAt,
    updatedAt: segment.updatedAt
  }));

  return { ramps, blocks, routeSegments };
}

function replaceStoredMapData(payload) {
  const ramps = Array.isArray(payload?.ramps)
    ? payload.ramps.map(normalizeRampRecord).filter(Boolean)
    : [];
  const blocks = Array.isArray(payload?.blocks)
    ? payload.blocks.map(normalizeBlockRecord).filter(Boolean)
    : [];
  const routeSegments = Array.isArray(payload?.routeSegments)
    ? payload.routeSegments.map(normalizeRouteSegmentRecord).filter(Boolean)
    : [];

  database.exec("BEGIN IMMEDIATE");

  try {
    database.exec("DELETE FROM ramps");
    database.exec("DELETE FROM blocks");
    database.exec("DELETE FROM route_segments");

    for (const ramp of ramps) {
      insertRampStatement.run({
        $id: ramp.id,
        $name: ramp.name,
        $lat: ramp.lat,
        $lng: ramp.lng,
        $slope: ramp.slope,
        $slopeUnit: ramp.slopeUnit,
        $widthCm: ramp.widthCm,
        $condition: ramp.condition,
        $notes: ramp.notes,
        $createdAt: ramp.createdAt,
        $updatedAt: ramp.updatedAt
      });
    }

    for (const block of blocks) {
      insertBlockStatement.run({
        $id: block.id,
        $name: block.name,
        $verticesJson: JSON.stringify(block.vertices),
        $createdAt: block.createdAt,
        $updatedAt: block.updatedAt
      });
    }

    for (const routeSegment of routeSegments) {
      insertRouteSegmentStatement.run({
        $id: routeSegment.id,
        $name: routeSegment.name,
        $verticesJson: JSON.stringify(routeSegment.vertices),
        $slope: routeSegment.slope,
        $widthCm: routeSegment.widthCm,
        $condition: routeSegment.condition,
        $notes: routeSegment.notes,
        $createdAt: routeSegment.createdAt,
        $updatedAt: routeSegment.updatedAt
      });
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return { ramps, blocks, routeSegments };
}

async function handleApiRequest(request, response) {
  const pathname = new URL(request.url, `http://${HOST}:${PORT}`).pathname;

  if (pathname === "/api/upload-dwg") {
    return handleDwgUploadRequest(request, response);
  }

  if (pathname !== "/api/map-data") {
    return false;
  }

  if (request.method === "GET") {
    respondJson(response, 200, getStoredMapData());
    return true;
  }

  if (request.method === "PUT") {
    try {
      const payload = await readJsonBody(request);
      const storedData = replaceStoredMapData(payload);
      respondJson(response, 200, storedData);
    } catch (error) {
      respondJson(response, 400, {
        error: error.message || "Não foi possível salvar os dados do mapa."
      });
    }
    return true;
  }

  respondText(response, 405, "Method not allowed");
  return true;
}

const server = http.createServer(async (request, response) => {
  try {
    const handledApi = await handleApiRequest(request, response);
    if (handledApi) {
      return;
    }

    const filePath = getFilePath(request.url);

    if (!filePath.startsWith(ROOT)) {
      respondText(response, 403, "Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        respondText(response, 404, "Not found");
        return;
      }

      const extension = path.extname(filePath).toLowerCase();
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
        ...NO_CACHE_HEADERS
      });
      response.end(data);
    });
  } catch (error) {
    console.error(error);
    respondJson(response, 500, {
      error: "Erro interno no servidor."
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
});
