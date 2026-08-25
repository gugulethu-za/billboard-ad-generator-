
import fs from 'node:fs';

const html = fs.readFileSync('ad-generator_5.preview.html', 'utf8');
const source = html.match(/function extractDominantBrandColor\(imageDataUrl\)\{.*?\n(?=async function fetchWebsiteBrandColor)/s)?.[0]?.trim();
if (!source) throw new Error('Color extraction function not found');

function createPixels(colors) {
  const pixels = new Uint8ClampedArray(96 * 96 * 4);
  let offset = 0;
  for (const [count, color] of colors) {
    for (let i = 0; i < count; i++) {
      pixels.set([...color, 255], offset);
      offset += 4;
    }
  }
  return pixels;
}

async function extractFrom(pixels) {
  class FakeImage {
    set src(value) { queueMicrotask(() => this.onload?.()); }
  }
  const document = {
    createElement() {
      return { getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) };
    },
  };
  const extract = Function('Image', 'document', `${source}; return extractDominantBrandColor;`)(FakeImage, document);
  return extract('data:image/png;base64,test');
}

const brandPixels = createPixels([
  [6500, [255, 255, 255]],
  [1800, [20, 95, 235]],
  [500, [225, 45, 55]],
  [416, [128, 128, 128]],
]);
const selected = await extractFrom(brandPixels);
if (selected !== '#145feb') throw new Error(`Expected #145feb, received ${selected}`);

let neutralRejected = false;
try {
  await extractFrom(createPixels([[9216, [245, 245, 245]]]));
} catch {
  neutralRejected = true;
}
if (!neutralRejected) throw new Error('Neutral-only screenshot should not produce a brand color');

console.log(JSON.stringify({ selected, neutralBackgroundIgnored: true, neutralOnlyFallback: true }, null, 2));
