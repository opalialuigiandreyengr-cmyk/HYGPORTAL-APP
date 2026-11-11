const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

// Prevent Metro from processing nested duplicate react-native modules during eager bundling
config.resolver.blockList = [
  /node_modules\/.*\/node_modules\/react-native\/.*/,
];

// Alias tslib to its ES6 build to fix "Cannot destructure property '__extends' of 'tslib.default'"
// caused by nested legacy tslib 1.x in pdf-lib when bundling with Metro on Web.
const tslibEs6Path = require.resolve('tslib/tslib.es6.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'tslib') {
    return {
      filePath: tslibEs6Path,
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
