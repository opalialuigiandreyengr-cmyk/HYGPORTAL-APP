const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const distDir = path.join(root, 'dist');

for (const fileName of ['manifest.json', 'sw.js', 'pwa-icon.png', 'apple-touch-icon.png', 'app-version.json', 'hygportal.apk']) {
  const source = path.join(publicDir, fileName);
  const target = path.join(distDir, fileName);

  if (!fs.existsSync(source)) {
    if (fileName === 'hygportal.apk') continue;
    throw new Error(`Missing PWA asset: ${source}`);
  }

  fs.copyFileSync(source, target);
}

// Copy .well-known folder for Android App Links & iOS Universal Links
const wellKnownSource = path.join(publicDir, '.well-known');
const wellKnownTarget = path.join(distDir, '.well-known');
if (fs.existsSync(wellKnownSource)) {
  if (!fs.existsSync(wellKnownTarget)) {
    fs.mkdirSync(wellKnownTarget, { recursive: true });
  }
  for (const file of fs.readdirSync(wellKnownSource)) {
    fs.copyFileSync(path.join(wellKnownSource, file), path.join(wellKnownTarget, file));
  }
}

console.log('Copied PWA assets to dist.');
