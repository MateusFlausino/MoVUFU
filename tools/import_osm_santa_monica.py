"""Importa caminhos e pontos de acessibilidade OSM do Campus Santa Monica."""

from __future__ import annotations

import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path


BBOX = (-48.26232, -18.92084, -48.25386, -18.91589)  # oeste, sul, leste, norte
OSM_MAP_URL = (
    "https://api.openstreetmap.org/api/0.6/map"
    f"?bbox={BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}"
)
PEDESTRIAN_HIGHWAYS = {
    "footway", "path", "pedestrian", "steps", "living_street",
    "residential", "service", "unclassified", "track",
}
ACCESSIBLE_KERBS = {"lowered", "flush"}
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "data" / "osm-santa-monica-accessibility.geojson"


def tags(element: ET.Element) -> dict[str, str]:
    return {
        tag.attrib["k"]: tag.attrib.get("v", "")
        for tag in element.findall("tag")
    }


def point_in_polygon(point: tuple[float, float], polygon: list[tuple[float, float]]) -> bool:
    x, y = point
    inside = False
    previous = polygon[-1]

    for current in polygon:
        x1, y1 = previous
        x2, y2 = current
        crosses = (y1 > y) != (y2 > y)
        if crosses and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-15) + x1:
            inside = not inside
        previous = current

    return inside


def find_campus_boundary(
    ways: list[ET.Element], nodes: dict[str, tuple[float, float]]
) -> list[tuple[float, float]]:
    candidates = []

    for way in ways:
        way_tags = tags(way)
        if way_tags.get("amenity") != "university":
            continue
        if "Universidade Federal de Uberlândia" not in way_tags.get("name", ""):
            continue
        coordinates = [
            nodes[nd.attrib["ref"]]
            for nd in way.findall("nd")
            if nd.attrib["ref"] in nodes
        ]
        if len(coordinates) >= 4:
            candidates.append(coordinates)

    if not candidates:
        raise RuntimeError("Limite da Universidade Federal de Uberlandia nao encontrado no OSM.")

    return max(candidates, key=len)


def is_accessibility_node(node_tags: dict[str, str]) -> bool:
    return (
        node_tags.get("highway") == "crossing"
        or node_tags.get("kerb") in ACCESSIBLE_KERBS
        or "wheelchair" in node_tags
        or "tactile_paving" in node_tags
    )


def is_routable_way(way_tags: dict[str, str]) -> bool:
    return (
        way_tags.get("highway") in PEDESTRIAN_HIGHWAYS
        and way_tags.get("foot") not in {"no", "use_sidepath"}
        and way_tags.get("access") != "no"
    )


def point_in_bbox(point: tuple[float, float]) -> bool:
    longitude, latitude = point
    west, south, east, north = BBOX
    return west <= longitude <= east and south <= latitude <= north


def is_destination(tags_map: dict[str, str]) -> bool:
    return bool(tags_map.get("name") or tags_map.get("ref")) and bool(
        tags_map.get("building")
        or tags_map.get("amenity")
        or tags_map.get("entrance")
        or tags_map.get("office")
        or tags_map.get("leisure")
    )


def polygon_centroid(coordinates: list[tuple[float, float]]) -> tuple[float, float]:
    points = coordinates[:-1] if coordinates[0] == coordinates[-1] else coordinates
    return (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )


