#!/usr/bin/env python3
"""
Descarga el AIP Chile (DGAC) ENR 5.1 (zonas P, R, D) y genera data/espacio-aereo.js.

Uso:  python tools/update_airspace.py [--pdf archivo.pdf] [--out data/espacio-aereo.js]
Requiere:  pip install pymupdf

El AIP se publica solo como PDF, sin datos estructurados. El script lee las tablas del PDF
por columnas (identificación y límites laterales | límites verticales | observaciones) y
convierte las coordenadas a polígonos. Lo que no se puede interpretar con seguridad (p. ej.
arcos centrados en un VOR/DME) se publica con geometría nula: la aplicación lo lista y remite
al AIP. Nunca se inventa una geometría. Si el formato cambia tanto que se interpretan muy
pocas zonas, el script falla sin tocar los datos existentes.
"""
import argparse, hashlib, json, math, re, sys, urllib.parse, urllib.request
from pathlib import Path

import pymupdf

BASE = ("https://aipchile.dgac.gob.cl/dasa/aip_chile_con_contenido/ais/2%20ENR%20Parte%202/"
        "ENR%205%20Zonas%20Prohibidas,%20Restringidas%20y%20Peligrosas/")
FUENTES = {
    "enr51": BASE + "ENR%205.1-1%20Zonas%20P,%20R,%20D.pdf",
    "enr52": BASE + "ENR%205.2-1%20Zonas%20de%20Maniobras%20e%20instrucciones.pdf",
    "enr54": BASE + "ENR%205.4-1%20Obstaculos.pdf",
    "enr55": BASE + "ENR%205.5-1%20Actividades%20deportivas,%20de%20recreo%20e%20indole%20peligrosa.pdf",
}
UA = {"User-Agent": "VFR-Chile-updater/1.0"}

IDENT = re.compile(r"^SC\s?-\s?([DPR])\s?(\d+[A-Z]?)$")
NUM = r"\d+(?:[.,]\d+)?"
# 53 46 00 S 70 31 00 W  (también 73 33 33,31 W)
COORD_A = re.compile(rf"(\d{{1,2}})\s+(\d{{2}})\s+({NUM})\s*([NS])\s*[/,;\-–—]?\s*(\d{{1,3}})\s+(\d{{2}})\s+({NUM})\s*([EW])")
# 334403.74S/0704141.16W   185710S 700000W
COORD_B = re.compile(rf"(\d{{6}}(?:[.,]\d+)?)\s*([NS])\s*[/ ]?\s*(\d{{6,7}}(?:[.,]\d+)?)\s*([EW])")
CIRCLE = re.compile(rf"(?:C[ií]rculo\s+(?:de\s+|con\s+)?(?:radio\s+)?|Radio\s+(?:centrado\s+en:?\s*)?)({NUM})\s*(NM|KM|M)\b", re.I)
LIMIT = re.compile(r"\b(UNL|GND|SFC|FL\s?\d+|(?:\d{1,3}(?:[. ]\d{3})+|\d+)\s?FT(?:\s?(?:AGL|AMSL|ALT|MSL))?)\b", re.I)
START = re.compile(r"^\s*(?:SC\s*-\s*([DPR])\s*(\d+[A-Z]?)\s+FIR\b(.*)|ZONA\s+(PELIGROSA|PROHIBIDA|RESTRINGIDA)\s*-\s*FIR\b(.*))$", re.I)
FIRS = "PUNTA ARENAS|PUERTO MONTT|SANTIAGO|ANTOFAGASTA"


def num(s):
    return float(str(s).replace(",", "."))


def dms(d, m, s, hemi):
    v = num(d) + num(m) / 60 + num(s) / 3600
    return -v if hemi in "SW" else v


def compact(txt, hemi):
    """DDMMSS(.ss) o DDDMMSS(.ss) -> grados decimales"""
    ip, _, fp = txt.replace(",", ".").partition(".")
    return dms(int(ip[:-4]), int(ip[-4:-2]), float(ip[-2:] + ("." + fp if fp else "")), hemi)


