export const colors = {
  background: '#f8fafc',
  surface: '#ffffff',
  text: '#172033',
  muted: '#64748b',
  border: '#dbe4ef',
  primary: '#2563eb',
  brand: {
    ink: '#071426',
    panel: '#0f172a',
    panelSoft: '#111827',
    line: '#1e3a5f',
    gold: '#facc15',
    goldStrong: '#eab308',
    white: '#ffffff',
  },
  semantic: {
    success: '#16a34a',
    danger: '#dc2626',
    warning: '#facc15',
  },
};

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 6,
  md: 8,
};

export const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  heavy: '800' as const,
};

export const typography = {
  label: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    letterSpacing: 0,
    textTransform: 'uppercase' as const,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: fontWeights.heavy,
  },
  hero: {
    fontSize: 19,
    lineHeight: 23,
    fontWeight: fontWeights.heavy,
  },
};
