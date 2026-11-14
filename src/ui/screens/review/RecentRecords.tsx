import { motion } from 'motion/react';
import type { DocumentRecord, PrescriptionDiff } from '../../../contract/types';
import { useMotionPresets } from '../../app/motion';
import { DocumentCard } from '../../components/DocumentCard';
import { SectionHeader } from '../../components/SectionHeader';
import { plural } from './copy';

/** The three newest confirmed documents. Pending ones are already in "Things to review". */
function recentConfirmed(documents: DocumentRecord[], count = 3): DocumentRecord[] {
  return documents
    .filter((d) => d.state === 'confirmed')
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    .slice(0, count);
}

export function RecentRecords({ documents, diff }: { documents: DocumentRecord[]; diff: PrescriptionDiff | null }) {
  const presets = useMotionPresets();
  const recent = recentConfirmed(documents);
  if (recent.length === 0) return null;

  const changes = diff ? diff.rows.filter((r) => r.kind === 'added' || r.kind === 'changed').length : 0;
  const extraFor = (doc: DocumentRecord) =>
    diff && doc.id === diff.latestDocumentId && changes > 0
      ? `${changes} medicine ${plural(changes, 'change', 'changes')} found`
      : undefined;

  return (
    <section aria-labelledby="recent-records-title" className="mt-12 md:mt-14">
      <SectionHeader id="recent-records-title" title="Recently added records" />
      <motion.ul initial="hidden" animate="show" variants={presets.list} className="grid gap-4 md:grid-cols-3 md:gap-5">
        {recent.map((doc, i) => (
          <motion.li key={doc.id} custom={i} variants={presets.listItem} className="flex">
            <DocumentCard document={doc} extra={extraFor(doc)} className="w-full" />
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}
