#!/usr/bin/env python3
"""Convierte data/tree.json en el catalogo publicable: public/catalog.json + public/img/**.

Pasos: aplanar el arbol -> agrupar variantes de talla por nombre de archivo -> descargar el
JPEG que Drive genera desde cada HEIC -> fusionar duplicados por hash de contenido ->
asignar referencias estables -> codificar WebP en dos tamanos.

Es incremental: lo ya descargado en data/cache/ no se vuelve a bajar y las referencias ya
asignadas en data/refs.json nunca cambian. La referencia va atada al id del archivo en Drive,
que es permanente; el hash del contenido solo sirve para fusionar duplicados dentro de una
pasada, porque Drive devuelve bytes distintos cada vez que regenera el JPEG.

Uso:  python3 scripts/build.py [--limit N]
"""

import argparse
import concurrent.futures
import datetime
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.request

from PIL import Image, ImageOps

import config   # lee el .env de la raiz, el unico sitio con los datos del negocio

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TREE = os.path.join(BASE, "data", "tree.json")
CACHE = os.path.join(BASE, "data", "cache")
REFS = os.path.join(BASE, "data", "refs.json")
SITE = os.path.join(BASE, "public")
IMG_GRID = os.path.join(SITE, "img", "grid")
IMG_FULL = os.path.join(SITE, "img", "full")
IMG_CAT = os.path.join(SITE, "img", "cat")   # una miniatura cuadrada por categoria

# Tamanos de salida. Bajar estos valores es la palanca para reducir el peso del sitio.
GRID_W, GRID_Q = 450, 72
FULL_W, FULL_Q = 900, 72
CAT_W, CAT_Q = 260, 68   # miniatura del selector de bienvenida, recortada en cuadrado
SOURCE_W = 1400          # ancho que le pedimos al thumbnail de Drive
DOWNLOAD_WORKERS = 4     # subir esto dispara los 429 de Google

SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"]

# Variantes de escritura que aparecen al nombrar carpetas a mano: son la misma talla.
SIZE_ALIASES = {
    "XXL": "2XL", "XXXL": "3XL", "XXXXL": "4XL", "XXXXXL": "5XL",
    "2XLARGE": "2XL", "SMALL": "S", "MEDIUM": "M", "LARGE": "L", "XLARGE": "XL",
}

BRANDS = ["HUGO BOSS", "DSQUARED2", "DSQUARED", "DIESEL"]

# Prefijos de referencia fijos: el dueno pasa estas refs a sus clientes, no pueden cambiar.
PREFIX = {
    "BERMUDA ALGODÓN": "BAL", "BERMUDAS JEANS": "BJN", "BILLETERAS 1.1": "BIL",
    "BOXER": "BOX", "CAMISAS 1.1": "CAM", "CAMISETA 270gr": "C27",
    "CAMISETA NIÑ@S": "CNI", "CARRIELES 1.1": "CAR", "COLOMBIA 🇨🇴": "COL",
    "CONJUNTO CABALLERO": "CON", "CORREAS": "COR", "GORRAS": "GOR",
    "JEANS IMPORTADO": "JEA", "PERFUMES 1.1": "PER", "PLAYERAS": "PLA",
    "RELOJ 1.1": "REL", "SANDALIA": "SAN", "TIPO POLO CABALLERO": "POL",
}

print_lock = threading.Lock()


# --------------------------------------------------------------------------- aplanado

def leaves(node, path):
    """Genera (path, node) por cada carpeta que contiene archivos."""
    if node["files"]:
        yield path, node
    for child in node["folders"]:
        yield from leaves(child, path + [child["name"]])


def brand_of(segment):
    """Extrae la marca de un nombre de subcarpeta ('JEANS HUGO BOSS' -> 'HUGO BOSS')."""
    if not segment:
        return None
    up = segment.upper()
    for b in BRANDS:
        if b in up:
            return "DSQUARED2" if b.startswith("DSQUARED") else b
    return None


def parse_size(folder_name):
    """'TALLA XXL' -> '2XL'. Devuelve None si la carpeta se llama solo 'TALLA', sin talla."""
    partes = folder_name.split(None, 1)
    if len(partes) < 2:
        return None
    s = partes[1].strip().upper().replace(" ", "").replace(".", "")
    return SIZE_ALIASES.get(s, s)