def coords(txt):
    """Coordenadas del texto en orden de aparición: [(posición, lat, lon)]"""
    out = []
    for m in COORD_A.finditer(txt):
        out.append((m.start(), m.end(), dms(*m.group(1, 2, 3), m.group(4)), dms(*m.group(5, 6, 7), m.group(8))))
    for m in COORD_B.finditer(txt):
        if any(a <= m.start() < e for a, e, _, _ in out):
            continue
        out.append((m.start(), m.end(), compact(m.group(1), m.group(2)), compact(m.group(3), m.group(4))))
    out.sort()
    return [(p, la, lo) for p, _, la, lo in out]


def circle_poly(la, lo, r_nm, n=48):
    pts = [[round(la + r_nm / 60 * math.cos(2 * math.pi * i / n), 5),
            round(lo + r_nm / 60 * math.sin(2 * math.pi * i / n) / math.cos(math.radians(la)), 5)] for i in range(n)]
    pts.append(pts[0])
    return pts


def en_chile(la, lo):
    return -57 < la < -17 and -110 < lo < -66


def to_ft(tok):
    t = re.sub(r"[\s.]+", "", tok).upper()
    if t in ("GND", "SFC"):
        return 0, False
    if t == "UNL":
        return 99999, False
    if t.startswith("FL"):
        return (int(t[2:]) * 100, False) if 0 < int(t[2:]) <= 660 else (None, False)
    m = re.match(r"(\d+)FT(AGL|AMSL|ALT|MSL)?", t)
    return (int(m.group(1)), m.group(2) == "AGL") if m else (None, False)


def lines_of(words):
    """Reconstruye líneas de texto (orden y, x) a partir de palabras de PyMuPDF."""
    rows = []
    for w in sorted(words, key=lambda w: (round((w[1] + w[3]) / 2), w[0])):
        yc = (w[1] + w[3]) / 2
        if rows and abs(rows[-1][0] - yc) < 4:
            rows[-1][1].append(w)
        else:
            rows.append([yc, [w]])
    return [" ".join(x[4] for x in sorted(r[1], key=lambda w: w[0])) for r in rows]


def read_rows(doc):
    """Devuelve [{kind, num, head, left, mid, right}] leyendo las tablas por columnas."""
    zones, cur, anon = [], None, 0
    for page in doc:
        words = page.get_text("words")
        obs = [w for w in words if w[4] == "Observaciones"]
        if not obs:
            cur = cur if zones and any(w[4] == "Remarks" for w in words) else None
            continue
        lim = [w for w in words if w[4] in ("Límite", "Limite")]
        rem = [w for w in words if w[4] == "Remarks"]
        top = max(w[3] for w in rem) if rem else max(w[3] for w in obs)
        x_mid = min([w[0] for w in lim] or [300]) - 20
        x_rem = obs[0][0] - 8
        body = [w for w in words if w[1] > top + 2 and w[3] < page.rect.height - 45
                and not (w[4] in ("1", "2", "3") and w[1] < top + 30)]
        left = [(y, t) for y, t in lines_xy([w for w in body if w[0] < x_mid])]
        starts = [(y, m) for y, t in left if (m := START.match(t))]
        marks = [y - 8 for y, _ in starts]
        edges = [top] + marks + [1e9]
        for i in range(len(edges) - 1):
            seg = [w for w in body if edges[i] <= w[1] < edges[i + 1]]
            if i == 0:
                if cur is None:
                    continue
            else:
                m = starts[i - 1][1]
                if m.group(1):
                    cur = {"kind": m.group(1).upper(), "num": m.group(2), "head": m.group(3)}
                else:
                    anon += 1
                    cur = {"kind": {"PEL": "D", "PRO": "P", "RES": "R"}[m.group(4)[:3].upper()],
                           "num": f"?{anon}", "head": m.group(5)}
                cur.update(left=[], mid=[], right=[])
                zones.append(cur)
            cur["left"] += [t for _, t in lines_xy([w for w in seg if w[0] < x_mid])]
            cur["mid"] += [t for _, t in lines_xy([w for w in seg if x_mid <= w[0] < x_rem])]
            cur["right"] += [t for _, t in lines_xy([w for w in seg if w[0] >= x_rem])]
    return zones


def lines_xy(words):
    rows = []
    for w in sorted(words, key=lambda w: (round((w[1] + w[3]) / 2), w[0])):
        yc = (w[1] + w[3]) / 2
        if rows and abs(rows[-1][0] - yc) < 4:
            rows[-1][1].append(w)
        else:
            rows.append([yc, [w]])
    out = []
    for y, ws in rows:
        t = re.sub(r"[-• ]", " ", " ".join(x[4] for x in sorted(ws, key=lambda w: w[0])))
        out.append((y, re.sub(r"\s+", " ", t).strip()))
    return [(y, t) for y, t in out if t]


