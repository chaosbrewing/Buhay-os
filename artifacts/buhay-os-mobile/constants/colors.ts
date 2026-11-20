/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    text: '#283e37',
    tint: '#3c7760',
    background: '#f8f5ed',
    foreground: '#283e37',
    card: '#fcfbf8',
    cardForeground: '#283e37',
    primary: '#3c7760',
    primaryForeground: '#fbf9f4',
    secondary: '#eee2d3',
    secondaryForeground: '#30453f',
    muted: '#ece8df',
    mutedForeground: '#677e75',
    accent: '#ebd7bc',
    accentForeground: '#30453f',
    destructive: '#c24138',
    destructiveForeground: '#ffffff',
    border: '#e2dbd0',
    input: '#dad2c3',
  },
  dark: {
    text: '#ece7d9',
    tint: '#6bb893',
    background: '#1c2724',
    foreground: '#ece7d9',
    card: '#24322e',
    cardForeground: '#ece7d9',
    primary: '#6bb893',
    primaryForeground: '#192421',
    secondary: '#364942',
    secondaryForeground: '#ece7d9',
    muted: '#313f3b',
    mutedForeground: '#9cb0a6',
    accent: '#605034',
    accentForeground: '#ece7d9',
    destructive: '#d56e67',
    destructiveForeground: '#1c2724',
    border: '#3a4a44',
    input: '#43564f',
  },
  radius: 16,
};

export default colors;
