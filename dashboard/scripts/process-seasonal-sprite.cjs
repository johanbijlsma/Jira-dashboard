const fs = require("fs");
const { PNG } = require("pngjs");

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/process-seasonal-sprite.cjs <input.png> <output.png>");
}

const png = PNG.sync.read(fs.readFileSync(inputPath));
const { width, height, data } = png;
const visited = new Uint8Array(width * height);
const queue = [];

function isWhiteBackground(index) {
  const offset = index * 4;
  return data[offset] > 245 && data[offset + 1] > 245 && data[offset + 2] > 245;
}

function enqueue(index) {
  if (visited[index] || !isWhiteBackground(index)) return;
  visited[index] = 1;
  queue.push(index);
}

for (let x = 0; x < width; x += 1) {
  enqueue(x);
  enqueue((height - 1) * width + x);
}
for (let y = 1; y < height - 1; y += 1) {
  enqueue(y * width);
  enqueue(y * width + width - 1);
}

for (let cursor = 0; cursor < queue.length; cursor += 1) {
  const index = queue[cursor];
  const x = index % width;
  const y = Math.floor(index / width);
  if (x > 0) enqueue(index - 1);
  if (x + 1 < width) enqueue(index + 1);
  if (y > 0) enqueue(index - width);
  if (y + 1 < height) enqueue(index + width);
}

for (const index of queue) data[index * 4 + 3] = 0;
fs.writeFileSync(outputPath, PNG.sync.write(png));
