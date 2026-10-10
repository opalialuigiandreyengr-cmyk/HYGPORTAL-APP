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

// Prevent auto-zoom on input focus in Web / PWA (especially iOS Safari / mobile browsers)
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  // 1. Ensure viewport meta tag disables auto-zooming and scales properly
  let viewportMeta = document.querySelector('meta[name="viewport"]');
  if (!viewportMeta) {
    viewportMeta = document.createElement('meta');
    viewportMeta.setAttribute('name', 'viewport');
    document.head.appendChild(viewportMeta);
  }
  viewportMeta.setAttribute(
    'content',
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, shrink-to-fit=no, viewport-fit=cover, interactive-widget=resizes-content'
  );

  // 2. Inject global CSS rule ensuring input/textarea/select font-size is at least 16px to prevent iOS auto-zoom
  if (!document.getElementById('prevent-input-zoom-style')) {
    const style = document.createElement('style');
    style.id = 'prevent-input-zoom-style';
    style.textContent = `
      @media screen and (max-width: 1024px), (pointer: coarse) {
        input:not([type="checkbox"]):not([type="radio"]),
        textarea,
        select {
          font-size: 16px !important;
        }
      }
      input,
      textarea,
      select {
        touch-action: manipulation;
      }
    `;
    document.head.appendChild(style);
  }

  // 3. Ensure document root and body background color are dark brand navy
  if (document.documentElement) {
    document.documentElement.style.backgroundColor = '#071426';
  }
  if (document.body) {
    document.body.style.backgroundColor = '#071426';
  }

  // 4. Ensure focused input is scrolled smoothly above on-screen keyboard on mobile web/PWA,
  // and reset window scroll position when keyboard closes so no bottom white gap remains.
  if (typeof window !== 'undefined') {
    window.addEventListener('focusin', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        setTimeout(() => {
          try {
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch {
            // ignore fallback
          }
        }, 300);
      }
    });

    window.addEventListener('focusout', () => {
      setTimeout(() => {
        try {
          window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        } catch {
          window.scrollTo(0, 0);
        }
      }, 100);
    });
  }
}

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
