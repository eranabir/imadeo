import { Pressable, Text, View } from 'react-native';
import { openPublicPage } from '../lib/publicLinks';
import { colors } from '../theme';

/** Policy and help stay available before a server account has been connected. */
export function PublicLinks() {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
    {(['privacy', 'support'] as const).map(page => <Pressable key={page}
      accessibilityRole="link" onPress={() => void openPublicPage(page)}
      style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center',
        opacity: pressed ? 0.65 : 1 })}>
      <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>
        {page === 'privacy' ? 'Privacy policy' : 'Support'}
      </Text>
    </Pressable>)}
  </View>;
}
