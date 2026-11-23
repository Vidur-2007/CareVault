import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { expected, IDS } from '../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/services';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createMockServices } from '../mock/createMockServices';
import { createMockServicesV2 } from '../mock/v2/createMockServicesV2';

const M = IDS.medicines;

function renderPassport(services: CareVaultServices = createMockServicesV2({ delayMs: 0, fail: () => null })) {
  const router = createMemoryRouter(routes, { initialEntries: ['/passport'] });
  render(<App services={services} router={router} />);
  return { services, router };
}

const ready = () => screen.findByRole('list', { name: 'Current medicines' });
const currentNames = () => within(screen.getByRole('list', { name: 'Current medicines' })).getAllByRole('link').map((a) => a.querySelector('span span')?.textContent);

afterEach(() => {
  localStorage.removeItem('cv.profileId');
});

describe('Passport: the live passport', () => {
  it('shows the patient strip, the visit and every section from the sample case', async () => {
    renderPassport();
    expect(await screen.findByRole('heading', { level: 1, name: 'Passport' })).toBeInTheDocument();
    await ready();
    expect(document.title).toBe('Passport · CareVault');
    expect(screen.getByText(/· 71 years/).closest('p')).toHaveTextContent('Ramesh Iyer · 71 years · Father');
    expect(screen.getByText(/Emergency contact: Anjali Iyer, \+91 90000 00000/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wednesday, 18 November' })).toBeInTheDocument();

    // Current medicines, in the passport order, with source and last confirmed.
    expect(currentNames()).toEqual(expected.ramesh.passport.currentMedicineNames);
    const dolo = screen.getByRole('link', { name: /^Dolo 650/ });
    expect(dolo).toHaveAttribute('href', `/passport/medicines/${M.dolo650}`);
    expect(within(dolo).getByText('From the pack · Last confirmed 10 Nov')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /^Amlodipine 10 mg/ })).getByText('Reported by Anjali · Dr. Kavita Rao · Last confirmed 30 Oct')).toBeInTheDocument();

    // Not confirmed, allergies, conditions, questions, reports.
    const unconfirmed = screen.getByRole('list', { name: 'Current use not confirmed' });
    expect(within(unconfirmed).getByText('Atorvastatin 10 mg')).toBeInTheDocument();
    expect(within(unconfirmed).getByText('Current use not confirmed')).toBeInTheDocument();
    expect(screen.getByText('Sulfa drugs: rash')).toBeInTheDocument();
    expect(screen.getByText('High blood pressure')).toBeInTheDocument();
    expect(screen.getByText('Type 2 diabetes')).toBeInTheDocument();
    for (const q of expected.ramesh.passport.questions) expect(screen.getByText(q)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Lipid profile/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /ECG report/ })).toBeChecked();
    expect(screen.getAllByRole('checkbox', { name: /Cardiology prescription/ }).every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByRole('checkbox', { name: /HbA1c/ })).toBeNull(); // not filed
    expect(await screen.findByText('Started Rosuvastatin 10 mg')).toBeInTheDocument();
    expect(screen.getByText(/None yet/)).toBeInTheDocument();
  });

  it('saves a snapshot, and reuses it when nothing changed', async () => {
    renderPassport();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Save a snapshot' }));
    expect(await screen.findByText('Saved as passport 1')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /^Passport 1 · \d+ \w{3} \d{4} · saved$/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save a snapshot' }));
    expect(await screen.findByText('Nothing changed since passport 1. It is kept as it is.')).toBeInTheDocument();
  });
});

