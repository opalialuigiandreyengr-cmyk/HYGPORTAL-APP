import React from 'react';
import { Platform } from 'react-native';

type WebNativeDateInputProps = {
  value: string;
  label: string;
  onChange: (value: string) => void;
};

type HtmlDateInputElement = HTMLInputElement & {
  showPicker?: () => void;
};

export function WebNativeDateInput({ value, label, onChange }: WebNativeDateInputProps) {
  if (Platform.OS !== 'web') {
    return null;
  }

  return React.createElement('input', {
    'aria-label': label,
    type: 'date',
    value,
    onChange: (event: React.ChangeEvent<HtmlDateInputElement>) => {
      onChange(event.currentTarget.value);
    },
    onClick: (event: React.MouseEvent<HtmlDateInputElement>) => {
      event.currentTarget.showPicker?.();
    },
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      opacity: 0,
      border: 0,
      cursor: 'pointer',
    },
  });
}