def size_key(s):
    """Ordena las tallas conocidas; las desconocidas van al final, alfabeticamente."""
    return (SIZE_ORDER.index(s), "") if s in SIZE_ORDER else (len(SIZE_ORDER), s)


def collect_products(tree):
    """Agrupa los archivos en productos. La misma foto en varias carpetas TALLA es un producto.

    Devuelve (productos, tallas_desconocidas). Las tallas que no estan en SIZE_ORDER se
    conservan igualmente: se avisa por pantalla en vez de tirarlas en silencio.
    """
    products = {}  # (familia, filename, repeticion) -> dict
    desconocidas = {}
    for path, node in leaves(tree, []):
        if path and path[-1].upper().startswith("TALLA"):
            family, size = path[:-1], parse_size(path[-1])
            if size and size not in SIZE_ORDER:
                desconocidas.setdefault(size, set()).add(" / ".join(path[:-1]))
        else:
            family, size = path, None
        if not family:
            continue
        category = family[0]
        sub = family[1] if len(family) > 1 else None
        # Drive admite dos archivos DISTINTOS con el mismo nombre en una misma carpeta, asi que
        # el nombre no basta como clave: se numera cada repeticion dentro de su propia carpeta.
        # La n-esima copia de un nombre se empareja con la n-esima de las demas carpetas TALLA;
        # si el emparejamiento no fuera el correcto, la fusion por hash posterior lo arregla.
        repetido = {}
        for f in node["files"]:
            n = repetido[f["name"]] = repetido.get(f["name"], 0) + 1
            key = (tuple(family), f["name"], n)
            p = products.get(key)
            if p is None:
                p = products[key] = {
                    "cat": category, "sub": sub, "brand": brand_of(sub),
                    "file": f["name"], "drive": f["id"], "sizes": set(),
                }
            if size:
                p["sizes"].add(size)
    ordered = sorted(products.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2]))
    return [p for _, p in ordered], desconocidas


# --------------------------------------------------------------------------- descarga

def download(product, index, total):
    """Baja a data/cache/ el JPEG que Drive genera desde el HEIC. Reintenta con backoff."""
    dest = os.path.join(CACHE, product["drive"] + ".jpg")
    if os.path.exists(dest) and os.path.getsize(dest) > 1024:
        return dest
    url = "https://drive.google.com/thumbnail?id=%s&sz=w%d" % (product["drive"], SOURCE_W)
    for intento in range(5):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                data = r.read()
            if len(data) < 1024:
                raise ValueError("respuesta vacia (%d bytes)" % len(data))
            tmp = dest + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, dest)
            with print_lock:
                if index % 25 == 0:
                    print("  descargadas %d/%d" % (index, total), flush=True)
            return dest
        except Exception as e:
            if intento == 4:
                with print_lock:
                    print("  !! fallo %s: %s" % (product["file"], e), flush=True)
                return None
            time.sleep(2 ** intento)
    return None


# --------------------------------------------------------------------------- referencias

def load_refs():
    """Devuelve (refs, reservadas): id de Drive -> referencia, y numeros ya gastados.

    La clave es el id del archivo en Drive, que es permanente. NO se puede usar el hash del
    contenido: Drive genera el JPEG desde el HEIC al vuelo y devuelve bytes distintos cada
    vez (comprobado: la mitad de las fotos cambian de tamano entre dos descargas), asi que
    con el hash media tienda se renumeraba cada vez que la cache se enfriaba.
    """
    if not os.path.exists(REFS):
        return {}, set()
    with open(REFS, encoding="utf-8") as f:
        datos = json.load(f)
    if datos.get("version") != 2:
        raise SystemExit(
            "data/refs.json tiene un formato antiguo (referencias por hash del contenido).\n"
            "Ese formato renumera los productos y las referencias ya estan con los clientes.\n"
            "No se continua para no reasignarlas; ver CONFIGURACION.md."
        )
    return datos["refs"], set(datos.get("reservadas", []))


def save_refs(refs, reservadas):
    with open(REFS, "w", encoding="utf-8") as f:
        json.dump({"version": 2,
                   "refs": dict(sorted(refs.items(), key=lambda kv: kv[1])),
                   "reservadas": sorted(reservadas)}, f, indent=1)


