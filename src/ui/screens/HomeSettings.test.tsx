import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDS } from '../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/services';
import type { AttentionItem } from '../../contract/types';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { markGmailConnected } from '../lib/gmailSession';
import { createMockServicesV2 } from '../mock/v2/createMockServicesV2';
import { attentionAction, HOME_KINDS, homeItems } from './home/homeText';

const make = () => createMockServicesV2({ delayMs: 0, fail: () => null });

function renderAt(path: string, services: CareVaultServices) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App services={services} router={router} />);
  return router;
}

const rows = () => within(screen.getByRole('list', { name: 'PDF attachments' })).getAllByRole('listitem');
const row = (fileName: string) => rows().find((r) => r.textContent?.includes(fileName))!;

afterEach(() => {
  localStorage.removeItem('cv.profileId');
  markGmailConnected(false);
});

// ---------- Gmail import (4.10) ----------

describe('Gmail import', () => {
  it('lists one row per PDF attachment: two attachments of one email are separate rows, imported separately', async () => {
    const s = make();
    const before = (await s.documents.list(IDS.ramesh)).length;
    renderAt('/records/add?from=gmail', s);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Gmail' }));
    await waitFor(() => expect(rows()).toHaveLength(3));

    const candidates = await s.gmail.findCandidates(IDS.ramesh);
    const sameEmail = candidates.filter((c) => c.subject === 'Your reports are ready');
    expect(sameEmail).toHaveLength(2);
    expect(new Set(sameEmail.map((c) => c.messageId)).size).toBe(1);
    for (const c of sameEmail) {
      const r = row(c.attachmentName);
      expect(within(r).getByRole('checkbox', { name: new RegExp(c.attachmentName) })).toBeChecked();
      expect(r).toHaveTextContent(`Your reports are ready · ${c.from} · received 13 Nov 2026`);
    }

    // Import the two attachments of that email only.
    await userEvent.click(within(row('chest-xray-2026-11-02.pdf')).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 reports' }));
    // Each joins the add flow at step 2, one after the other.
    expect(await screen.findByRole('heading', { level: 1, name: 'The details' })).toBeInTheDocument();
    const added = (await s.documents.list(IDS.ramesh)).filter((d) => d.source === 'email' && d.id !== IDS.documents.hba1c);
    expect((await s.documents.list(IDS.ramesh)).length).toBe(before + 2);
    expect(added.map((d) => d.title).sort()).toEqual(['Complete blood count', 'Kidney function test']);
  });

  it('"Already imported" is per profile', async () => {
    const s = make();
    const [kidney] = (await s.gmail.connect(), await s.gmail.findCandidates(IDS.ramesh));
    await s.gmail.importAttachment(IDS.ramesh, kidney.messageId, kidney.attachmentId);

    renderAt('/records/add?from=gmail', s);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Gmail' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(row(kidney.attachmentName)).toHaveTextContent('Already imported');
    expect(within(row(kidney.attachmentName)).getByRole('checkbox')).not.toBeChecked();
    expect(row('cbc-2026-11-13.pdf')).not.toHaveTextContent('Already imported');
    expect(screen.getByRole('button', { name: 'Import 2 reports' })).toBeInTheDocument();

    // For Lakshmi the same attachment has not been imported.
    expect((await s.gmail.findCandidates(IDS.lakshmi)).every((c) => !c.alreadyImported)).toBe(true);
  });
});

// ---------- Home (4.2) ----------

const fake = (kind: string, title: string, documentId: string | null = null): AttentionItem =>
  ({ id: `${kind}:${title}`, kind, title, body: `${title} body`, documentId, medicineIds: [] }) as AttentionItem;

describe('Home', () => {
  it('shows the passport card, the next visit, Add a record, the Ask box and the three newest records', async () => {
    const s = make();
    const router = renderAt('/', s);
    expect(await screen.findByRole('heading', { level: 1, name: 'Ramesh Iyer' })).toBeInTheDocument();
    expect(document.title).toBe('Home · CareVault');
    expect(screen.getByText('Father · 71 years · cared for by Anjali Iyer')).toBeInTheDocument();

    const passport = screen.getByRole('region', { name: 'Passport' });
    expect(await within(passport).findByText('6 medicines being taken')).toBeInTheDocument();
    expect(within(passport).getByText('Atorvastatin 10 mg')).toBeInTheDocument();
    expect(within(passport).getByText('Allergies: Sulfa drugs: rash')).toBeInTheDocument();
    expect(within(passport).getByRole('link', { name: 'Open the passport' })).toHaveAttribute('href', '/passport');

    const visit = screen.getByRole('region', { name: 'Wednesday, 18 November' });
    expect(visit).toHaveTextContent('Dr. Kavita Rao · 10:30 am');
    expect(within(visit).getByRole('link', { name: 'Prepare for the visit' })).toHaveAttribute('href', '/passport');

    expect(screen.getByRole('link', { name: 'Add a record' })).toHaveAttribute('href', '/records/add');
    const newest = [...(await s.documents.list(IDS.ramesh))].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 3);
    const recent = await screen.findByRole('list', { name: 'Recently added records' });
    expect(within(recent).getAllByRole('heading').map((h) => h.textContent)).toEqual(newest.map((d) => d.title));

    await userEvent.type(screen.getByRole('searchbox', { name: 'Your question' }), 'latest lipid profile');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ask'));
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe('latest lipid profile');
  });

  it('"Needs attention" shows only the four kinds, each with its one action, and never a medicine-status question', async () => {
    const s = make();
    const real = await s.attention.list(IDS.ramesh);
    expect(real.map((a) => a.kind)).toEqual(['possible_duplicate_ingredient']);
    vi.spyOn(s.attention, 'list').mockResolvedValue([
      fake('unverified_fields', 'Check one value in Cardiology prescription', 'doc-1'),
      fake('confirm_medicine', 'Is he still taking Atorvastatin 10 mg?'),
      fake('unassigned_import', 'Chest X-ray may be for someone else', 'doc-2'),
      ...real,
      fake('new_document', 'New report from email'),
      fake('legacy_routine_review', '2 medicines from the earlier version need a look'),
    ]);
    renderAt('/', s);
    const section = await screen.findByRole('region', { name: 'Needs attention' });
    const cards = within(section).getAllByRole('article');
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual([
      'Check one value in Cardiology prescription', 'Chest X-ray may be for someone else', real[0].title, '2 medicines from the earlier version need a look',
    ]);
    expect(within(cards[0]).getByRole('link', { name: 'Check the values' })).toHaveAttribute('href', '/records/doc-1/verify');
    expect(within(cards[1]).getByRole('button', { name: 'Choose whose record this is' })).toBeInTheDocument();
    expect(within(cards[2]).getByRole('link', { name: 'Review the products' })).toHaveAttribute('href', '/passport#duplicates');
    expect(within(cards[3]).getByRole('link', { name: 'Choose the medicines he still takes' })).toHaveAttribute('href', '/passport#legacy-review');
    for (const c of cards) expect(within(c).queryAllByRole('link').length + within(c).queryAllByRole('button').length).toBe(1);

    // Nothing asks about a medicine's status or a prescription review.
    expect(screen.queryByText(/still taking|New report from email/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /still taking|stopped|not sure|review changes/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /review changes/i })).toBeNull();
  });

  it('shows nothing at all when no attention is needed (no "everything is done" banner)', async () => {
    localStorage.setItem('cv.profileId', IDS.lakshmi);
    renderAt('/', make());
    expect(await screen.findByRole('heading', { level: 1, name: 'Lakshmi Iyer' })).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Recently added records' });
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
    expect(screen.queryByText(/all done|nothing needs|up to date/i)).toBeNull();
    expect(screen.getByText('No known allergies')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /November/ })).toBeNull(); // no visit
  });

  it('an email import for someone else: Choose whose record this is', async () => {
    const s = make();
    await s.gmail.connect();
    const xray = (await s.gmail.findCandidates(IDS.ramesh)).find((c) => c.attachmentName.startsWith('chest-xray'))!;
    const { record } = await s.gmail.importAttachment(IDS.ramesh, xray.messageId, xray.attachmentId);
    expect((await s.attention.list(IDS.ramesh)).map((a) => a.kind)).toContain('unassigned_import');

    renderAt('/', s);
    const section = await screen.findByRole('region', { name: 'Needs attention' });
    await userEvent.click(within(section).getByRole('button', { name: 'Choose whose record this is' }));
    const dialog = await screen.findByRole('dialog', { name: 'Whose record is this?' });
    await userEvent.click(within(dialog).getByRole('radio', { name: /Lakshmi Iyer/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: "It is Lakshmi's record" }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await s.documents.get(record.id)).profileId).toBe(IDS.lakshmi);
    await waitFor(() => expect(screen.queryByText(/may be for someone else/)).toBeNull());
  });

  it('shows the Gmail status when connected this session', async () => {
    const s = make();
    renderAt('/', s);
    await screen.findByRole('heading', { level: 1, name: 'Ramesh Iyer' });
    expect(screen.queryByText(/Gmail connected for this session/)).toBeNull();
    markGmailConnected();
    expect(await screen.findByText(/Gmail connected for this session/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check for new reports' })).toHaveAttribute('href', '/records/add?from=gmail');
  });

  it('helpers: the four kinds and their actions', () => {
    expect(HOME_KINDS).toEqual(['unverified_fields', 'unassigned_import', 'possible_duplicate_ingredient', 'legacy_routine_review']);
    expect(homeItems([fake('confirm_medicine', 'x'), fake('legacy_routine_review', 'y')]).map((i) => i.kind)).toEqual(['legacy_routine_review']);
    expect(attentionAction(fake('legacy_routine_review', 'y'), { relation: 'Mother' }).label).toBe('Choose the medicines she still takes');
    expect(attentionAction(fake('legacy_routine_review', 'y'), { relation: 'Myself' }).label).toBe('Choose the medicines I still take');
  });
});

