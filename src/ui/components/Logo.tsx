import { cx } from '../lib/cx';

/** The CV mark, optionally with the word mark. `small` is the passport header size (the mark never shrinks unevenly). */
export function Logo({ withName = true, small = false, className }: { withName?: boolean; small?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center', small ? 'gap-2' : 'gap-3', className)}>
      <span
        aria-hidden
        className={cx(
          'flex shrink-0 items-center justify-center bg-teal font-heading font-bold text-white',
          small ? 'size-8 rounded-[9px] text-[13px]' : 'size-9 rounded-[10px] text-[15px] md:size-10',
        )}
      >
        CV
      </span>
      {withName ? <span className={cx('font-heading font-bold text-ink', small ? 'text-[17px]' : 'text-[20px]')}>CareVault</span> : <span className="sr-only">CareVault</span>}
    </span>
  );
}
