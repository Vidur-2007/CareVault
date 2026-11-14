import { useParams } from 'react-router';

/** Public shared passport. Rendered without the app shell. Built in phase 5. */
export function ShareScreen() {
  const { id } = useParams();
  return (
    <main className="page-gutter py-12">
      <h1 className="text-page-sm md:text-page">Doctor Visit Passport</h1>
      <p className="mt-3 text-ink-3">The shared view is built in phase 5. Link id: {id}</p>
    </main>
  );
}
