import { useCallback, useState, type ReactNode } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { signalActivity } from '../lib/api';
import { colors } from '../theme';

interface Props {
  serverUrl: string;
  /** Native tabs mount eagerly; defer costly screens until their first visit. */
  defer?: boolean;
  children: ReactNode;
}

export function ActiveTab({ serverUrl, defer = false, children }: Props) {
  const [activated, setActivated] = useState(!defer);

  useFocusEffect(
    useCallback(() => {
      setActivated(true);
      void signalActivity(serverUrl).catch(() => undefined);
    }, [serverUrl]),
  );

  if (!activated) return <View style={styles.placeholder} />;
  return children;
}

const styles = StyleSheet.create({
  placeholder: { flex: 1, backgroundColor: colors.bg },
});
