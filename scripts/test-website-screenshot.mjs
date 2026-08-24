import fs from 'node:fs';
import { onRequestPost } from '../functions/api/website-screenshot.js';

const envText = ['.env', '.dev.vars']
  .filter((path) => fs.existsSync(path))
  .map((path) => fs.readFileSync(path, 'utf8'))
  .join('\n');
for (const line of envText.split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (!match) continue;
  const key = match[1].trim();
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[key] = value;
}

const started = Date.now();
const response = await onRequestPost({
  env: process.env,
  request: new Request('http://local/api/website-screenshot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: process.argv[2] || 'https://example.com' }),
  }),
});
const data = await response.json();
console.log(JSON.stringify({
  status: response.status,
  ok: data.ok,
  elapsedSeconds: Number(((Date.now() - started) / 1000).toFixed(2)),
  imageType: data.imageDataUrl?.slice(0, 30),
  encodedLength: data.imageDataUrl?.length,
  error: data.error,
}, null, 2));
if (!response.ok || !data.imageDataUrl) process.exitCode = 1;
