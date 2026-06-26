const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const distDir = path.join(root, 'dist');

for (const fileName of ['manifest.json', 'sw.js', 'pwa-icon.png', 'apple-touch-icon.png']) {
  const source = path.join(publicDir, fileName);
  const target = path.join(distDir, fileName);

  if (!fs.existsSync(source)) {
    throw new Error(`Missing PWA asset: ${source}`);
  }

  fs.copyFileSync(source, target);
}

console.log('Copied PWA assets to dist.');
