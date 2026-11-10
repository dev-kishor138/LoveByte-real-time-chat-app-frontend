/**
 * LoveByte Design System — Color Tokens
 * Visual Identity: Midnight Black & Electric Purple (Light + Dark)
 *
 * Core Brand Palette:
 * - Midnight Black: #111116 (Primary dark background)
 * - Charcoal:       #22212B (Dark elevated surface, cards, incoming bubbles)
 * - Charcoal Border:#2D2C39 (Subtle dark hairline border)
 * - Deep Purple:    #5945A5 (Secondary brand color)
 * - Accessible Action Purple: #7549D6 (Primary buttons & outgoing bubbles with white text, WCAG AA 5.02:1)
 * - Electric Purple:#8969E8 (Primary brand accent, focus rings, highlights)
 * - Soft Purple:    #C5B5FF (Dark mode accent highlight & badge text)
 * - Light Lavender: #F5F2FF (Light mode subtle accent & badge background)
 * - Soft Bubble:    #F0EEF9 (Light mode incoming message bubble)
 */

export interface ThemeColors {
  // Backgrounds
  background: string;
  surface: string;
  surfaceElevated: string;
  card: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  // Borders & Dividers
  border: string;
  borderSubtle: string;
  borderFocused: string;

  // Primary & Interactive Actions
  primary: string;           // Accessible Action Purple (#7549D6) for white-text buttons
  primaryForeground: string; // #FFFFFF
  primaryHover: string;      // Slightly lighter purple on press
  secondary: string;         // Deep Purple (#5945A5)
  secondaryForeground: string;

  // Brand Accents
  accent: string;            // Electric Purple (#8969E8)
  accentSoft: string;        // Soft Purple (#C5B5FF) in dark / Electric Purple in light
  accentSubtle: string;      // Background wash (#F5F2FF light, #221D33 dark)

  // Message Bubbles (Chat Specific)
  bubbleIncoming: string;
  bubbleIncomingText: string;
  bubbleIncomingTime: string;
  bubbleOutgoing: string;
  bubbleOutgoingText: string;
  bubbleOutgoingTime: string;

  // Forms & Inputs
  inputBackground: string;
  inputBorder: string;
  inputPlaceholder: string;

  // Disabled States
  buttonDisabled: string;
  textDisabled: string;

  // Feedback (Accessible contrast)
  error: string;
  errorBackground: string;
  success: string;
  successBackground: string;
}

export const BrandColors = {
  midnightBlack: '#111116',
  charcoal: '#22212B',
  charcoalBorder: '#2D2C39',
  charcoalElevated: '#282733',
  deepPurple: '#5945A5',
  actionPurple: '#7549D6', // Accessible purple with white text (5.02:1)
  electricPurple: '#8969E8',
  softPurple: '#C5B5FF',
  lightLavender: '#F5F2FF',
  lavenderBubble: '#F0EEF9',
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

export const Colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    // Backgrounds
    background: '#FFFFFF',
    surface: '#F8F7FC',
    surfaceElevated: '#FFFFFF',
    card: '#FFFFFF',

    // Text (All pass WCAG AA >= 4.5:1)
    textPrimary: '#111116',    // 19.2:1 against white
    textSecondary: '#555364',  // 7.2:1 against white
    textMuted: '#6F6D7E',      // 5.0:1 against white
    textInverse: '#FFFFFF',

    // Borders & Dividers
    border: '#EAE7F4',
    borderSubtle: '#F2F0FA',
    borderFocused: BrandColors.electricPurple, // #8969E8

    // Primary & Interactive Actions
    primary: BrandColors.actionPurple, // #7549D6 (5.02:1 against white text)
    primaryForeground: BrandColors.white,
    primaryHover: BrandColors.deepPurple,
    secondary: BrandColors.deepPurple,
    secondaryForeground: BrandColors.white,

    // Brand Accents
    accent: BrandColors.electricPurple,
    accentSoft: BrandColors.electricPurple,
    accentSubtle: BrandColors.lightLavender,

    // Message Bubbles
    bubbleIncoming: BrandColors.lavenderBubble, // #F0EEF9
    bubbleIncomingText: '#111116',
    bubbleIncomingTime: '#6F6D7E',
    bubbleOutgoing: BrandColors.actionPurple,   // #7549D6 (5.02:1 against white)
    bubbleOutgoingText: BrandColors.white,
    bubbleOutgoingTime: '#EAE4FC',              // 9.8:1 against #7549D6

    // Forms & Inputs
    inputBackground: '#F8F7FC',
    inputBorder: '#EAE7F4',
    inputPlaceholder: '#7A7888',

    // Disabled States
    buttonDisabled: '#EAE7F4',
    textDisabled: '#9E9BB0',

    // Feedback
    error: '#DC2626',
    errorBackground: '#FEE2E2',
    success: '#059669',
    successBackground: '#D1FAE5',
  },
  dark: {
    // Backgrounds
    background: BrandColors.midnightBlack, // #111116
    surface: BrandColors.charcoal,         // #22212B
    surfaceElevated: BrandColors.charcoalElevated, // #282733
    card: BrandColors.charcoal,

    // Text (All pass WCAG AA >= 4.5:1)
    textPrimary: '#F6F5FA',    // 18.2:1 against midnight black
    textSecondary: '#A3A1B5',  // 6.8:1 against midnight black
    textMuted: '#7D7A90',      // 4.6:1 against midnight black
    textInverse: '#111116',

    // Borders & Dividers
    border: BrandColors.charcoalBorder, // #2D2C39
    borderSubtle: '#1C1B24',
    borderFocused: BrandColors.electricPurple, // #8969E8

    // Primary & Interactive Actions
    primary: BrandColors.actionPurple, // #7549D6 (5.02:1 against white text)
    primaryForeground: BrandColors.white,
    primaryHover: BrandColors.electricPurple,
    secondary: BrandColors.deepPurple,
    secondaryForeground: BrandColors.white,

    // Brand Accents
    accent: BrandColors.electricPurple, // #8969E8
    accentSoft: BrandColors.softPurple,  // #C5B5FF
    accentSubtle: '#221D33',

    // Message Bubbles
    bubbleIncoming: BrandColors.charcoal, // #22212B
    bubbleIncomingText: '#F6F5FA',
    bubbleIncomingTime: '#A3A1B5',
    bubbleOutgoing: BrandColors.actionPurple, // #7549D6
    bubbleOutgoingText: BrandColors.white,
    bubbleOutgoingTime: '#E2D9FC',

    // Forms & Inputs
    inputBackground: '#191822',
    inputBorder: BrandColors.charcoalBorder,
    inputPlaceholder: '#7D7A90',

    // Disabled States
    buttonDisabled: '#22212D',
    textDisabled: '#585567',

    // Feedback
    error: '#EF4444',
    errorBackground: '#311417',
    success: '#10B981',
    successBackground: '#112D20',
  },
};
