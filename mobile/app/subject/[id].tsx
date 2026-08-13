import { useLocalSearchParams, useRouter } from 'expo-router';
import { SubjectScreen } from '../../src/screens/SubjectScreen';
import { useServerUrl } from '../../src/session';

export default function SubjectRoute() {
  const serverUrl = useServerUrl();
  const router = useRouter();
  const { id, title, kind } = useLocalSearchParams<{
    id: string;
    title?: string;
    kind?: string;
  }>();

  return (
    <SubjectScreen
      serverUrl={serverUrl}
      subjectId={id}
      title={title ?? 'Unnamed'}
      kind={kind === 'PET' ? 'PET' : 'PERSON'}
      slot={`subject:${id}`}
      onBack={() => router.back()}
    />
  );
}