def build_zone(r):
    left = [l for l in r["left"] if not START.match(l) and not re.search(r"AMDT|AIP-CHILE|AIS\s?-?\s?CHILE|VOLUM", l)]
    head = r["head"].strip()
    fm = re.match(rf"\s*({FIRS})\b\s*[-–]?\s*(.*)", head, re.I)
    fir, rest = (fm.group(1).upper(), fm.group(2).strip()) if fm else ("", head)
    zid = f"SC-{r['kind']}{r['num']}" if not r["num"].startswith("?") else f"SC-{r['kind']}*"
    z = {"id": zid, "k": r["kind"], "fir": fir, "n": "", "g": None}
    if r["num"].startswith("?"):
        z["id"] = f"SC-{r['kind']}* {fir.title()} {r['num'][1:]}"
        z["sinid"] = True
    txt = " ".join(left)
    nm = [rest] if rest else []
    for l in left[:3]:
        if re.search(r"Espacio|Airspace|C[ií]rculo|Cuadril|Dentro|Siguientes|Radio|[ÁA]rea\s+(?:de|delim)|\d{4,}|\d{1,3}\s+\d{2}\s+\d{2}|DANGEROUS|PROHIBITED|RESTRICTED", l, re.I):
            break
        nm.append(l.strip())
    z["n"] = " · ".join(x for x in nm if x)[:110]

    cs = coords(txt)
    circ = CIRCLE.search(txt)
    arc = re.search(r"\barco\b", txt, re.I)
    if circ and not arc:
        radius = num(circ.group(1)) * {"NM": 1, "KM": 0.539957, "M": 0.000539957}[circ.group(2).upper()]
        cen = next(((la, lo) for p, la, lo in cs if p > circ.start()), None)
        if cen and en_chile(*cen):
            z["g"] = [circle_poly(cen[0], cen[1], radius)]
            z["c"] = [round(cen[0], 5), round(cen[1], 5), round(radius, 3)]
    elif cs and not arc and len(cs) >= 3 and all(en_chile(la, lo) for _, la, lo in cs):
        ring = [[round(la, 5), round(lo, 5)] for _, la, lo in cs]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        z["g"] = [ring]

    mid = " ".join(r["mid"])
    toks = [re.sub(r"\s+", " ", m.group(1)).strip().upper() for m in LIMIT.finditer(mid)]
    toks = [t for t in toks if to_ft(t)[0] is not None]
    if toks:
        z["lim"] = toks
        vals = [to_ft(t) for t in toks]
        z["lo"], z["hi"] = min(v[0] for v in vals), max(v[0] for v in vals)
        if any(v[1] for v in vals):
            z["agl"] = True
        if len(toks) > 2:
            z["multi"] = True
    z["obs"] = re.sub(r"\s+", " ", " ".join(r["right"])).strip()[:400]
    z["raw"] = re.sub(r"\s+", " ", txt).strip()[:500] if z["g"] is None else ""
    return z


def parse_enr51(doc):
    zones, seen = [], set()
    for r in read_rows(doc):
        z = build_zone(r)
        if z["id"] not in seen:
            seen.add(z["id"])
            zones.append(z)
    return zones


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        return r.read()


def doc_text(doc):
    return "\n".join(p.get_text() for p in doc)


MES = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}


def fecha_aip(text):
    best = None
    for d, m, y in re.findall(r"\b(\d{2}) (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) (\d{4})\b", text):
        t = (int(y), MES[m], int(d))
        best = max(best, t) if best else t
    amdt = max([int(x) for x in re.findall(r"AMDT NR\s+(\d+)", text)] or [0])
    return (f"{best[0]}-{best[1]:02d}-{best[2]:02d}" if best else ""), amdt


SITE = "https://aipchile.dgac.gob.cl"


def cargar_previo(out):
    try:
        t = out.read_text(encoding="utf-8")
        return json.loads(t[t.index("=") + 1:].rstrip().rstrip(";"))
    except Exception:
        return {}


