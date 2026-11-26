// Private component gallery for design review. Not linked from navigation.
import { Grid2x2, List } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { expected, IDS, sampleMedicines } from '../../contract/legacy/fixtures/sampleCase';
import { IDS as V2, sampleDocuments as sampleDocumentsV2, sampleProfiles } from '../../contract/fixtures/sampleCase';
import { NAV_ITEMS } from '../app/navItems';
import {
  BottomTabs,
  Button,
  Card,
  Checkbox,
  CloudNotice,
  ConfirmDialog,
  Dialog,
  DocumentCard,
  EmptyState,
  ErrorPanel,
  Field,
  FileDrop,
  Logo,
  MedicineRow,
  Panel,
  Pill,
  ProfileSwitcher,
  SectionHeader,
  SegmentedControl,
  Sheet,
  Skeleton,
  SkeletonList,
  SourceViewer,
  StatTile,
  TimelineItem,
  TopNav,
  medicineStatusPill,
} from '../components';
import { useToast } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatDate } from '../lib/format';
import { placeholderPdf } from '../mock/placeholderPdf';
import { Inbox } from 'lucide-react';

const med = (id: string) => sampleMedicines.find((m) => m.id === id)!;
const docV2 = (id: string) => sampleDocumentsV2.find((d) => d.id === id)!;

const PACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#F7FAFA"/><rect x="60" y="80" width="480" height="240" rx="18" fill="#fff" stroke="#9FB3B4" stroke-width="3"/><text x="300" y="190" font-family="sans-serif" font-size="56" font-weight="700" text-anchor="middle" fill="#0B6E6E">DOLO 650</text><text x="300" y="245" font-family="sans-serif" font-size="24" text-anchor="middle" fill="#33504F">Paracetamol Tablets IP 650 mg</text></svg>`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-10">
      <h2 className="mb-6 text-section-sm md:text-section">{title}</h2>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-secondary font-semibold text-ink-3">{children}</p>;
}

