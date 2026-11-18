import { cx } from '../lib/cx';

/** The CV mark, optionally with the word mark. */
export function Logo({ withName = true, className }: { withName?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-3', className)}>
      <span aria-hidden className="flex size-9 items-center justify-center rounded-[10px] bg-teal font-heading text-[15px] font-bold text-white md:size-10">
        CV
      </span>
      {withName ? <span className="font-heading text-[20px] font-bold text-ink">CareVault</span> : <span className="sr-only">CareVault</span>}
    </span>
  );
}