def download_osm() -> bytes:
    request = urllib.request.Request(
        OSM_MAP_URL,
        headers={"User-Agent": "MoV-UFU-accessibility-research/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def build_geojson(osm_xml: bytes) -> dict:
    root = ET.fromstring(osm_xml)
    node_elements = root.findall("node")
    ways = root.findall("way")
    nodes = {
        node.attrib["id"]: (float(node.attrib["lon"]), float(node.attrib["lat"]))
        for node in node_elements
    }
    campus_boundary = find_campus_boundary(ways, nodes)
    features = []
    pathway_count = 0
    point_count = 0
    destination_count = 0
    destination_keys: set[tuple[str, str]] = set()

    for way in ways:
        way_tags = tags(way)
        if not way_tags.get("building"):
            continue
        coordinates = [
            nodes[nd.attrib["ref"]]
            for nd in way.findall("nd")
            if nd.attrib["ref"] in nodes
        ]
        if len(coordinates) < 3:
            continue
        coordinate = polygon_centroid(coordinates)
        if not point_in_polygon(coordinate, campus_boundary):
            continue
        if coordinates[0] != coordinates[-1]:
            coordinates.append(coordinates[0])
        features.append(
            {
                "type": "Feature",
                "id": f"building/way/{way.attrib['id']}",
                "properties": {
                    "osm_id": way.attrib["id"],
                    "feature_class": "building_outline",
                    **way_tags,
                },
                "geometry": {"type": "Polygon", "coordinates": [coordinates]},
            }
        )

    for way in ways:
        way_tags = tags(way)
        if not is_routable_way(way_tags):
            continue
        coordinates = [
            nodes[nd.attrib["ref"]]
            for nd in way.findall("nd")
            if nd.attrib["ref"] in nodes
        ]
        if len(coordinates) < 2 or not any(
            point_in_polygon(coordinate, campus_boundary) for coordinate in coordinates
        ):
            continue
        features.append(
            {
                "type": "Feature",
                "id": f"way/{way.attrib['id']}",
                "properties": {
                    "osm_id": way.attrib["id"],
                    "feature_class": "pedestrian_path",
                    **way_tags,
                },
                "geometry": {"type": "LineString", "coordinates": coordinates},
            }
        )
        pathway_count += 1

    for node in node_elements:
        node_tags = tags(node)
        coordinate = nodes[node.attrib["id"]]
        is_entrance = "entrance" in node_tags
        if (not is_accessibility_node(node_tags) and not is_entrance) or not point_in_polygon(coordinate, campus_boundary):
            continue
        features.append(
            {
                "type": "Feature",
                "id": f"node/{node.attrib['id']}",
                "properties": {
                    "osm_id": node.attrib["id"],
                    "feature_class": "entrance_point" if is_entrance else "accessibility_point",
                    "label": node_tags.get("name") or node_tags.get("ref") or "Entrada/saida do bloco",
                    **node_tags,
                },
                "geometry": {"type": "Point", "coordinates": coordinate},
            }
        )
        point_count += 1

    for way in ways:
        way_tags = tags(way)
        if not is_destination(way_tags):
            continue
        coordinates = [
            nodes[nd.attrib["ref"]]
            for nd in way.findall("nd")
            if nd.attrib["ref"] in nodes
        ]
        if len(coordinates) < 3:
            continue
        coordinate = polygon_centroid(coordinates)
        if not point_in_polygon(coordinate, campus_boundary):
            continue
        label = way_tags.get("ref") or way_tags.get("name") or way.attrib["id"]
        key = (label.casefold(), way_tags.get("name", "").casefold())
        if key in destination_keys:
            continue
        destination_keys.add(key)
        features.append(
            {
                "type": "Feature",
                "id": f"destination/way/{way.attrib['id']}",
                "properties": {
                    "osm_id": way.attrib["id"],
                    "feature_class": "destination",
                    "label": label,
                    **way_tags,
                },
                "geometry": {"type": "Point", "coordinates": coordinate},
            }
        )
        destination_count += 1

    for node in node_elements:
        node_tags = tags(node)
        coordinate = nodes[node.attrib["id"]]
        if not is_destination(node_tags) or not point_in_polygon(coordinate, campus_boundary):
            continue
        label = node_tags.get("ref") or node_tags.get("name") or node.attrib["id"]
        key = (label.casefold(), node_tags.get("name", "").casefold())
        if key in destination_keys:
            continue
        destination_keys.add(key)
        features.append(
            {
                "type": "Feature",
                "id": f"destination/node/{node.attrib['id']}",
                "properties": {
                    "osm_id": node.attrib["id"],
                    "feature_class": "destination",
                    "label": label,
                    **node_tags,
                },
                "geometry": {"type": "Point", "coordinates": coordinate},
            }
        )
        destination_count += 1

    return {
        "type": "FeatureCollection",
        "name": "UFU Campus Santa Monica - caminhos e acessibilidade OSM",
        "metadata": {
            "source": "OpenStreetMap contributors",
            "source_url": "https://www.openstreetmap.org/copyright",
            "license": "ODbL 1.0",
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
            "bbox": list(BBOX),
            "pedestrian_path_count": pathway_count,
            "accessibility_point_count": point_count,
            "destination_count": destination_count,
            "warning": "Dados colaborativos; validar rampas e condicoes de acessibilidade em campo.",
        },
        "features": features,
    }


def main() -> int:
    try:
        collection = build_geojson(download_osm())
        OUTPUT_PATH.write_text(
            json.dumps(collection, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as error:
        print(f"Falha ao importar OSM: {error}", file=sys.stderr)
        return 1

    metadata = collection["metadata"]
    print(f"Arquivo: {OUTPUT_PATH}")
    print(f"Caminhos de pedestres: {metadata['pedestrian_path_count']}")
    print(f"Pontos de acessibilidade: {metadata['accessibility_point_count']}")
    print(f"Destinos nomeados: {metadata['destination_count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
