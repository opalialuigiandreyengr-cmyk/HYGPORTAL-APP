import React from 'react';
import { Platform } from 'react-native';

type WebNativeDateInputProps = {
  value: string;
  label: string;
  onChange: (value: string) => void;
  type?: 'date' | 'time';
};

type HtmlDateInputElement = HTMLInputElement & {
  showPicker?: () => void;
};

export function WebNativeDateInput({ value, label, onChange, type = 'date' }: WebNativeDateInputProps) {
  if (Platform.OS !== 'web') {
    return null;
  }

  return React.createElement('input', {
    'aria-label': label,
    type,
    value,
    onChange: (event: React.ChangeEvent<HtmlDateInputElement>) => {
      const nextValue = event.currentTarget.value;
      if (nextValue !== undefined) {
        onChange(nextValue);
      }
    },
    onInput: (event: React.FormEvent<HtmlDateInputElement>) => {
      const nextValue = event.currentTarget.value;
      if (nextValue !== undefined) {
        onChange(nextValue);
      }
    },
    onClick: (event: React.MouseEvent<HtmlDateInputElement>) => {
      try {
        event.currentTarget.showPicker?.();
      } catch (_e) {
        // showPicker might throw in browsers if already open or disallowed
      }
    },
    style: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: '100%',
      height: '100%',
      opacity: 0,
      border: 0,
      cursor: 'pointer',
      zIndex: 10,
      WebkitAppearance: 'none',
      MozAppearance: 'none',
    },
  });
}
