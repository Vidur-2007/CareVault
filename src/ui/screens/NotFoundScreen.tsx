import { Button } from '../components/Button';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export function NotFoundScreen() {
  useDocumentTitle('Page not found');
  return (
    <div className="page-gutter py-8 md:py-12">
      <h1 className="text-page-sm md:text-page">This page does not exist</h1>
      <p className="mt-3 text-ink-2">The link may be old or mistyped.</p>
      <Button to="/" className="mt-6">
        Go to Home
      </Button>
    </div>
  );
}
