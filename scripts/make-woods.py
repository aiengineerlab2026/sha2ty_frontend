"""Tileable PBR maps for the default woods, boards and finishes: public/woods/<type>.jpg (base colour), <type>_normal.jpg
and <type>_roughness.jpg. Grain runs along the image's vertical (V) axis; the editor turns it along each part.
One tile is the row's tile_m in supabase/woods.sql: 0.6 m for solid woods and finishes, 1.22 m for sheet boards.

Everything is built from noise filtered in the frequency domain (periodic, so every map tiles exactly): growth rings
warped like flat-sawn boards, fine fibres stretched along the grain, pores (oak, ash, walnut) and rays (beech, oak).
Run: python scripts/make-woods.py   (numpy + Pillow)
"""

from pathlib import Path

import numpy as np
from PIL import Image

N = 1024
OUT = Path(__file__).resolve().parent.parent / "public" / "woods"

# early / late wood colour (sRGB), rings per tile (one tile = 0.6 m), ring contrast, warp, fibre, pores, rays,
# roughness variation, low-frequency board tone.
SPECIES = {
    "beech":    dict(early=(224, 186, 150), late=(198, 152, 114), rings=16, contrast=0.35, warp=0.22, fibre=0.16, pores=0.00, rays=0.55, tone=0.05),
    "pine":     dict(early=(236, 204, 146), late=(186, 124, 62),  rings=9,  contrast=0.95, warp=0.45, fibre=0.12, pores=0.00, rays=0.00, tone=0.06),
    "walnut":   dict(early=(118, 80, 56),   late=(64, 41, 29),    rings=14,  contrast=0.60, warp=0.55, fibre=0.18, pores=0.45, rays=0.00, tone=0.12),
    "oak":      dict(early=(204, 164, 112), late=(158, 116, 70),  rings=14, contrast=0.55, warp=0.35, fibre=0.16, pores=0.60, rays=0.35, tone=0.06),
    "teak":     dict(early=(186, 134, 78),  late=(138, 92, 48),   rings=14,  contrast=0.45, warp=0.35, fibre=0.16, pores=0.25, rays=0.00, tone=0.10),
    "ash":      dict(early=(228, 204, 166), late=(176, 142, 98),  rings=11,  contrast=0.70, warp=0.35, fibre=0.14, pores=0.50, rays=0.00, tone=0.05),
    "mahogany": dict(early=(164, 88, 58),   late=(118, 58, 38),   rings=18, contrast=0.40, warp=0.25, fibre=0.16, pores=0.30, rays=0.00, tone=0.08),
}
# Sawn-grain faces of boards and decors, same generator: plywood's rotary-cut birch face (1.22 m tile: more rings,
# wilder figure), blockboard's sliced face veneer, and laminate's printed oak decor (its relief is set low in the editor).
FACES = {
    "plywood":    dict(early=(228, 204, 166), late=(204, 172, 128), rings=22, contrast=0.28, warp=0.28, fibre=0.08, pores=0.00, rays=0.00, tone=0.04),
    "blockboard": dict(early=(214, 176, 128), late=(184, 140, 94),  rings=18, contrast=0.28, warp=0.22, fibre=0.08, pores=0.06, rays=0.00, tone=0.04),
    "laminate":   dict(early=(196, 158, 112), late=(150, 110, 70),  rings=14, contrast=0.50, warp=0.35, fibre=0.10, pores=0.20, rays=0.20, tone=0.04),
}
COPIES = {"veneer": "walnut"}  # walnut veneer: the walnut maps


def noise(rng, fu: float, fv: float, power: float = 1.0) -> np.ndarray:
    """Periodic noise in [-1, 1]: white noise kept where |freq_u| <~ fu and |freq_v| <~ fv (cycles per tile)."""
    white = rng.standard_normal((N, N))
    ky = np.fft.fftfreq(N)[:, None] * N  # rows = v
    kx = np.fft.fftfreq(N)[None, :] * N  # cols = u
    spectrum = np.fft.fft2(white) * np.exp(-((kx / fu) ** 2 + (ky / fv) ** 2) ** power)
    out = np.real(np.fft.ifft2(spectrum))
    return out / (np.abs(out).max() + 1e-9)


