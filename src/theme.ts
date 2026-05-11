export const colors = {
  background: '#f8fafc',
  surface: '#ffffff',
  text: '#172033',
  muted: '#64748b',
  border: '#dbe4ef',
  primary: '#2563eb',
  brand: {
    ink: '#070b14',
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

export const typography = {
  label: {
    fontSize: 12,
    fontWeight: '800' as const,
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
    fontWeight: '900' as const,
  },
  hero: {
    fontSize: 19,
    lineHeight: 23,
    fontWeight: '900' as const,
  },
};
