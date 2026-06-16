/** Keys for provisional browser-side persistence until backend APIs exist. */
export const SETTINGS_STORAGE_KEYS = {
  telegramBotToken: "upos-settings-telegram-bot-token",
  integration1c: "upos-settings-integration-1c",
  integrationYespos: "upos-settings-integration-yespos",
  integrationIbox: "upos-settings-integration-ibox",
} as const;

export type OneCIntegrationForm = {
  baseUrl: string;
  username: string;
  password: string;
};

export type YesposIntegrationForm = {
  apiBaseUrl: string;
  apiKey: string;
};

export type IboxIntegrationForm = {
  apiUrl: string;
  apiKey: string;
  terminalId: string;
};