def make_ref(category, refs, reservadas, counters):
    prefix = PREFIX.get(category)
    if not prefix:
        prefix = (re.sub(r"[^A-Z]", "", category.upper()) + "XXX")[:3]
    n = counters.get(prefix, 0)
    # Las reservadas son numeros que un dia se publicaron y luego quedaron sueltos: no se
    # reutilizan, o un cliente pediria la foto de otro.
    used = set(refs.values()) | reservadas
    while True:
        n += 1
        candidate = "%s-%04d" % (prefix, n)
        if candidate not in used:
            counters[prefix] = n
            return candidate


def num_ref(ref):
    """Orden estable de referencias: por prefijo y numero, no alfabetico."""
    prefix, _, num = ref.rpartition("-")
    return (prefix, int(num) if num.isdigit() else 0)


# --------------------------------------------------------------------------- imagenes

def encode(src, ref):
    """Genera las dos versiones WebP. Devuelve (ancho, alto) de la version del grid."""
    grid_path = os.path.join(IMG_GRID, ref + ".webp")
    full_path = os.path.join(IMG_FULL, ref + ".webp")
    if os.path.exists(grid_path) and os.path.exists(full_path):
        with Image.open(grid_path) as im:
            return im.size
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        out = None
        for path, width, quality in ((full_path, FULL_W, FULL_Q), (grid_path, GRID_W, GRID_Q)):
            copy = im
            if im.width > width:
                copy = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
            copy.save(path, "WEBP", quality=quality, method=5)
            out = copy.size
        return out


def hacer_portada(ref):
    """Miniatura cuadrada para el selector de categorias, recortada por el centro."""
    destino = os.path.join(IMG_CAT, ref + ".webp")
    if os.path.exists(destino):
        return
    with Image.open(os.path.join(IMG_GRID, ref + ".webp")) as im:
        lado = min(im.width, im.height)
        izq = (im.width - lado) // 2
        arriba = (im.height - lado) // 3     # un tercio: la prenda suele estar arriba
        im = im.crop((izq, arriba, izq + lado, arriba + lado))
        im.resize((CAT_W, CAT_W), Image.LANCZOS).save(destino, "WEBP", quality=CAT_Q, method=5)


