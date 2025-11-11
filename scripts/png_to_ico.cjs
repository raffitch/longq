#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const [input, output] = process.argv.slice(2);

if (!input || !output) {
  console.error('Usage: node scripts/png_to_ico.cjs <input.png> <output.ico>');
  process.exit(1);
}

const inputPath = path.resolve(process.cwd(), input);
const outputPath = path.resolve(process.cwd(), output);

let pngData;
try {
  pngData = fs.readFileSync(inputPath);
} catch (error) {
  console.error(`Unable to read input file: ${inputPath}`);
  console.error(error.message);
  process.exit(1);
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type (1 = icon)
header.writeUInt16LE(1, 4); // number of images

const entry = Buffer.alloc(16);
entry[0] = 0; // width (0 represents 256)
entry[1] = 0; // height (0 represents 256)
entry[2] = 0; // color palette entries (0 = no palette)
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(pngData.length, 8); // size of the PNG data
entry.writeUInt32LE(header.length + entry.length, 12); // offset to PNG data

const icoData = Buffer.concat([header, entry, pngData]);

try {
  fs.writeFileSync(outputPath, icoData);
  console.log(`Wrote ${outputPath}`);
} catch (error) {
  console.error(`Unable to write output file: ${outputPath}`);
  console.error(error.message);
  process.exit(1);
}
