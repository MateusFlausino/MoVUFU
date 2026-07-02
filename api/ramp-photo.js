import { get } from "@vercel/blob";

export default async function handler(request) {
  if (request.method !== "GET") {
    return new Response("Método não permitido.", { status: 405, headers: { Allow: "GET" } });
  }

  const pathname = new URL(request.url).searchParams.get("pathname") || "";
  if (!/^ramp-photos\/(node|osm)-\d+\//.test(pathname)) {
    return new Response("Arquivo inválido.", { status: 400 });
  }

  try {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200) {
      return new Response("Foto não encontrada.", { status: 404 });
    }

    return new Response(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType || "application/octet-stream",
        "Content-Length": String(result.blob.size || ""),
        "Cache-Control": "private, no-cache",
        "ETag": result.blob.etag,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox"
      }
    });
  } catch (error) {
    console.error("Falha ao entregar foto privada da rampa.", error);
    return new Response("Foto não encontrada.", { status: 404 });
  }
}