def make(name: str, p: dict, seed: int) -> None:
    rng = np.random.default_rng(seed)
    u = np.arange(N)[None, :] / N
    # Growth coordinate: rings across U, warped by smooth periodic noise (cathedrals, waves).
    warp = noise(rng, 2.5, 1.2) * p["warp"] + noise(rng, 7, 2.5) * p["warp"] * 0.3  # gentle cathedrals, not waves
    g = u * p["rings"] + warp
    t = g - np.floor(g)
    # Latewood: a sharp dark band at the end of each ring; earlywood fades into it.
    late = np.clip((t - 0.62) / 0.38, 0, 1) ** 1.6 + np.clip(1 - t / 0.06, 0, 1) * 0.6
    late = np.clip(late, 0, 1) * p["contrast"]
    fibre = noise(rng, 220, 6, 0.8) * 0.6 + noise(rng, 90, 3) * 0.4  # long thin fibres along V
    pores = np.clip(noise(rng, 260, 18) - 0.55, 0, 1) * 4 * p["pores"] * (0.4 + late)  # dashes, more in latewood
    rays = np.clip(noise(rng, 160, 40) - 0.62, 0, 1) * 5 * p["rays"]  # short flecks
    tone = noise(rng, 2, 1.5) * p["tone"]

    early, latec = np.array(p["early"], float) / 255, np.array(p["late"], float) / 255
    mix = np.clip(late + pores * 0.6 + rays * 0.35, 0, 1)[..., None]
    colour = early * (1 - mix) + latec * mix
    colour *= (1 + fibre[..., None] * p["fibre"] + tone[..., None])
    # Relief: pores and latewood sit lower; fibres give a faint ridge.
    height = -(late * 0.5 + pores * 1.0 + rays * 0.3) + fibre * 0.15
    # Roughness, relative (the material's roughness multiplies it): pores duller, latewood a little glossier.
    rough = 0.9 + pores * 0.1 - late * 0.08 + fibre * 0.03
    save(name, colour, height, rough)


def save(name: str, colour: np.ndarray, height: np.ndarray, rough: np.ndarray) -> None:
    """Base colour (sRGB), tangent-space normal map (OpenGL, +Y up) from the height, relative roughness (G)."""
    Image.fromarray((np.clip(colour, 0, 1) * 255).astype(np.uint8)).save(OUT / f"{name}.jpg", quality=90)
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 2.0
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 2.0
    normal = np.dstack([-dx, dy, np.ones_like(height)])
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    Image.fromarray(((normal * 0.5 + 0.5) * 255).astype(np.uint8)).save(OUT / f"{name}_normal.jpg", quality=92)

    grey = (np.clip(rough, 0.6, 1.0) * 255).astype(np.uint8)
    Image.fromarray(np.dstack([grey, grey, grey])).save(OUT / f"{name}_roughness.jpg", quality=90)  # glTF reads G


def fibreboard(name: str, base: tuple, speck: float, seed: int) -> None:
    """Pressed sheet with no grain: MDF, HDF, and the sanded face of particleboard. Even colour, almost no relief."""
    rng = np.random.default_rng(seed)
    mottle = noise(rng, 40, 40) * 0.5 + noise(rng, 6, 6) * 0.5
    fibres = np.clip(noise(rng, 300, 300) - 0.5, 0, 1) * speck  # faint specks, no direction and no dark pits
    colour = np.array(base, float) / 255 * (1 + mottle[..., None] * 0.02 - fibres[..., None] * 0.06)
    save(name, colour, mottle * 0.02 - fibres * 0.04, 0.97 + fibres * 0.02 - mottle * 0.01)


def chipboard(name: str, seed: int, cells: int = 140) -> None:
    """Raw particleboard edge: pressed flakes a few millimetres long (one tile is 4 cm), overlapping, no cracks."""
    rng = np.random.default_rng(seed)
    acc = np.zeros((N, N, 3))
    wgt = np.zeros((N, N))
    yy, xx = np.indices((N, N))
    tones = np.array([(214, 186, 142), (186, 150, 98), (168, 124, 76), (204, 168, 116), (148, 108, 70)], float) / 255
    # 1 px ≈ 0.039 mm, so a 5 mm flake is about 130 px.
    for start in range(0, cells, 4):
        n = min(4, cells - start)
        cx, cy = rng.random(n) * N, rng.random(n) * N
        ang = rng.random(n) * np.pi
        length, width = rng.uniform(90, 190, n), rng.uniform(34, 78, n)
        tone = tones[rng.integers(0, len(tones), n)] * rng.uniform(0.92, 1.06, (n, 1))
        dx = (xx[None] - cx[:, None, None] + N / 2) % N - N / 2
        dy = (yy[None] - cy[:, None, None] + N / 2) % N - N / 2
        ca, sa = np.cos(ang)[:, None, None], np.sin(ang)[:, None, None]
        lx, ly = dx * ca + dy * sa, -dx * sa + dy * ca
        fall = np.clip(1 - (lx / length[:, None, None]) ** 2 - (ly / width[:, None, None]) ** 2, 0, 1) ** 1.3
        acc += (fall[..., None] * tone[:, None, None, :]).sum(axis=0)
        wgt += fall.sum(axis=0)
    covered = wgt > 0.02
    colour = acc / np.maximum(wgt, 1e-3)[..., None]
    colour[~covered] = colour[covered].mean(axis=0)
    fibre = noise(rng, 160, 160) * 0.035
    colour *= 1 + fibre[..., None]
    save(name, colour, (wgt / (wgt.max() + 1e-9)) * 0.25 + fibre, 0.9 + fibre)


