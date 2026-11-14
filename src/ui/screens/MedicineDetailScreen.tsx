import { useParams } from 'react-router';
import { Placeholder } from './Placeholder';

export function MedicineDetailScreen() {
  const { id } = useParams();
  return (
    <Placeholder title="Medicine" phase={3}>
      <p className="mt-2 text-secondary text-ink-3">Id: {id}</p>
    </Placeholder>
  );
}
