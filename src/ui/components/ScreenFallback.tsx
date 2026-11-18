import { Skeleton, SkeletonList } from './Skeleton';

/** Placeholder while a screen's code downloads (first visit only; the service worker caches it). */
export function ScreenFallback() {
  return (
    <div className="page-gutter py-8 md:py-12">
      <div role="status" aria-label="Loading the page">
        <Skeleton className="mb-6 h-10 w-2/3 max-w-md" />
        <SkeletonList count={2} label="Loading the page" />
      </div>
    </div>
  );
}