describe('Passport: the reported routine', () => {
  it('adds a medicine typed by hand, without a prescription, as taken', async () => {
    const { services } = renderPassport();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Add a medicine he takes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a medicine he takes' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add the medicine' }));
    expect(within(dialog).getByLabelText('Medicine name')).toHaveFocus();
    expect(within(dialog).getByLabelText('Medicine name')).toHaveAccessibleDescription(/Please enter the medicine name/);

    await userEvent.type(within(dialog).getByLabelText('Medicine name'), 'Pantocid 40');
    await userEvent.type(within(dialog).getByLabelText('Ingredient 1'), 'Pantoprazole');
    await userEvent.type(within(dialog).getByLabelText('Strength'), '40');
    await userEvent.type(within(dialog).getByLabelText('Doses a day (optional)'), '1');
    await userEvent.type(within(dialog).getByLabelText('How it is taken (optional)'), '1 tablet, before breakfast');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add the medicine' }));

    expect(await screen.findByText('Pantocid 40 added to the current medicines')).toBeInTheDocument();
    await waitFor(() => expect(currentNames()).toContain('Pantocid 40'));
    const added = (await services.routine.list(IDS.ramesh)).find((m) => m.productName === 'Pantocid 40')!;
    expect(added).toMatchObject({
      status: 'taking', source: 'caregiver_reported', sourceDocumentId: null, prescriberId: null, dosesPerDay: 1,
      ingredients: [{ name: 'pantoprazole', strength: 40, unit: 'mg' }],
    });
  });

  it('asks before marking an unconfirmed medicine as stopped', async () => {
    const { services } = renderPassport();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Atorvastatin 10 mg: stopped' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark Atorvastatin 10 mg as stopped?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect((await services.routine.get(M.atorvastatin10)).status).toBe('uncertain');

    await userEvent.click(screen.getByRole('button', { name: 'Atorvastatin 10 mg: stopped' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark as stopped' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Current use not confirmed' })).toBeNull());
    expect((await services.routine.get(M.atorvastatin10)).status).toBe('stopped');
  });

  it('"Still taking" moves an unconfirmed medicine to the current ones', async () => {
    renderPassport();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Atorvastatin 10 mg: still taking' }));
    await waitFor(() => expect(currentNames()).toContain('Atorvastatin 10 mg'));
  });

  it('settles earlier (v1) medicines in one batch, and never blocks a snapshot', async () => {
    const v1 = createMockServices({ delayMs: 0, fail: () => null });
    const services = createMockServicesV2({ delayMs: 0, seeded: false, fail: () => null });
    await services.backup.import(await v1.backup.export('correct horse'), 'correct horse');
    const [profile] = await services.profiles.list();
    const pending = (await services.routine.list(profile.id)).filter((m) => m.legacyReviewPending);
    expect(pending.length).toBeGreaterThan(1);
    renderPassport(services);

    const batch = (await screen.findByRole('heading', { name: 'Choose the medicines he still takes' })).closest('section')!;
    // Printing and sharing use snapshots: one can be saved while the review is pending.
    await userEvent.click(screen.getByRole('button', { name: 'Save a snapshot' }));
    expect(await screen.findByText('Saved as passport 1')).toBeInTheDocument();
    const snapshot = (await services.passport.snapshots(profile.id))[0];
    expect(snapshot.passport.unconfirmed.map((u) => u.productName).sort()).toEqual(pending.map((m) => m.productName).sort());

    const keep = pending[0];
    await userEvent.click(within(batch).getByRole('checkbox', { name: new RegExp(`^${keep.productName}`) }));
    await userEvent.click(within(batch).getByRole('button', { name: `Save: 1 still taken, ${pending.length - 1} stopped` }));
    expect(await screen.findByText('The earlier medicines are settled')).toBeInTheDocument();
    const after = await services.routine.list(profile.id);
    expect(after.filter((m) => m.legacyReviewPending)).toEqual([]);
    expect(after.find((m) => m.id === keep.id)?.status).toBe('taking');
    expect(after.filter((m) => pending.slice(1).some((p) => p.id === m.id)).every((m) => m.status === 'stopped')).toBe(true);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Choose the medicines he still takes' })).toBeNull());
  });
});

