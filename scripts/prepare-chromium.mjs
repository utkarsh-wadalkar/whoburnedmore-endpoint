import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const chromiumPackSource =
  process.env.CHROMIUM_PACK_SOURCE_URL ??
  "https://github.com/Sparticuz/chromium/releases/download/v152.0.0/chromium-v152.0.0-pack.x64.tar";
const outputPath = resolve("public/chromium-pack.tar");
const temporaryPath = `${outputPath}.download`;
const minimumPackBytes = 8 * 1024 * 1024;

try {
  const existing = await stat(outputPath);
  if (existing.size >= minimumPackBytes) {
    console.log("Chromium pack already exists.");
    process.exit(0);
  }
} catch {
  // The pack does not exist yet.
}

await mkdir(dirname(outputPath), { recursive: true });
console.log("Downloading the Vercel Chromium pack…");

const response = await fetch(chromiumPackSource, { redirect: "follow" });
if (!response.ok) {
  throw new Error(`Could not download Chromium pack (HTTP ${response.status}).`);
}

const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.byteLength < minimumPackBytes) {
  throw new Error("Downloaded Chromium pack is unexpectedly small.");
}

await writeFile(temporaryPath, bytes);
await rename(temporaryPath, outputPath);
console.log("Chromium pack is ready.");
