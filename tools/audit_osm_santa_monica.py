"""Audita a conectividade pedestre dentro da delimitacao OSM do Campus Santa Monica."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from collections import Counter

from import_osm_santa_monica import (
    download_osm,
    find_campus_boundary,
    is_routable_way,
    point_in_polygon,
    tags,
)


def main() -> None:
    root = ET.fromstring(download_osm())
    node_elements = root.findall("node")
    ways = root.findall("way")
    nodes = {
        node.attrib["id"]: (float(node.attrib["lon"]), float(node.attrib["lat"]))
        for node in node_elements
    }
    boundary = find_campus_boundary(ways, nodes)
    boundary_way = next(
        way
        for way in ways
        if tags(way).get("amenity") == "university"
        and "Universidade Federal de Uberlândia" in tags(way).get("name", "")
        and len([nd for nd in way.findall("nd") if nd.attrib["ref"] in nodes]) == len(boundary)
    )

    routable_ways = []
    pedestrian_node_ids: set[str] = set()
    for way in ways:
        way_tags = tags(way)
        if not is_routable_way(way_tags):
            continue
        coordinates = [nodes[nd.attrib["ref"]] for nd in way.findall("nd") if nd.attrib["ref"] in nodes]
        if not coordinates or not any(point_in_polygon(point, boundary) for point in coordinates):
            continue
        routable_ways.append(way)
        pedestrian_node_ids.update(nd.attrib["ref"] for nd in way.findall("nd"))

    inside_nodes = [
        node for node in node_elements
        if point_in_polygon(nodes[node.attrib["id"]], boundary)
    ]
    crossings = [node for node in inside_nodes if tags(node).get("highway") == "crossing"]
    entrances = [node for node in inside_nodes if "entrance" in tags(node)]
    connected_crossings = [node for node in crossings if node.attrib["id"] in pedestrian_node_ids]
    connected_entrances = [node for node in entrances if node.attrib["id"] in pedestrian_node_ids]
    entrance_types = Counter(tags(node).get("entrance", "sem_valor") for node in entrances)
    highway_types = Counter(tags(way).get("highway", "sem_valor") for way in routable_ways)

    print(f"Delimitacao OSM: way/{boundary_way.attrib['id']}")
    print(f"Versao da delimitacao: {boundary_way.attrib.get('version', '?')}")
    print(f"Ultima edicao da delimitacao: {boundary_way.attrib.get('timestamp', '?')}")
    print(f"Caminhos/vias caminhaveis dentro do campus: {len(routable_ways)}")
    print("Tipos de caminho: " + ", ".join(f"{key}={value}" for key, value in highway_types.most_common()))
    print(f"Travessias dentro do campus: {len(crossings)}")
    print(f"Travessias conectadas a via caminhavel: {len(connected_crossings)}/{len(crossings)}")
    print(f"Entradas/saidas de blocos mapeadas: {len(entrances)}")
    print(f"Entradas/saidas conectadas a via caminhavel: {len(connected_entrances)}/{len(entrances)}")
    print("Tipos de entrada: " + ", ".join(f"{key}={value}" for key, value in entrance_types.most_common()))


if __name__ == "__main__":
    main()
