const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../node_modules/expo-camera/ios/Current/CameraPhotoCapture.swift');

if (fs.existsSync(targetFile)) {
  let content = fs.readFileSync(targetFile, 'utf8');

  // Fix orientation swap bug where portrait width and height are inverted,
  // causing AVMakeRect to crop portrait photos into landscape horizontal strips.
  const targetSnippet = `    return captureDelegate.deviceOrientation == .portrait
      ? CGSize(width: size.height, height: size.width)
      : size`;

  const fixedSnippet = `    return captureDelegate.deviceOrientation == .portrait
      ? CGSize(width: min(size.width, size.height), height: max(size.width, size.height))
      : size`;

  if (content.includes(targetSnippet)) {
    content = content.replace(targetSnippet, fixedSnippet);
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('[patch-expo-camera] Successfully patched CameraPhotoCapture.swift portrait dimensions.');
  } else if (content.includes(fixedSnippet)) {
    console.log('[patch-expo-camera] CameraPhotoCapture.swift already patched.');
  } else {
    console.warn('[patch-expo-camera] Target snippet not found in CameraPhotoCapture.swift.');
  }
} else {
  console.log('[patch-expo-camera] CameraPhotoCapture.swift not found (skipping).');
}
