import { useRouter } from 'expo-router';
import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { useSession } from '../../src/session';

export default function Route() {
  const router = useRouter();
  const { server } = useSession();

  return (
    <SettingsScreen
      serverUrl={server?.url ?? ''}
      onManageServers={() => router.push('/servers')}
    />
  );
}