describe('Passport: allergies and history', () => {
  it('shows the three allergy states: listed, not recorded and no known allergies', async () => {
    const { services } = renderPassport();
    await ready();
    const card = () => screen.getByRole('region', { name: 'Allergies' });
    expect(within(card()).getByText('1 allergy')).toBeInTheDocument();

    await userEvent.click(within(card()).getByRole('button', { name: 'Remove Sulfa drugs: rash' }));
    expect(await within(card()).findByText('Not recorded')).toBeInTheDocument();
    expect((await services.passport.live(IDS.ramesh)).allergies.state).toBe('not_recorded');

    await userEvent.click(within(card()).getByRole('button', { name: 'No known allergies' }));
    expect(await within(card()).findByText('No known allergies', { selector: 'span' })).toBeInTheDocument();
    expect((await services.passport.live(IDS.ramesh)).allergies.state).toBe('none_known');

    await userEvent.click(within(card()).getByRole('button', { name: 'Add an allergy' }));
    await userEvent.type(within(card()).getByLabelText('New allergy'), 'Penicillin: rash');
    await userEvent.click(within(card()).getByRole('button', { name: 'Add' }));
    expect(await within(card()).findByText('Penicillin: rash')).toBeInTheDocument();
    expect(await services.passport.live(IDS.ramesh)).toMatchObject({ allergies: { state: 'listed', items: ['Penicillin: rash'] } });
  });

  it('adds and removes conditions and procedures', async () => {
    renderPassport();
    await ready();
    const procedures = screen.getByRole('region', { name: 'Procedures' });
    expect(within(procedures).getByText('No procedures recorded.')).toBeInTheDocument();
    await userEvent.click(within(procedures).getByRole('button', { name: 'Add a procedure' }));
    await userEvent.type(within(procedures).getByLabelText('New procedure'), 'Cataract surgery, 2021');
    await userEvent.click(within(procedures).getByRole('button', { name: 'Add' }));
    expect(await within(procedures).findByText('Cataract surgery, 2021')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('region', { name: 'Conditions' })).getByRole('button', { name: 'Remove Type 2 diabetes' }));
    await waitFor(() => expect(screen.queryByText('Type 2 diabetes')).toBeNull());
  });
});

describe('Passport: possible duplicate ingredients', () => {
  it('shows the products side by side and the complete daily total', async () => {
    renderPassport();
    await ready();
    const card = screen.getByRole('article', { name: 'Paracetamol in two medicines' });
    expect(within(card).getByText('Possible duplicate ingredient')).toBeInTheDocument();
    expect(within(card).getByTestId('duplicate-total')).toHaveTextContent('3,450 mg a day');
    expect(within(card).getByText('1,950 mg + 1,500 mg of paracetamol')).toBeInTheDocument();
    expect(within(card).getByText('These medicines may contain the same active ingredient. Please verify them with a pharmacist or prescriber.')).toBeInTheDocument();
  });

  it('gives no total when how often one is taken is not known', async () => {
    const services = createMockServicesV2({ delayMs: 0, fail: () => null });
    await services.routine.update(M.dolo650, { dosesPerDay: null, instruction: '' });
    renderPassport(services);
    await ready();
    const card = screen.getByRole('article', { name: 'Paracetamol in two medicines' });
    expect(within(card).queryByTestId('duplicate-total')).toBeNull();
    expect(within(card).getByText(/No total/)).toBeInTheDocument();
    expect(within(card).getByText('Dolo 650: how often not entered')).toBeInTheDocument();
    expect(within(card).getByText('Crocin Advance 500: 1,500 mg a day as entered')).toBeInTheDocument();
  });
});

describe('Passport: visit, questions and reports', () => {
  it('adds and removes a question, and chooses the reports to share', async () => {
    const { services } = renderPassport();
    await ready();
    const questions = screen.getByRole('region', { name: 'Questions for the doctor' });
    await userEvent.type(within(questions).getByLabelText('New question'), 'Should the sugar test be repeated?');
    await userEvent.click(within(questions).getByRole('button', { name: 'Add' }));
    expect(await within(questions).findByText('Should the sugar test be repeated?')).toBeInTheDocument();
    await userEvent.click(within(questions).getByRole('button', { name: 'Remove the question: Should the sugar test be repeated?' }));
    await waitFor(() => expect(within(questions).queryByText('Should the sugar test be repeated?')).toBeNull());

    await userEvent.click(screen.getByRole('checkbox', { name: /Cardiology prescription/, description: /28 Oct 2026/ }));
    await waitFor(async () => expect((await services.visits.next(IDS.ramesh))?.sharedDocumentIds).toContain(IDS.documents.raoLatest));
  });

  it('adds the next visit for a profile with none', async () => {
    localStorage.setItem('cv.profileId', IDS.lakshmi);
    const { services } = renderPassport();
    await ready();
    expect(screen.getByRole('heading', { name: 'No visit planned yet' })).toBeInTheDocument();
    expect(screen.getByText('Add the next visit to keep questions for it.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add the next visit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add the next visit' });
    await userEvent.type(within(dialog).getByLabelText('Date'), '2026-11-25');
    await userEvent.type(within(dialog).getByLabelText('Time'), '09:15');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save the visit' }));
    expect(await screen.findByRole('heading', { name: 'Wednesday, 25 November' })).toBeInTheDocument();
    expect((await services.visits.next(IDS.lakshmi))?.prescriberId).toBe(IDS.prescribers.khan);
  });
});
