import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

// Prevent React Native Web ModalPortal removeChild crash when nodes are unmounted/detached
if (Platform.OS === 'web' && typeof Node !== 'undefined' && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child && child.parentNode !== this) {
      if (typeof (child as any).remove === 'function') {
        (child as any).remove();
      }
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };
}

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
