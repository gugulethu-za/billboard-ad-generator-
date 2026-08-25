import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

def analyze(image_path):
    pixels = subprocess.run([
        "ffmpeg", "-loglevel", "error", "-i", str(image_path),
        "-vf", "scale=96:96", "-f", "rawvideo", "-pix_fmt", "rgba", "-",
    ], check=True, capture_output=True).stdout
    buckets = defaultdict(lambda: {"count": 0, "r": 0, "g": 0, "b": 0, "saturation": 0.0, "light": 0.0})
    accepted = 0
    for offset in range(0, len(pixels), 4):
        r, g, b, a = pixels[offset:offset + 4]
        if a < 128:
            continue
        high, low = max(r, g, b), min(r, g, b)
        delta = high - low
        light = (high + low) / 510
        saturation = 0 if delta == 0 else delta / (255 - abs(high + low - 255))
        if saturation < 0.22 or light < 0.08 or light > 0.92:
            continue
        accepted += 1
        key = tuple(min(224, round(value / 32) * 32) for value in (r, g, b))
        bucket = buckets[key]
        bucket["count"] += 1
        bucket["r"] += r
        bucket["g"] += g
        bucket["b"] += b
        bucket["saturation"] += saturation
        bucket["light"] += light

    ranked = []
    for key, bucket in buckets.items():
        count = bucket["count"]
        saturation = bucket["saturation"] / count
        light = bucket["light"] / count
        score = count * (0.65 + saturation * 0.75) * (1 - abs(light - 0.52) * 0.6)
        average = tuple(round(bucket[channel] / count) for channel in ("r", "g", "b"))
        ranked.append({
            "bucket": key,
            "averageHex": "#" + "".join(f"{value:02x}" for value in average),
            "count": count,
            "score": round(score, 2),
            "saturation": round(saturation, 4),
            "light": round(light, 4),
        })
    ranked.sort(key=lambda item: item["score"], reverse=True)
    return {"image": str(image_path), "acceptedPixels": accepted, "topBuckets": ranked[:8], "selected": ranked[0]["averageHex"] if ranked else None}


for argument in sys.argv[1:]:
    print(json.dumps(analyze(Path(argument)), indent=2))
