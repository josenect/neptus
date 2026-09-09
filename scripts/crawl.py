#!/usr/bin/env python3
"""Recorre la carpeta publica de Drive de NEPTUS STORE y vuelca el arbol a data/tree.json.

Usa la vista embebida de Drive (embeddedfolderview), que devuelve HTML plano con el id y el
nombre de cada entrada y no requiere autenticacion. Solo funciona mientras la carpeta siga
compartida con "cualquiera con el enlace".
"""

import concurrent.futures
import json
import os
import re
import urllib.request

ROOT_ID = "1LLU01ZYmPlCB2qn96H59IutBrpLl1dVZ"
ROOT_NAME = "NEPTUS STORE"
MAX_DEPTH = 4
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "tree.json")

IS_FILE = re.compile(r"\.(heic|jpe?g|png|webp)\s*$", re.I)
ENTRY_ID = re.compile(r'id="entry-([\w-]+)"')
ENTRY_TITLE = re.compile(r'flip-entry-title">([^<]*)<')


def listing(folder_id):
    """Devuelve [(id, nombre)] de las entradas directas de una carpeta."""
    url = "https://drive.google.com/embeddedfolderview?id=%s#list" % folder_id
    for intento in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                html = r.read().decode("utf-8", "replace")
            return list(zip(ENTRY_ID.findall(html), ENTRY_TITLE.findall(html)))
        except Exception as e:
            if intento == 3:
                print("  !! no se pudo leer %s: %s" % (folder_id, e))
                return []
    return []


def walk(folder_id, name, depth):
    node = {"id": folder_id, "name": name.strip(), "folders": [], "files": []}
    subfolders = []
    for child_id, child_name in listing(folder_id):
        if IS_FILE.search(child_name):
            node["files"].append({"id": child_id, "name": child_name.strip()})
        else:
            subfolders.append((child_id, child_name))
    if subfolders and depth < MAX_DEPTH:
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            node["folders"] = list(
                pool.map(lambda c: walk(c[0], c[1], depth + 1), subfolders)
            )
    return node


def total_files(node):
    return len(node["files"]) + sum(total_files(c) for c in node["folders"])


def main():
    print("Leyendo Drive: %s" % ROOT_NAME)
    tree = walk(ROOT_ID, ROOT_NAME, 0)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(tree, f, ensure_ascii=False, indent=1)
    print("%d categorias, %d archivos -> %s" % (
        len(tree["folders"]), total_files(tree), os.path.relpath(OUT)))


if __name__ == "__main__":
    main()
