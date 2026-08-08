import { useLocalSearchParams, useRouter } from 'expo-router';
import { PersonScreen } from '../../src/screens/PersonScreen';
import { useServerUrl } from '../../src/session';

export default function Route() {
  const serverUrl = useServerUrl();
  const router = useRouter();
  const { id, title, kind } = useLocalSearchParams<{
    id: string;
    title?: string;
    kind?: string;
  }>();

  return (
    <PersonScreen
      serverUrl={serverUrl}
      personId={id}
      title={title ?? 'Unnamed'}
      // Params arrive as strings, so the union has to be narrowed rather than
      // asserted — a stray value would otherwise put a person among the pets.
      kind={kind === 'PET' ? 'PET' : 'PERSON'}
      slot={`person:${id}`}
      onBack={() => router.back()}
    />
  );
}
