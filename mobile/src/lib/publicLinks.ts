import { Alert, Linking } from 'react-native';

export const PUBLIC_PAGES = {
  privacy: 'https://imadeo.app/privacy.html',
  support: 'https://imadeo.app/support.html',
} as const;

export async function openPublicPage(page: keyof typeof PUBLIC_PAGES): Promise<void> {
  const url = PUBLIC_PAGES[page];
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Could not open page', `Open ${url} in your browser.`);
  }
}
