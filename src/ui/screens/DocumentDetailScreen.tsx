import { useParams } from 'react-router';
import { Placeholder } from './Placeholder';

export function DocumentDetailScreen() {
  const { id } = useParams();
  return (
    <Placeholder title="Record" phase={4}>
      <p className="mt-2 text-secondary text-ink-3">Id: {id}</p>
    </Placeholder>
  );
}
