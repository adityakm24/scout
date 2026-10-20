"""The browser sandbox's root filesystem: Debian's Chromium with full fonts, unprivileged.

Debian ``trixie-slim`` (pinned digest) plus, from a pinned snapshot of the Debian archive, Chromium and
fonts for every script (Latin, CJK, emoji). Chromium runs headless; the browser frame (tabs, address
bar) is drawn by the Scout app from DevTools, so no display server is needed in the sandbox. ``docker/browser-sandbox/Dockerfile`` describes the same image for
a CI build; this module builds it locally without Docker: dependencies are resolved against the base
image's installed packages, every download is checked against the archive's SHA-256, and the result
is cached under the Scout home as a rootfs tar for ``openshell sandbox create --from``. How Chromium
starts lives in ``sandboxes._BROWSER_COMMAND``, not in the image.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import lzma
import re
import tarfile
import tempfile
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

BASE_REPOSITORY = "library/debian"
BASE_INDEX_DIGEST = "sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f"  # trixie-slim
SNAPSHOT = "20261001T000000Z"
_ARCHIVES = (("debian-security", "trixie-security"), ("debian", "trixie"))  # first wins: security updates
PACKAGES = ("chromium", "procps", "fonts-noto-core", "fonts-noto-cjk", "fonts-noto-color-emoji",
            "fonts-dejavu-core")
IMAGE_VERSION = "5"  # bump when PACKAGES change

_REGISTRY = "https://registry-1.docker.io/v2"
_INDEX_TYPES = "application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json"
_MERGED_USR = ("bin/", "sbin/", "lib/")

# -- base image -------------------------------------------------------------

def _arch() -> str:
    from scout_platform.host.facts import native_arch
    return {"arm64": "arm64", "x86_64": "amd64", "amd64": "amd64"}.get(native_arch(), native_arch())


def _registry_get(path: str, token: str, accept: str):
    req = urllib.request.Request(f"{_REGISTRY}/{BASE_REPOSITORY}/{path}",
                                 headers={"Authorization": f"Bearer {token}", "Accept": accept})
    return urllib.request.urlopen(req, timeout=120)


def _download(url: str, digest_hex: str, into: Path, *, open_fn=None) -> Path:
    path = into / digest_hex
    sha = hashlib.sha256()
    with (open_fn() if open_fn else urllib.request.urlopen(url, timeout=300)) as resp, path.open("wb") as out:
        while chunk := resp.read(1 << 20):
            sha.update(chunk)
            out.write(chunk)
    if sha.hexdigest() != digest_hex:
        raise RuntimeError(f"{url} failed its SHA-256 check")
    return path


def _base_layers(into: Path) -> List[Path]:
    url = f"https://auth.docker.io/token?service=registry.docker.io&scope=repository:{BASE_REPOSITORY}:pull"
    with urllib.request.urlopen(url, timeout=30) as resp:
        token = json.load(resp)["token"]
    with _registry_get(f"manifests/{BASE_INDEX_DIGEST}", token, _INDEX_TYPES) as resp:
        index = json.load(resp)
    entry = next(m for m in index["manifests"] if m.get("platform", {}).get("os") == "linux"
                 and m["platform"].get("architecture") == _arch())
    with _registry_get(f"manifests/{entry['digest']}", token, entry["mediaType"]) as resp:
        layers = json.load(resp)["layers"]
    return [_download(layer["digest"], layer["digest"][7:], into,
                      open_fn=lambda d=layer["digest"]: _registry_get(f"blobs/{d}", token, "*/*"))
            for layer in layers]


# -- Debian packages --------------------------------------------------------

def _parse_packages(text: str) -> Dict[str, Dict[str, str]]:
    out: Dict[str, Dict[str, str]] = {}
    for block in text.split("\n\n"):
        fields: Dict[str, str] = {}
        key = None
        for line in block.splitlines():
            if line.startswith((" ", "\t")) and key:
                fields[key] += "\n" + line
            elif ": " in line:
                key, _, value = line.partition(": ")
                fields[key] = value
        if "Package" in fields:
            out.setdefault(fields["Package"], fields)
    return out


def _archive_index() -> Tuple[Dict[str, Dict[str, str]], Dict[str, List[str]]]:
    """Package name -> fields (security archive first), and virtual name -> providers."""
    packages: Dict[str, Dict[str, str]] = {}
    for repo, dist in _ARCHIVES:
        url = f"https://snapshot.debian.org/archive/{repo}/{SNAPSHOT}/dists/{dist}/main/binary-{_arch()}/Packages.xz"
        with urllib.request.urlopen(url, timeout=300) as resp:
            for name, fields in _parse_packages(lzma.decompress(resp.read()).decode()).items():
                fields["_repo"] = repo
                packages.setdefault(name, fields)
    provides: Dict[str, List[str]] = {}
    for name, fields in packages.items():
        for virtual in _names(fields.get("Provides", "")):
            provides.setdefault(virtual, []).append(name)
    return packages, provides


def _names(field: str) -> List[str]:
    return [re.split(r"[\s:(]", alt.strip(), maxsplit=1)[0] for alt in re.split(r"[,|]", field) if alt.strip()]


def _alternatives(field: str) -> List[List[str]]:
    return [[re.split(r"[\s:(]", alt.strip(), maxsplit=1)[0] for alt in group.split("|") if alt.strip()]
            for group in field.split(",") if group.strip()]


def _installed(status: str) -> Set[str]:
    have: Set[str] = set()
    for name, fields in _parse_packages(status).items():
        if fields.get("Status", "").endswith("installed"):
            have.add(name)
            have.update(_names(fields.get("Provides", "")))
    return have


def resolve(roots: Iterable[str], packages: Dict[str, Dict[str, str]], provides: Dict[str, List[str]],
            installed: Set[str]) -> List[str]:
    """The packages to add (Depends + Pre-Depends closure; first available alternative)."""
    chosen: List[str] = []
    seen: Set[str] = set(installed)
    queue = list(roots)
    while queue:
        name = queue.pop()
        if name in seen:
            continue
        seen.add(name)
        if name not in packages:
            continue  # satisfied by a virtual name already present, checked below
        chosen.append(name)
        fields = packages[name]
        for group in _alternatives(fields.get("Pre-Depends", "") + "," + fields.get("Depends", "")):
            if any(alt in seen for alt in group):
                continue
            pick = next((alt for alt in group if alt in packages), None)
            if pick is None:
                pick = next((p for alt in group for p in provides.get(alt, []) if p in packages), None)
            if pick is None:
                raise RuntimeError(f"cannot satisfy {' | '.join(group)} for {name}")
            queue.append(pick)
    return chosen


def _deb_data(path: Path) -> tarfile.TarFile:
    """The ``data.tar.*`` member of a .deb (an ar archive)."""
    raw = path.read_bytes()
    if not raw.startswith(b"!<arch>\n"):
        raise RuntimeError(f"{path.name} is not a .deb")
    pos = 8
    while pos < len(raw):
        name = raw[pos:pos + 16].decode().strip().rstrip("/")
        size = int(raw[pos + 48:pos + 58].decode().strip())
        body = raw[pos + 60:pos + 60 + size]
        if name.startswith("data.tar"):
            if name.endswith(".zst"):
                from compression import zstd
                body = zstd.decompress(body)
                return tarfile.open(fileobj=io.BytesIO(body), mode="r:")
            return tarfile.open(fileobj=io.BytesIO(body), mode="r:*")
        pos += 60 + size + (size & 1)
    raise RuntimeError(f"{path.name} has no data member")


# -- assembly ---------------------------------------------------------------

def _norm(name: str) -> str:
    return name.lstrip("./").rstrip("/")


def _flatten_layers(layer_files: List[Path]) -> Dict[str, Tuple[int, tarfile.TarInfo]]:
    """Path -> (layer index, member) after applying OCI whiteouts in order."""
    owner: Dict[str, Tuple[int, tarfile.TarInfo]] = {}
    for i, path in enumerate(layer_files):
        with tarfile.open(path, "r:*") as layer:
            for member in layer:
                name = _norm(member.name)
                parent, _, base = name.rpartition("/")
                if base == ".wh..wh..opq":
                    prefix = f"{parent}/" if parent else ""
                    for key in [k for k in owner if k.startswith(prefix)]:
                        del owner[key]
                elif base.startswith(".wh."):
                    gone = f"{parent}/{base[4:]}" if parent else base[4:]
                    for key in [k for k in owner if k == gone or k.startswith(gone + "/")]:
                        del owner[key]
                elif name:
                    owner[name] = (i, member)
    return owner


def build(out: Path, work: Path) -> None:
    layers = _base_layers(work)
    owner = _flatten_layers(layers)
    status = b""
    with tarfile.open(out, "w") as dst:
        for i, path in enumerate(layers):
            with tarfile.open(path, "r:*") as layer:
                for member in layer:
                    name = _norm(member.name)
                    if owner.get(name, (None,))[0] != i:
                        continue
                    member.name = name
                    data = layer.extractfile(member) if member.isfile() else None
                    if name == "var/lib/dpkg/status" and data is not None:
                        status = data.read()
                        data = io.BytesIO(status)
                    dst.addfile(member, data)
        merged = {d for d in ("bin", "sbin", "lib") if d in owner and owner[d][1].issym()}
        packages, provides = _archive_index()
        wanted = resolve(PACKAGES, packages, provides, _installed(status.decode()))
        logger.info("browser image: adding %d Debian packages", len(wanted))
        written: Set[str] = set(owner)
        for name in sorted(wanted):
            fields = packages[name]
            url = f"https://snapshot.debian.org/archive/{fields['_repo']}/{SNAPSHOT}/{fields['Filename']}"
            deb = _download(url, fields["SHA256"], work)
            with _deb_data(deb) as data:
                for member in data:
                    path = _norm(member.name)
                    if not path:
                        continue
                    top = path.split("/", 1)[0]
                    if top in merged:  # merged-/usr: /bin, /sbin, /lib are symlinks into /usr
                        path = "usr/" + path
                    if member.isdir() and path in written:
                        continue
                    member.name = path
                    if member.islnk() and member.linkname.split("/", 1)[0].lstrip("./") in merged:
                        member.linkname = "usr/" + _norm(member.linkname)
                    dst.addfile(member, data.extractfile(member) if member.isfile() else None)
                    written.add(path)
            deb.unlink()


def rootfs() -> Path:
    """The browser rootfs tar for this host's architecture, building it the first time."""
    from scout_constants import get_scout_home

    cache = get_scout_home() / "openshell" / f"browser-desktop-{IMAGE_VERSION}-{SNAPSHOT}-{_arch()}.tar"
    if cache.is_file():
        return cache
    cache.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache.parent) as tmp:
        partial = cache.with_suffix(".partial")
        build(partial, Path(tmp))
        partial.rename(cache)
    return cache


def wanted_packages() -> Optional[List[str]]:
    """The package set a build would add (for inspection; downloads only the indexes)."""
    packages, provides = _archive_index()
    return resolve(PACKAGES, packages, provides, set())
