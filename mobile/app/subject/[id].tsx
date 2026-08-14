import { useLocalSearchParams, useRouter } from 'expo-router';
import { SubjectScreen } from '../../src/screens/SubjectScreen';
import { useServerUrl } from '../../src/session';

export default function SubjectRoute() {
  const serverUrl = useServerUrl();
  const router = useRouter();
  const { id, title, kind, species } = useLocalSearchParams<{
    id: string;
    title?: string;
    kind?: string;
    species?: string;
  }>();

  return (
    <SubjectScreen
      serverUrl={serverUrl}
      subjectId={id}
      title={title ?? 'Unnamed'}
      kind={kind === 'PET' ? 'PET' : 'PERSON'}
      species={species || null}
      slot={`subject:${id}`}
      onBack={() => router.back()}
    />
  );
}
