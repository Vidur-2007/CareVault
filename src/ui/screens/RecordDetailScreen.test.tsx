import '../test/configureTesting';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { IDS } from '../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/services';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createMockServicesV2 } from '../mock/v2/createMockServicesV2';
import { placeholderPdf } from '../mock/placeholderPdf';
import { detailsPatch, groupByMonth, isQuestionLike, matchedText, toQuery, validateDetails, NO_FILTERS, detailsFrom } from './records/recordsText';
import { dateSourceText, pagesText } from '../lib/labels';

const D = IDS.documents;

function renderAt(path: string, services: CareVaultServices = createMockServicesV2({ delayMs: 0, fail: () => null })) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App services={services} router={router} />);
  return { services, router };
}

const details = () => screen.getByRole('region', { name: 'Details' });
const row = (label: string) => within(details()).getByText(label).nextElementSibling?.textContent;

afterEach(() => {
  localStorage.removeItem('cv.profileId');
});

describe('record detail: metadata and actions', () => {
  it('shows an undated email record, its date source, and files it', async () => {
    const { services } = renderAt(`/records/${D.hba1c}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'HbA1c report' })).toBeInTheDocument();
    expect(document.title).toBe('HbA1c report · CareVault');
    expect(row('Date on the document')).toBe('Date not known · received by email on 12 Nov 2026');
    expect(row('Patient on the document')).toBe('Ramesh Iyer · matches Ramesh Iyer');
    expect(row('Facility')).toBe('Lakeside Diagnostics');
    expect(row('Tests')).toBe('HbA1c');
    expect(row('Pages')).toBe('Read 1 of 1 page');
    expect(row('How it was added')).toBe('PDF from email, 12 Nov 2026');
    expect(screen.getAllByText('Not yet filed').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'File it' }));
    expect(await screen.findByText('Filed in the records')).toBeInTheDocument();
    expect((await services.documents.get(D.hba1c)).state).toBe('filed');
    expect(await screen.findByText('Filed', { selector: 'span' })).toBeInTheDocument();
  });

  it('shows "Read 2 of 5 pages" and a mismatched patient name', async () => {
    const services = createMockServicesV2({ delayMs: 0, fail: () => null });
    const file = new File([placeholderPdf(['scan'])], 'scan-5-pages-mismatch.pdf', { type: 'application/pdf' });
    const { record } = await services.documents.add(IDS.ramesh, file, { source: 'upload' });
    await services.reading.read(record.id, { allowCloud: false });
    renderAt(`/records/${record.id}`, services);
    await screen.findByRole('heading', { level: 1 });
    expect(row('Pages')).toBe('Read 2 of 5 pages');
    expect(row('Patient on the document')).toBe('Sunita Rao · does not match Ramesh Iyer');
    expect(screen.getByText('Name does not match')).toBeInTheDocument();
  });

  it('edits the details; a typed date becomes "Date set by you"', async () => {
    const { services } = renderAt(`/records/${D.ecg}`);
    await screen.findByRole('heading', { level: 1, name: 'ECG report' });
    expect(row('Date on the document')).toBe('15 Sep 2026 · Date from the document');

    await userEvent.click(screen.getByRole('button', { name: 'Edit the details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit the details' });
    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save the details' }));
    expect(title).toHaveFocus();
    expect(title).toHaveAccessibleDescription(/Please give the record a title/);

    await userEvent.type(title, 'Resting ECG');
    fireEvent.change(within(dialog).getByLabelText('Date on the document'), { target: { value: '2026-09-16' } });
    await userEvent.selectOptions(within(dialog).getByLabelText('Doctor'), 'Dr. Kavita Rao, Cardiology');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save the details' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Resting ECG' })).toBeInTheDocument();
    expect(row('Date on the document')).toBe('16 Sep 2026 · Date set by you');
    expect(row('Doctor')).toBe('Dr. Kavita Rao, Cardiology');
    expect(await services.documents.get(D.ecg)).toMatchObject({ title: 'Resting ECG', clinicalDate: '2026-09-16', dateSource: 'user', prescriberId: IDS.prescribers.rao });
  });

  it('stars a record', async () => {
    const { services } = renderAt(`/records/${D.lipidProfile}`);
    await screen.findByRole('heading', { level: 1, name: 'Lipid profile' });
    await userEvent.click(screen.getByRole('button', { name: 'Star' }));
    expect(await screen.findByRole('button', { name: 'Starred' })).toHaveAttribute('aria-pressed', 'true');
    expect((await services.documents.get(D.lipidProfile)).starred).toBe(true);
  });

  it('lists a prescription’s medicines with their verification state', async () => {
    renderAt(`/records/${D.raoLatest}`);
    const section = (await screen.findByRole('heading', { level: 2, name: 'Medicines on this prescription' })).closest('section')!;
    expect(await within(section).findByText('Amlodipine 10 mg')).toBeInTheDocument();
    expect(within(section).getAllByText('Checked')).toHaveLength(3);
  });

  it("never shows another profile's record", async () => {
    localStorage.setItem('cv.profileId', IDS.lakshmi);
    renderAt(`/records/${D.lipidProfile}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Record not found' })).toBeInTheDocument();
    expect(screen.queryByText('Lakeside Diagnostics')).toBeNull();
  });
});

describe('record detail: delete', () => {
  async function withSharedSnapshot() {
    const services = createMockServicesV2({ delayMs: 0, fail: () => null });
    const snapshot = await services.passport.snapshot(IDS.ramesh, 'share');
    const link = await services.sharing.create(snapshot.id, 24);
    return { services, snapshot, link };
  }

  it('lists the passports that mention it and turns off their links', async () => {
    const { services, snapshot, link } = await withSharedSnapshot();
    const { router } = renderAt(`/records/${D.lipidProfile}`, services);
    await screen.findByRole('heading', { level: 1, name: 'Lipid profile' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete this record' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete Lipid profile?' });
    const list = await within(dialog).findByRole('list', { name: 'Saved passports that list this record' });
    expect(within(list).getByText(/^Passport revision 1, shared on \d+ \w{3} \d{4}$/)).toBeInTheDocument();
    const revoke = within(dialog).getByRole('checkbox', { name: 'Also turn off the active link to this passport' });
    expect(revoke).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Deleted Lipid profile and turned off one link')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/records');
    await expect(services.documents.get(D.lipidProfile)).rejects.toMatchObject({ code: 'not_found' });
    expect((await services.sharing.list(IDS.ramesh)).find((l) => l.id === link.id)?.revoked).toBe(true);
    const kept = await services.passport.getSnapshot(snapshot.id);
    expect(kept.passport.documents.find((d) => d.documentId === D.lipidProfile)?.removedAt).not.toBeNull();
  });

  it('keeps the links active when the box is cleared', async () => {
    const { services, link } = await withSharedSnapshot();
    renderAt(`/records/${D.ecg}`, services);
    await screen.findByRole('heading', { level: 1, name: 'ECG report' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete this record' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete ECG report?' });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Also turn off/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Deleted ECG report')).toBeInTheDocument();
    expect((await services.sharing.list(IDS.ramesh)).find((l) => l.id === link.id)?.revoked).toBe(false);
  });

  it('says so when no passport lists the record, and Cancel keeps it', async () => {
    const { services } = renderAt(`/records/${D.menon}`);
    await screen.findByRole('heading', { level: 1, name: 'Diabetes prescription' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete this record' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Diabetes prescription?' });
    expect(await within(dialog).findByText('No saved passport lists this record.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect((await services.documents.get(D.menon)).id).toBe(D.menon);
  });
});

describe('records helpers', () => {
  it('groups undated records last, keeping the given order', () => {
    const doc = (id: string, clinicalDate: string | null) => ({ id, clinicalDate }) as never;
    const groups = groupByMonth([doc('a', null), doc('b', '2026-11-12'), doc('c', '2026-10-01'), doc('d', '2026-11-01')], (x) => x);
    expect(groups.map((g) => [g.label, g.items.map((i: { id: string }) => i.id)])).toEqual([
      ['November 2026', ['b', 'd']], ['October 2026', ['c']], ['Date not known', ['a']],
    ]);
  });

  it('builds the query, the matched text and question detection', () => {
    expect(toQuery({ ...NO_FILTERS, text: ' lipid ', kind: 'lab_report', facility: 'Lakeside Diagnostics', from: '2026-01-01' }))
      .toEqual({ sort: 'newest', text: 'lipid', kinds: ['lab_report'], facility: 'Lakeside Diagnostics', from: '2026-01-01' });
    expect(matchedText(['test name', 'doctor'])).toBe('Matched: test name, doctor');
    expect(matchedText([])).toBeNull();
    expect(isQuestionLike('latest lipid profile')).toBe(true);
    expect(isQuestionLike('prescriptions from my cardiologist')).toBe(true);
    expect(isQuestionLike('lipid profile')).toBe(false);
    expect(isQuestionLike('lipid')).toBe(false);
  });

  it('validates and patches the details', async () => {
    const services = createMockServicesV2({ delayMs: 0, fail: () => null });
    const doc = await services.documents.get(D.hba1c);
    const values = detailsFrom(doc);
    expect(validateDetails({ ...values, clinicalDate: '2026-11-20' }, '2026-11-14').clinicalDate).toMatch(/future/);
    expect(detailsPatch(doc, values)).toEqual({});
    expect(detailsPatch(doc, { ...values, clinicalDate: '2026-11-10', tags: 'Blood test, Diabetes' }))
      .toEqual({ clinicalDate: '2026-11-10', tags: ['blood test', 'diabetes'] });
    expect(dateSourceText({ ...doc, clinicalDate: '2026-11-10', dateSource: 'user' })).toBe('Date set by you');
    expect(pagesText({ pageCount: null, pagesRead: null })).toBeNull();
    expect(pagesText({ pageCount: 3, pagesRead: 3 })).toBe('Read all 3 pages');
  });
});
