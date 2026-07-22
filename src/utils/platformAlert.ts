import { Alert, Platform } from 'react-native';

type AlertButton = {
  text: string;
  style?: 'cancel' | 'destructive' | 'default';
  onPress?: () => void;
};

function getButtonText(buttons: AlertButton[], fallbackIndex: number): string {
  return buttons[fallbackIndex]?.text ?? 'OK';
}

function getDestructiveIndex(buttons: AlertButton[]): number {
  const idx = buttons.findIndex((b) => b.style === 'destructive');
  return idx >= 0 ? idx : buttons.length - 1;
}

function getCancelIndex(buttons: AlertButton[]): number {
  const idx = buttons.findIndex((b) => b.style === 'cancel');
  return idx >= 0 ? idx : -1;
}

export function platformAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[],
): void {
  const resolvedButtons = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];

  if (Platform.OS === 'web') {
    const body = message ? `${title}\n\n${message}` : title;

    if (resolvedButtons.length === 1) {
      const win = globalThis as unknown as { alert?: (msg: string) => void };
      win.alert?.(body);
      resolvedButtons[0]?.onPress?.();
      return;
    }

    const win = globalThis as unknown as { confirm?: (msg: string) => boolean };
    const confirmed = win.confirm?.(body);
    const cancelIdx = getCancelIndex(resolvedButtons);
    const destructiveIdx = getDestructiveIndex(resolvedButtons);

    if (confirmed) {
      const actionIdx = destructiveIdx >= 0 ? destructiveIdx : resolvedButtons.length - 1;
      resolvedButtons[actionIdx]?.onPress?.();
    } else if (cancelIdx >= 0) {
      resolvedButtons[cancelIdx]?.onPress?.();
    }

    return;
  }

  Alert.alert(title, message, buttons);
}

export function platformConfirm(message: string): boolean {
  if (Platform.OS === 'web') {
    const win = globalThis as unknown as { confirm?: (msg: string) => boolean };
    return win.confirm?.(message) ?? false;
  }

  return false;
}
