import { useRouter } from 'expo-router';
import { ServersScreen } from '../src/screens/ServersScreen';
import { useSession } from '../src/session';

export default function Route() {
  const router = useRouter();
  const { server, selectServer, updateServer, removeServer } = useSession();
  if (!server) return null;
  return (
    <ServersScreen
      active={server}
      onBack={() => router.back()}
      onSelect={selectServer}
      onSave={updateServer}
      onRemove={removeServer}
    />
  );
}