export function DevComponentsScreen() {
  useDocumentTitle('Components');
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [view, setView] = useState<'grid' | 'timeline'>('grid');
  const [starred, setStarred] = useState(false);
  const [checked, setChecked] = useState(true);
  const [fileName, setFileName] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string>(sampleProfiles[0].id);
  const [cloudOn, setCloudOn] = useState(false);

  const profiles = sampleProfiles;
  const pdf = useMemo(() => placeholderPdf(['Cardiology prescription', '28 Oct 2026 - Dr. Kavita Rao', 'Amlodipine 10 mg - 1 tablet, morning', 'Synthetic sample document.']), []);
  const image = useMemo(() => new Blob([PACK_SVG], { type: 'image/svg+xml' }), []);
  const resolved = (what: string) => toast.show({ message: `Resolved: ${what}`, tone: 'success', action: { label: 'Undo', onClick: () => toast.show({ message: 'Undone' }) } });

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="page-gutter flex flex-wrap items-center justify-between gap-4 py-5">
          <Logo />
          <p className="text-secondary text-ink-3">Component gallery (private, not in navigation)</p>
        </div>
      </header>
      <main className="page-gutter pb-24 pt-8">
        <h1 className="text-page-sm md:text-page">Components</h1>
        <p className="mt-3 max-w-2xl text-ink-2">Every component from UI spec section 3 in each of its states, using the sample case.</p>

        <Section title="Type and colour">
          <p className="font-heading text-page-sm font-bold text-ink md:text-page">Page title, Manrope 700</p>
          <p className="mt-2 font-heading text-section-sm font-bold text-ink md:text-section">Section title</p>
          <p className="mt-2 text-card-sm font-semibold text-ink md:text-card">Card title, Inter 600</p>
          <p className="mt-2">Body text, Inter 400. A medicine counts as current only after you confirm it is taken.</p>
          <p className="mt-1 text-secondary text-ink-3">Secondary text</p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {['bg-ground', 'bg-surface-muted', 'bg-line', 'bg-teal', 'bg-teal-dark', 'bg-teal-tint', 'bg-blue-tint', 'bg-amber-tint', 'bg-red-tint', 'bg-grey-tint', 'bg-ink', 'bg-red-line'].map((c) => (
              <div key={c} className="rounded-panel border border-line bg-surface p-2">
                <div className={`h-12 rounded-[10px] ${c}`} />
                <p className="mt-1 text-min text-ink-3">{c.replace('bg-', '')}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Button">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="quiet">Quiet link</Button>
            <Button variant="danger">Danger</Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
            <Button cta>Prepare for the visit</Button>
            <Button to="/" variant="secondary">
              Link as button
            </Button>
            <Button size="sm" variant="secondary">
              Small
            </Button>
          </div>
        </Section>

        <Section title="Pill">
          <div className="flex flex-wrap gap-2">
            {(['confirmed_current', 'found_at_home', 'needs_confirmation', 'stopped'] as const).map((s) => (
              <Pill key={s} spec={medicineStatusPill(s)} />
            ))}
            <Pill spec={medicineStatusPill(med(IDS.medicines.amlodipine5))} />
            <Pill tone="check">Check this</Pill>
          </div>
        </Section>

        <Section title="Card, Panel, SectionHeader">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <SectionHeader level={3} title="Default card" aside="3 open" />
              <Panel>Inner panel</Panel>
            </Card>
            <Card tone="action">
              <SectionHeader level={3} title="Needs action" description="Red border for cards that need an answer." />
            </Card>
            <Card tone="muted">
              <h3 className="text-card-sm">Muted card</h3>
              <p className="mt-1 text-ink-2">Used for previous or stopped medicines.</p>
            </Card>
            <Card tone="dark">
              <p className="text-secondary font-semibold uppercase tracking-wide text-teal-tint">Next visit</p>
              <h3 className="mt-2 text-card">Wednesday, 18 November</h3>
              <p className="mt-1 text-white/85">Dr. Kavita Rao, cardiology</p>
            </Card>
          </div>
        </Section>

        <Section title="StatTile">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile size="lg" tone="teal" value={expected.statusCounts.confirmed_current} label="Confirmed current" />
            <StatTile size="lg" tone="amber" value={expected.statusCounts.needs_confirmation} label="Needs confirmation" />
            <StatTile size="lg" tone="red" value={1} label="Possible duplicate" />
            <StatTile size="lg" tone="grey" value={expected.statusCounts.stopped} label="Previous or stopped" />
            <StatTile tone="blue" value={expected.changeSummary.added} label="medicine added" />
            <StatTile tone="amber" value={expected.changeSummary.changed} label="dose changed" />
            <StatTile tone="red" value={expected.changeSummary.toConfirm} label="to confirm" />
            <StatTile tone="grey" value={expected.changeSummary.newDocuments} label="new reports" />
          </div>
        </Section>

        <Section title="Loading, empty and error">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Skeleton</Label>
              <Skeleton className="mb-3 h-8 w-2/3" />
              <SkeletonList count={1} />
            </div>
            <div>
              <Label>EmptyState</Label>
              <EmptyState icon={<Inbox />} title="Nothing needs your review" action={<Button variant="secondary">Scan a medicine</Button>}>
                Next visit: Wednesday, 18 November with Dr. Kavita Rao.
              </EmptyState>
            </div>
            <div>
              <Label>ErrorPanel</Label>
              <ErrorPanel message="Mock failure for review (localStorage.cvMockFail)." onRetry={() => toast.show({ message: 'Retrying' })} />
            </div>
          </div>
        </Section>

        <Section title="MedicineRow">
          <div className="flex flex-col gap-3">
            <MedicineRow
              medicine={med(IDS.medicines.atorvastatin10)}
              prescriberName="Dr. Kavita Rao"
              detail="not on Dr. Rao's prescription of 28 Oct"
              actions={
                <>
                  <Button variant="secondary">Still taking</Button>
                  <Button variant="secondary">Stopped</Button>
                  <Button className="col-span-2">Ask the doctor</Button>
                </>
              }
            />
            <MedicineRow medicine={med(IDS.medicines.dolo650)} actions={<Button variant="secondary" className="col-span-2">Confirm he takes this</Button>} />
            <MedicineRow medicine={med(IDS.medicines.amlodipine10)} prescriberName="Dr. Kavita Rao" />
            <MedicineRow medicine={med(IDS.medicines.amlodipine5)} prescriberName="Dr. Kavita Rao" />
          </div>
        </Section>

        <Section title="DocumentCard and TimelineItem">
          <SegmentedControl
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'grid', label: 'Grid', icon: <Grid2x2 aria-hidden className="size-4" /> },
              { value: 'timeline', label: 'Timeline', icon: <List aria-hidden className="size-4" /> },
            ]}
            className="mb-5"
          />
          {view === 'grid' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DocumentCard document={{ ...docV2(V2.documents.lipidProfile), starred }} onToggleStar={setStarred} note="Matched: test name" />
              <DocumentCard document={docV2(V2.documents.raoLatest)} extra="2 medicine changes found" />
              <DocumentCard document={docV2(V2.documents.hba1c)} />
            </div>
          ) : (
            <ol className="max-w-xl">
              {sampleDocumentsV2.map((d, i) => (
                <TimelineItem
                  key={d.id}
                  date={d.clinicalDate ? formatDate(d.clinicalDate) : `Added ${formatDate(d.addedAt)}`}
                  title={d.title}
                  type={d.kind}
                  to={`/records/${d.id}`}
                  last={i === sampleDocumentsV2.length - 1}
                />
              ))}
            </ol>
          )}
        </Section>

        <Section title="Toast, Dialog, ConfirmDialog, Sheet">
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => toast.show({ message: 'Saved to records', tone: 'success' })}>
              Success toast
            </Button>
            <Button variant="secondary" onClick={() => toast.show({ message: 'Could not save. Please try again.', tone: 'error' })}>
              Error toast
            </Button>
            <Button variant="secondary" onClick={() => resolved('still taking')}>
              Toast with Undo
            </Button>
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              Dialog
            </Button>
            <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
              ConfirmDialog
            </Button>
            <Button variant="secondary" onClick={() => setSheetOpen(true)}>
              Sheet
            </Button>
          </div>
          <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Share the passport" description="The passport is encrypted on this phone." footer={<Button onClick={() => setDialogOpen(false)}>Done</Button>}>
            <Field label="Expires after" as="select" options={[{ value: '2', label: '2 hours' }, { value: '8', label: '8 hours' }, { value: '24', label: '24 hours' }]} />
          </Dialog>
          <ConfirmDialog
            open={confirmOpen}
            title="Mark Atorvastatin 10 mg as stopped?"
            message="You can change this later."
            confirmLabel="Mark as stopped"
            pending={confirmPending}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() => {
              setConfirmPending(true);
              setTimeout(() => {
                setConfirmPending(false);
                setConfirmOpen(false);
                resolved('stopped');
              }, 700);
            }}
          />
          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Add a record" footer={<Button onClick={() => setSheetOpen(false)}>Save</Button>}>
            <FileDrop onFiles={(f) => setFileName(f[0]?.name ?? null)} selectedName={fileName} hint="Photo or PDF" />
          </Sheet>
        </Section>

        <Section title="Field, Checkbox, SegmentedControl, FileDrop">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-5">
              <Field label="Product name" defaultValue="Dolo 650" hint="As printed on the pack" />
              <Field label="How many per day" extracted defaultValue="" warnings={['How often it is taken was not found on the pack.']} inputMode="numeric" />
              <Field label="Birth year" defaultValue="19555" error="Please enter a year like 1955." />
              <Field label="Instruction" as="textarea" defaultValue="1 tablet, three times a day" />
              <Field label="Unit" as="select" defaultValue="mg" options={['mcg', 'mg', 'g', 'ml', 'IU'].map((u) => ({ value: u, label: u }))} />
            </div>
            <div className="flex flex-col gap-5">
              <div>
                <Checkbox label="Lipid profile, 12 Nov" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                <Checkbox label="HbA1c report, 12 Nov (not yet confirmed)" description="Confirm it in Records to share it." disabled />
              </div>
              <FileDrop onFiles={(f) => setFileName(f[0]?.name ?? null)} allowCamera selectedName={fileName} title="Photograph the medicine pack" hint="Flat surface, good light, composition text visible" />
              <FileDrop onFiles={() => {}} disabled title="Disabled while reading" />
            </div>
          </div>
        </Section>

        <Section title="SourceViewer">
          <div className="flex flex-col gap-8">
            <SourceViewer file={image} label="Photo of the Dolo 650 pack">
              <Field label="Product name" extracted defaultValue="Dolo 650" />
            </SourceViewer>
            <SourceViewer file={pdf} label="Cardiology prescription, 28 Oct 2026">
              <p className="text-ink-2">PDF page 1 rendered with pdf.js, loaded only when needed.</p>
            </SourceViewer>
            <SourceViewer file={null} label="Loading" />
          </div>
        </Section>

        <Section title="Shell pieces: TopNav, ProfileSwitcher, BottomTabs, CloudNotice">
          <div className="flex flex-col gap-6">
            <div className="overflow-hidden rounded-panel border border-line">
              <TopNav items={NAV_ITEMS} right={<ProfileSwitcher profiles={profiles} current={profiles.find((p) => p.id === profileId)!} onSelect={setProfileId} />} />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <ProfileSwitcher profiles={profiles} current={profiles.find((p) => p.id === profileId)!} onSelect={setProfileId} compact />
              <span className="text-secondary text-ink-3">Compact (phone)</span>
            </div>
            <div>
              <Label>BottomTabs (visible under 768 px)</Label>
              {/* The transform makes the fixed tab bar position itself inside this box. */}
              <div className="relative h-24 overflow-hidden rounded-panel border border-line [transform:translateZ(0)]">
                <BottomTabs items={NAV_ITEMS} />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button variant="secondary" className="self-start" onClick={() => setCloudOn((v) => !v)}>
                Toggle cloud notice
              </Button>
              <CloudNotice message={cloudOn ? 'Sending this photo to the cloud reader' : null} showOnDevice />
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}
