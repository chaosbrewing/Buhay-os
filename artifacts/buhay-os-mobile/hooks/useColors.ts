import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

export type ThemePreference = 'system' | 'light' | 'dark';
export const ThemePreferenceContext = createContext<ThemePreference>('system');

export function useColors() {
  const systemScheme = useColorScheme();
  const preference = useContext(ThemePreferenceContext);
  const scheme = preference === 'system' ? systemScheme : preference;
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
