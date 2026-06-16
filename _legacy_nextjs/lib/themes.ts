export const APP_THEMES = ["light", "dark", "emerald"] as const;

export type AppThemeId = (typeof APP_THEMES)[number];
