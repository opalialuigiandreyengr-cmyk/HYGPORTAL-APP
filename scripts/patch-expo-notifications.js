const fs = require('fs');
const path = require('path');

// 1. Patch warnOfExpoGoPushUsage to prevent throw in Expo Go on Android
const warnFile = path.resolve(__dirname, '../node_modules/expo-notifications/build/warnOfExpoGoPushUsage.js');
if (fs.existsSync(warnFile)) {
  let content = fs.readFileSync(warnFile, 'utf8');
  if (content.includes("throw new Error(message);")) {
    content = content.replace(
      /if\s*\(\s*Platform\.OS\s*===\s*['"]android['"]\s*\)\s*\{\s*throw new Error\(message\);\s*\}\s*else if\s*\(\s*__DEV__\s*\)\s*\{\s*didWarn = true;\s*console\.warn\(message\);\s*\}/,
      'didWarn = true;\n        console.warn(message);'
    );
    fs.writeFileSync(warnFile, content, 'utf8');
    console.log('[patch-expo-notifications] Patched warnOfExpoGoPushUsage to prevent crash in Expo Go on Android.');
  }
}

// 2. Patch TopicSubscriptionModule.android.js and .ts (missing ExpoTopicSubscriptionModule in Expo Go Android)
const topicSubBuild = path.resolve(__dirname, '../node_modules/expo-notifications/build/TopicSubscriptionModule.android.js');
if (fs.existsSync(topicSubBuild)) {
  const code = `import { requireOptionalNativeModule } from 'expo-modules-core';

const fallback = {
  addListener: () => {},
  removeListeners: () => {},
  subscribeToTopicAsync: () => Promise.resolve(null),
  unsubscribeFromTopicAsync: () => Promise.resolve(null),
};

export default requireOptionalNativeModule('ExpoTopicSubscriptionModule') ?? fallback;
`;
  fs.writeFileSync(topicSubBuild, code, 'utf8');
  console.log('[patch-expo-notifications] Patched TopicSubscriptionModule.android.js.');
}

const topicSubSrc = path.resolve(__dirname, '../node_modules/expo-notifications/src/TopicSubscriptionModule.android.ts');
if (fs.existsSync(topicSubSrc)) {
  const code = `import { requireOptionalNativeModule } from 'expo-modules-core';
import type { TopicSubscriptionModule } from './TopicSubscriptionModule.types';

const fallbackModule: Required<TopicSubscriptionModule> = {
  addListener: () => {},
  removeListeners: () => {},
  subscribeToTopicAsync: () => Promise.resolve(null),
  unsubscribeFromTopicAsync: () => Promise.resolve(null),
};

const nativeModule = requireOptionalNativeModule<TopicSubscriptionModule>('ExpoTopicSubscriptionModule');

export default nativeModule ?? fallbackModule;
`;
  fs.writeFileSync(topicSubSrc, code, 'utf8');
  console.log('[patch-expo-notifications] Patched TopicSubscriptionModule.android.ts.');
}

// 3. Patch requireNativeModule in expo-modules-core to safely handle missing Expo Go modules
const reqNativeFile = path.resolve(__dirname, '../node_modules/expo-modules-core/src/requireNativeModule.ts');
if (fs.existsSync(reqNativeFile)) {
  let content = fs.readFileSync(reqNativeFile, 'utf8');
  if (!content.includes("moduleName === 'ExpoTopicSubscriptionModule'")) {
    content = content.replace(
      /if \(!nativeModule\) \{/,
      `if (!nativeModule) {
    if (moduleName === 'ExpoTopicSubscriptionModule') {
      return {
        addListener: () => {},
        removeListeners: () => {},
        subscribeToTopicAsync: () => Promise.resolve(null),
        unsubscribeFromTopicAsync: () => Promise.resolve(null),
      } as ModuleType;
    }
    if (moduleName === 'NotificationsServerRegistrationModule') {
      return {
        addListener: () => {},
        removeListeners: () => {},
      } as ModuleType;
    }`
    );
    fs.writeFileSync(reqNativeFile, content, 'utf8');
    console.log('[patch-expo-notifications] Patched expo-modules-core/src/requireNativeModule.ts.');
  }
}

// 4. Ensure expo-module-scripts stubs exist for IDE resolution
const moduleScriptsDir = path.resolve(__dirname, '../node_modules/expo-module-scripts');
if (!fs.existsSync(moduleScriptsDir)) {
  fs.mkdirSync(moduleScriptsDir, { recursive: true });
}
fs.writeFileSync(
  path.join(moduleScriptsDir, 'package.json'),
  JSON.stringify({
    name: 'expo-module-scripts',
    version: '56.0.3',
    main: 'index.js',
    exports: {
      './package.json': './package.json',
      './tsconfig.*': './tsconfig.*.json',
      './tsconfig': './tsconfig.json'
    }
  }, null, 2),
  'utf8'
);
const tsconfigBase = JSON.stringify({
  compilerOptions: {
    lib: ['dom', 'dom.iterable', 'esnext'],
    jsx: 'react-jsx',
    target: 'esnext',
    moduleResolution: 'bundler',
    module: 'esnext',
    skipLibCheck: true,
    strict: true,
    declaration: true
  }
}, null, 2);
fs.writeFileSync(path.join(moduleScriptsDir, 'tsconfig.base.json'), tsconfigBase, 'utf8');
fs.writeFileSync(path.join(moduleScriptsDir, 'tsconfig.base'), tsconfigBase, 'utf8');

// 5. Ensure expo-modules-core tsconfig.json does not have emitDeclarationOnly
const modulesCoreTsconfig = path.resolve(__dirname, '../node_modules/expo-modules-core/tsconfig.json');
if (fs.existsSync(modulesCoreTsconfig)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(modulesCoreTsconfig, 'utf8'));
    if (parsed.compilerOptions) {
      delete parsed.compilerOptions.emitDeclarationOnly;
      delete parsed.compilerOptions.declaration;
      fs.writeFileSync(modulesCoreTsconfig, JSON.stringify(parsed, null, 2), 'utf8');
      console.log('[patch-expo-notifications] Cleaned expo-modules-core/tsconfig.json.');
    }
  } catch (e) {}
}