# --------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="procesar solo N productos (para pruebas)")
    args = ap.parse_args()

    for d in (CACHE, IMG_GRID, IMG_FULL, IMG_CAT):
        os.makedirs(d, exist_ok=True)

    with open(TREE, encoding="utf-8") as f:
        tree = json.load(f)

    products, desconocidas = collect_products(tree)
    print("Archivos en Drive: %d" % sum(1 for _ in _all_files(tree)))
    print("Productos tras agrupar tallas: %d" % len(products))
    if desconocidas:
        print("\n  AVISO: tallas no reconocidas (se publican igual, pero revisa el nombre")
        print("  de la carpeta en Drive o anade la talla a SIZE_ORDER en este script):")
        for talla in sorted(desconocidas, key=size_key):
            print("    '%s' en %s" % (talla, ", ".join(sorted(desconocidas[talla]))))
    if args.limit:
        products = products[:args.limit]
        print("(--limit) procesando %d" % len(products))

    print("\nDescargando desde Drive (%d en paralelo)..." % DOWNLOAD_WORKERS)
    with concurrent.futures.ThreadPoolExecutor(DOWNLOAD_WORKERS) as pool:
        paths = list(pool.map(
            lambda it: download(it[1], it[0], len(products)), enumerate(products, 1)))

    # Fusion por hash de contenido: la misma foto subida dos veces o repetida entre categorias.
    print("\nFusionando duplicados por contenido...")
    by_hash, merged = {}, 0
    for product, path in zip(products, paths):
        if not path:
            continue
        with open(path, "rb") as f:
            product["hash"] = hashlib.md5(f.read()).hexdigest()
        first = by_hash.get(product["hash"])
        if first is None:
            by_hash[product["hash"]] = product
            product["also_in"] = []
            # Todos los ids de Drive que acaban en este producto. La referencia se busca por
            # cualquiera de ellos: si manana los bytes no coinciden y el grupo se parte, cada
            # foto recupera la suya en vez de estrenar numero.
            product["ids"] = [product["drive"]]
        else:
            first["ids"].append(product["drive"])
            first["sizes"] |= product["sizes"]
            label = product["sub"] or product["cat"]
            if product["cat"] != first["cat"] and label not in first["also_in"]:
                first["also_in"].append(label)
            merged += 1
    unique = list(by_hash.values())
    print("  %d fusionados -> %d productos unicos" % (merged, len(unique)))

    refs, reservadas = load_refs()
    counters = {}
    for ref in list(refs.values()) + list(reservadas):
        prefix, _, num = ref.rpartition("-")
        if num.isdigit():
            counters[prefix] = max(counters.get(prefix, 0), int(num))

    print("\nCodificando WebP...")
    entries, nuevas = [], 0
    for i, product in enumerate(unique, 1):
        # De todas las referencias que ya tenga el grupo se queda la mas antigua (numero mas
        # bajo), que es la que lleva mas tiempo circulando. Las demas quedan reservadas.
        conocidas = sorted({refs[d] for d in product["ids"] if d in refs}, key=num_ref)
        if conocidas:
            ref = conocidas[0]
            reservadas.update(conocidas[1:])
        else:
            ref = make_ref(product["cat"], refs, reservadas, counters)
            nuevas += 1
        for d in product["ids"]:
            refs[d] = ref
        src = os.path.join(CACHE, product["drive"] + ".jpg")
        try:
            w, h = encode(src, ref)
        except Exception as e:
            print("  !! %s (%s): %s" % (ref, product["file"], e))
            continue
        entries.append({
            "ref": ref,
            "cat": product["cat"],
            "sub": product["sub"],
            "brand": product["brand"],
            # Se ordenan pero no se filtran: una talla rara se publica igual, ya se aviso arriba.
            "sizes": sorted(product["sizes"], key=size_key),
            "w": w, "h": h,
            "drive": product["drive"],
            "also_in": product["also_in"],
        })
        if i % 100 == 0:
            print("  %d/%d" % (i, len(unique)), flush=True)
    print("  %d referencias nuevas, %d reutilizadas" % (nuevas, len(entries) - nuevas))

    save_refs(refs, reservadas)

    categories = []
    for name in [c["name"] for c in tree["folders"]]:
        items = [e for e in entries if e["cat"] == name]
        if not items:
            continue
        sizes = sorted({s for e in items for s in e["sizes"]}, key=size_key)
        # El primer producto hace de portada. Miniatura propia y no la del grid: en el
        # selector se ven 18 a la vez y las del grid pesarian el triple.
        portada = items[0]["ref"]
        try:
            hacer_portada(portada)
        except Exception as e:
            print("  !! portada de %s: %s" % (name, e))
            portada = None
        categories.append({"name": name, "count": len(items),
                           "sizes": sizes, "thumb": portada})

    catalog = {
        # Informativos: dicen que genero este archivo. El sitio no los lee.
        "store": config.obligatorio("VITE_STORE"),
        "generated": datetime.date.today().isoformat(),
        "drive": "https://drive.google.com/drive/folders/" + config.obligatorio("VITE_DRIVE_FOLDER"),
        "categories": categories,
        "brands": sorted({e["brand"] for e in entries if e["brand"]}),
        "sizeOrder": SIZE_ORDER,
        "products": entries,
    }
    with open(os.path.join(SITE, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, separators=(",", ":"))

    # public/img lo genera este script: si una foto se borro de Drive, su .webp sobra.
    # Sin esta limpieza quedaria huerfano, verify.py fallaria y tumbaria la sincronizacion
    # automatica. Con --limit el catalogo esta recortado a proposito, asi que no se toca nada.
    if not args.limit:
        vivas = {e["ref"] for e in entries}
        portadas = {c["thumb"] for c in categories if c.get("thumb")}
        borradas = 0
        for carpeta, validas in ((IMG_GRID, vivas), (IMG_FULL, vivas), (IMG_CAT, portadas)):
            for nombre in os.listdir(carpeta):
                if nombre.endswith(".webp") and nombre[:-5] not in validas:
                    os.remove(os.path.join(carpeta, nombre))
                    borradas += 1
        if borradas:
            print("  %d imagenes huerfanas borradas (sus fotos ya no estan en Drive)" % borradas)

    print("\nListo: %d productos en %d categorias -> public/catalog.json"
          % (len(entries), len(categories)))


def _all_files(node):
    for f in node["files"]:
        yield f
    for c in node["folders"]:
        yield from _all_files(c)


if __name__ == "__main__":
    sys.exit(main())