def smooth(name: str, base: tuple, seed: int) -> None:
    """Melamine: a pressed decor surface, one colour with a faint orange-peel texture; even, low relief."""
    rng = np.random.default_rng(seed)
    peel = noise(rng, 120, 120)
    colour = np.array(base, float) / 255 * (1 + peel[..., None] * 0.012)
    save(name, colour, peel * 0.05, 0.97 + peel * 0.03)


def blockboard_edge(seed: int) -> None:
    """Cut edge of blockboard. One tile is 88 mm across (four 22 mm strips). V runs through the thickness:
    a face-veneer band on each side, softwood strips and a glue line between them in the middle."""
    rng = np.random.default_rng(seed)
    u = np.arange(N)[None, :] / N
    v = np.arange(N)[:, None] / N
    strips = 4
    across = (u * strips) % 1
    joint = np.clip(1 - np.minimum(across, 1 - across) / 0.035, 0, 1)
    which = np.minimum((u * strips).astype(int), strips - 1)
    tones = np.array([0.94, 1.0, 0.88, 0.97])
    grain = noise(rng, 4, 48) * 0.05
    core = np.array((206, 170, 122), float) / 255 * tones[which][..., None]
    veneer = np.array((184, 142, 96), float) / 255
    band = ((v < 0.12) | (v > 0.88)).astype(float)[..., None]
    colour = core * (1 + grain[..., None] - joint[..., None] * 0.28)
    colour = colour * (1 - band) + veneer * (1 + grain[..., None] * 0.4) * band
    save("blockboard_edge", colour, grain * 0.15 - joint * 0.4, 0.88 + joint * 0.08)


def plywood_edge(seed: int) -> None:
    """Cut edge of plywood: nine alternating plies fill the thickness (V), with a thin glue line on each boundary."""
    rng = np.random.default_rng(seed)
    v = np.arange(N)[:, None] / N
    plies = 9
    across = (v * plies) % 1
    glue = np.clip(1 - np.minimum(across, 1 - across) / 0.07, 0, 1)
    odd = (np.floor(v * plies).astype(int) % 2).astype(float)[..., None]
    light = np.array((214, 186, 146), float) / 255
    dark = np.array((162, 118, 78), float) / 255
    fibre = noise(rng, 3, 70) * 0.05  # grain running along the edge
    colour = (light * (1 - odd) + dark * odd) * (1 + fibre[..., None] - glue[..., None] * 0.2)
    save("plywood_edge", colour, fibre * 0.12 - glue * 0.3, 0.86 + glue * 0.08)


def lacquer_swatch() -> None:
    """Clear lacquer has no image of its own (the board's grain shows through, glossier): its card shows beech
    under a soft highlight. Only the card uses it."""
    beech = np.asarray(Image.open(OUT / "beech.jpg"), float) / 255
    y = np.linspace(0, 1, N)[:, None, None]
    sheen = np.exp(-((y - 0.3) ** 2) / 0.02) * 0.35
    Image.fromarray((np.clip(beech * 0.92 + sheen, 0, 1) * 255).astype(np.uint8)).save(OUT / "lacquer.jpg", quality=90)


if __name__ == "__main__":
    for i, (name, params) in enumerate({**SPECIES, **FACES}.items()):
        make(name, params, seed=100 + i)
    fibreboard("mdf", (196, 168, 132), 0.12, seed=201)
    fibreboard("hdf", (132, 96, 68), 0.08, seed=202)
    fibreboard("particleboard", (210, 186, 150), 0.05, seed=205)  # the pressed face; chips are only the cut edge
    chipboard("particleboard_edge", seed=203, cells=180)
    blockboard_edge(seed=206)
    plywood_edge(seed=207)
    smooth("melamine", (238, 236, 230), seed=204)
    lacquer_swatch()
    for copy, source in COPIES.items():
        for suffix in ("", "_normal", "_roughness"):
            (OUT / f"{copy}{suffix}.jpg").write_bytes((OUT / f"{source}{suffix}.jpg").read_bytes())
    print("woods:", ", ".join([*SPECIES, *FACES, "mdf", "hdf", "particleboard", "particleboard_edge", "blockboard_edge", "plywood_edge", "melamine", "lacquer", *COPIES]))