// ---------- Settings (4.13) ----------

describe('Settings', () => {
  it('older share links come from sharing.listUnowned and can be revoked', async () => {
    const s = make();
    const unowned = await s.sharing.listUnowned();
    expect(unowned).toHaveLength(1);
    expect(unowned[0]).toMatchObject({ profileId: null, snapshotId: null, revoked: false });
    // They are never one profile's links.
    expect((await s.sharing.list(IDS.ramesh)).some((l) => l.id === unowned[0].id)).toBe(false);

    renderAt('/settings', s);
    const section = await screen.findByRole('region', { name: 'Older share links' });
    const list = await within(section).findByRole('list', { name: 'Older share links' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.click(within(list).getByRole('button', { name: /^Revoke the earlier passport link/ }));
    expect(await within(section).findByText('No older links are open.')).toBeInTheDocument();
    expect((await s.sharing.listUnowned())[0].revoked).toBe(true);
  });

  it('edits a profile and its emergency contact, adds a doctor, and switches profile', async () => {
    const s = make();
    renderAt('/settings', s);
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(document.title).toBe('Settings · CareVault');

    await userEvent.click(screen.getByRole('button', { name: 'Edit Ramesh Iyer' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit the profile' });
    const contact = within(sheet).getByLabelText('Emergency contact (optional)');
    expect(contact).toHaveValue('Anjali Iyer, +91 90000 00000');
    await userEvent.clear(contact);
    await userEvent.type(contact, 'Anjali Iyer, +91 90000 22222');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save the changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await s.profiles.list()).find((p) => p.id === IDS.ramesh)?.emergencyContact).toBe('Anjali Iyer, +91 90000 22222');
    expect(await screen.findByText('Emergency contact: Anjali Iyer, +91 90000 22222')).toBeInTheDocument();

    const doctors = screen.getByRole('region', { name: 'Doctors of Ramesh Iyer' });
    expect(within(doctors).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Dr. Kavita Rao, Cardiology', 'Dr. Suresh Menon, Diabetology']);
    await userEvent.click(within(doctors).getByRole('button', { name: 'Add the doctor' }));
    expect(within(doctors).getByLabelText("Doctor's name")).toHaveAccessibleDescription(/Please type the doctor's name/);
    await userEvent.type(within(doctors).getByLabelText("Doctor's name"), 'Dr. Priya Shah');
    await userEvent.type(within(doctors).getByLabelText('Specialty (optional)'), 'Nephrology');
    await userEvent.click(within(doctors).getByRole('button', { name: 'Add the doctor' }));
    await waitFor(() => expect(within(doctors).getAllByRole('listitem')).toHaveLength(3));
    expect((await s.profiles.prescribers(IDS.ramesh)).map((d) => d.name)).toContain('Dr. Priya Shah');

    await userEvent.click(screen.getByRole('button', { name: 'Switch to Lakshmi Iyer' }));
    expect(await screen.findByRole('region', { name: 'Doctors of Lakshmi Iyer' })).toBeInTheDocument();
  });

  it('cloud reading, Gmail for this session, backup with its version note, and sample data', async () => {
    const s = make();
    const connect = vi.spyOn(s.gmail, 'connect');
    const load = vi.spyOn(s.profiles, 'loadSampleProfile');
    const router = renderAt('/settings', s);
    await screen.findByRole('heading', { level: 1, name: 'Settings' });

    const toggle = await screen.findByRole('switch', { name: /Send hard-to-read pages without asking/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect((await s.settings.get()).cloudReadingAllowed).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Connect Gmail for this session' }));
    expect(connect).toHaveBeenCalledTimes(1);
    const gmail = screen.getByRole('region', { name: 'Gmail' });
    expect(await within(gmail).findByText(/Gmail connected for this session/)).toBeInTheDocument();

    const backup = screen.getByRole('region', { name: 'Backup' });
    expect(within(backup).getByText('Backups made with earlier versions can still be restored.')).toBeInTheDocument();
    expect(within(backup).getByRole('button', { name: 'Save backup file' })).toBeInTheDocument();
    expect(within(backup).getByRole('button', { name: 'Restore backup' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load the sample profiles' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    await userEvent.click(within(gmail).getByRole('link', { name: 'Check for new reports' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/records/add'));
    expect(await screen.findByRole('button', { name: 'Connect Gmail' })).toBeInTheDocument();
  });
});
