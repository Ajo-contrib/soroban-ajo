export type ThemeMode = 'light' | 'dark';

export const LightColors = {
  primary: '#6366f1',
  primaryDark: '#4f46e5',
  primaryLight: '#a5b4fc',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  surface: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
  },
  white: '#ffffff',
  black: '#000000',
};

export const DarkColors = {
  primary: '#818cf8',
  primaryDark: '#6366f1',
  primaryLight: '#c7d2fe',
  success: '#4ade80',
  warning: '#fbbf24',
  error: '#f87171',
  surface: {
    50: '#0f172a',
    100: '#1e293b',
    200: '#334155',
    300: '#475569',
    400: '#64748b',
    500: '#94a3b8',
    600: '#cbd5e1',
    700: '#e2e8f0',
    800: '#f1f5f9',
    900: '#f8fafc',
  },
  white: '#f8fafc',
  black: '#000000',
};

export type Colors = typeof LightColors;

// Static default palette for components that don't (yet) consume the
// theme-aware colors via useTheme()/getColors(). Those should migrate to
// `const { colors } = useTheme()` when they're made dark-mode aware.
export const Colors: Colors = LightColors;

export function getColors(theme: ThemeMode) {
  return theme === 'dark' ? DarkColors : LightColors;
}

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const BorderRadius = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const Typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 36 },
  h2: { fontSize: 22, fontWeight: '700' as const, lineHeight: 30 },
  h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 26 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  caption: { fontSize: 11, fontWeight: '400' as const, lineHeight: 16 },
  label: { fontSize: 13, fontWeight: '600' as const, lineHeight: 18 },
};