def scrape_cartas():
    """Índices HTML del AIP (ENR y AD): enlaces a cartas VAC, rutas visuales y cartas de ruta."""
    def pdfs(seccion):
        html = fetch(f"{SITE}/aip/vol1/seccion/{seccion}").decode("utf-8", "replace")
        return [h.replace("&amp;", "&") for h in re.findall(r'href="([^"]+\.pdf)"', html)]

    def url(path):
        return SITE + urllib.parse.quote(path, safe="/(),-_.~")

    def nombre(path):
        n = Path(path).stem
        return re.sub(r"^[a-z](?=ENR)", "", n).strip()

    vac = {}
    for p in pdfs("ad"):
        m = re.search(r"/AD 3 VAC/.*?VAC\s+([A-Z0-9]{4})\b", p)
        if m:
            vac[m.group(1)] = url(p)
    enr = pdfs("enr")
    rutas = [{"n": nombre(p), "u": url(p)} for p in enr if "/ENR 7 Rutas Visuales/" in p]
    otros = [{"n": nombre(p), "u": url(p)} for p in enr
             if re.search(r"/ENR 6 |ENR 5\.5-1|ENR 2\.1-9|ENR 2\.2-1", p)]
    if len(vac) < 10:
        raise RuntimeError(f"solo {len(vac)} cartas VAC encontradas: el sitio pudo cambiar")
    return {"vac": dict(sorted(vac.items())), "rutas": rutas, "enr": otros}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", help="usa este PDF local para ENR 5.1 en vez de descargarlo")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "data" / "espacio-aereo.js"))
    ap.add_argument("--debug", action="store_true")
    a = ap.parse_args()

    raw = Path(a.pdf).read_bytes() if a.pdf else fetch(FUENTES["enr51"])
    doc = pymupdf.open(stream=raw, filetype="pdf")
    zonas = parse_enr51(doc)
    if len(zonas) < 40 or sum(1 for z in zonas if z["g"]) < 25:
        sys.exit(f"Solo se interpretaron {len(zonas)} zonas ({sum(1 for z in zonas if z['g'])} con geometría): "
                 "el formato del AIP pudo cambiar. No se actualiza nada.")
    fecha, amdt = fecha_aip(doc_text(doc))

    out = Path(a.out)
    previo = cargar_previo(out)

    otras = {}
    for k in ("enr52", "enr54", "enr55"):
        try:
            t = doc_text(pymupdf.open(stream=fetch(FUENTES[k]), filetype="pdf"))
            otras[k] = {"vacio": bool(re.search(r"NO APLICABLE|NOT APPLICABLE", t)), "fecha": fecha_aip(t)[0], "url": FUENTES[k]}
        except Exception as e:  # sin red o archivo movido: se conserva lo anterior, no es fatal
            print(f"Aviso: no se pudo leer {k}: {e}", file=sys.stderr)
            otras[k] = previo.get("otras", {}).get(k, {"url": FUENTES[k]})

    try:
        cartas = scrape_cartas()
    except Exception as e:
        print(f"Aviso: no se pudo leer el índice de cartas: {e}", file=sys.stderr)
        cartas = previo.get("cartas", {"vac": {}, "rutas": [], "enr": []})

    contenido = {"fecha": fecha, "amdt": amdt, "fuente": FUENTES["enr51"], "otras": otras, "cartas": cartas, "zonas": zonas}
    contenido["hash"] = hashlib.sha256(json.dumps(contenido, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]
    js = ("/* AIP Chile ENR 5.1 (DGAC) interpretado por tools/update_airspace.py. No editar a mano. */\n"
          "window.ESPACIO_AEREO=" + json.dumps(contenido, ensure_ascii=False, separators=(",", ":")) + ";\n")
    if out.exists() and out.read_text(encoding="utf-8") == js:
        print("Sin cambios.")
        return
    out.write_text(js, encoding="utf-8")
    sg = [z["id"] for z in zonas if z["g"] is None]
    print(f"{len(zonas)} zonas · AIP {fecha} AMDT {amdt} · hash {contenido['hash']}")
    print(f"Sin geometría ({len(sg)}): {', '.join(sg)}")
    if a.debug:
        for z in zonas:
            g = z["g"]
            print(z["id"], "|", z["fir"], "|", z["n"], "|", z.get("lim"), "multi" if z.get("multi") else "", "pts=%d" % (len(g[0]) - 1) if g else "NOGEOM", "|", z["obs"][:50])


if __name__ == "__main__":
    main()
