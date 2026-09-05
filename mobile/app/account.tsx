import { useRouter } from 'expo-router';
import { AccountScreen } from '../src/screens/AccountScreen';
import { useSession } from '../src/session';

export default function Route() {
  const router = useRouter();
  const { server, leave } = useSession();

  return (
    <AccountScreen
      serverUrl={server?.url ?? ''}
      onManageServers={() => router.push('/servers')}
      onSignOut={() => void leave()}
      onBack={() => router.back()}
    />
  );
}
