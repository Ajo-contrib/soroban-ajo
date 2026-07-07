import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { Animated } from 'react-native';
import { useThemeStore } from '../store/themeStore';
import { getColors, type Colors, LightColors } from '../constants/theme';

interface ThemeContextValue {
  colors: Colors;
  isDark: boolean;
  toggleTheme: () => Promise<void>;
  setTheme: (isDark: boolean) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { isDark, toggleTheme, setTheme, initialize, isLoaded } = useThemeStore();
  const [, forceUpdate] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const handleToggle = useCallback(async () => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
    await toggleTheme();
    forceUpdate((c) => c + 1);
  }, [toggleTheme, fadeAnim]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const colors = isLoaded ? getColors(isDark ? 'dark' : 'light') : LightColors;

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <ThemeContext.Provider value={{ colors, isDark, toggleTheme: handleToggle, setTheme }}>
        {children}
      </ThemeContext.Provider>
    </Animated.View>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export function useColorPrimary() {
  const { colors } = useTheme();
  return colors.primary;
}