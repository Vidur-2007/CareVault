import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDS } from '../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/services';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { placeholderPdf } from '../mock/placeholderPdf';
import { createMockServicesV2 } from '../mock/v2/createMockServicesV2';

const pdf = (name: string, text = name) => new File([placeholderPdf([text])], name, { type: 'application/pdf' });
const photo = (name: string, bytes = [1, 2, 3]) => new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });

function renderAdd(opts: { fail?: string | null; services?: CareVaultServices; path?: string } = {}) {
  const services = opts.services ?? createMockServicesV2({ delayMs: 0, fail: () => opts.fail ?? null });
  const router = createMemoryRouter(routes, { initialEntries: [opts.path ?? '/records/add'] });
  render(<App services={services} router={router} />);
  return { services, router };
}

async function choose(file: File) {
  await userEvent.upload(await screen.findByLabelText('Choose a photo or PDF'), file);
}

const h1 = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });
const card = (name: string) => screen.getByRole('article', { name });

afterEach(() => {
  localStorage.removeItem('cv.profileId');
});

describe('add a record: saved first, duplicates', () => {
  async function withExisting() {
    const services = createMockServicesV2({ delayMs: 0, fail: () => null });
    const { record } = await services.documents.add(IDS.ramesh, pdf('first.pdf', 'same bytes'), { source: 'upload' });
    return { services, existing: record, count: (await services.documents.list(IDS.ramesh)).length };
  }

  it('"Use the existing record" removes the new copy and opens the existing one', async () => {
    const { services, existing, count } = await withExisting();
    const { router } = renderAdd({ services });
    await choose(pdf('again.pdf', 'same bytes'));
    expect(await screen.findByText(/This file is already in the records \(added \d+ \w+ \d{4}\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use the existing record' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/records/${existing.id}`));
    expect(await services.documents.list(IDS.ramesh)).toHaveLength(count);
  });

  it('"Keep both" keeps the new copy and reads it', async () => {
    const { services, count } = await withExisting();
    renderAdd({ services });
    await choose(pdf('again.pdf', 'same bytes'));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep both' }));
    expect(await h1('The details')).toBeInTheDocument();
    expect(await services.documents.list(IDS.ramesh)).toHaveLength(count + 1);
  });

  it('"Cancel" removes the new copy and goes back to the start', async () => {
    const { services, count } = await withExisting();
    renderAdd({ services });
    await choose(pdf('again.pdf', 'same bytes'));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Take a photo' })).toBeInTheDocument();
    expect(await services.documents.list(IDS.ramesh)).toHaveLength(count);
  });

  it('leaving the flow keeps the original as "Not yet filed"', async () => {
    const { services } = renderAdd();
    await choose(pdf('lipid-profile-2026-11-20.pdf'));
    expect(await h1('The details')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('link', { name: 'Records' }).at(-1)!);
    expect(await h1('Records')).toBeInTheDocument();
    const left = (await services.documents.list(IDS.ramesh)).find((d) => d.title === 'lipid profile 2026 11 20')!;
    expect(left.state).toBe('pending_review');
    expect(await screen.findByRole('link', { name: 'lipid profile 2026 11 20' })).toBeInTheDocument();
    expect(screen.getAllByText('Not yet filed').length).toBeGreaterThanOrEqual(2);
  });
});

describe('add a record: reading', () => {
  it('shows the consent panel, and reads with the cloud only after "Send this page"', async () => {
    const services = createMockServicesV2({ delayMs: 0, fail: () => 'cloud_consent' });
    const read = vi.spyOn(services.reading, 'read');
    renderAdd({ services });
    await choose(photo('pack.jpg'));
    expect(await screen.findByRole('heading', { name: 'This page is hard to read on the device. Send this one page to the cloud reader?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retake the photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enter by hand' })).toBeInTheDocument();
    expect(read.mock.calls.map((c) => c[1])).toEqual([{ allowCloud: false }]);
    await userEvent.click(screen.getByRole('button', { name: 'Send this page' }));
    expect(await h1('The details')).toBeInTheDocument();
    expect(read.mock.calls.map((c) => c[1])).toEqual([{ allowCloud: false }, { allowCloud: true }]);
  });

  it('"Enter by hand" from the consent panel goes to an empty details step', async () => {
    renderAdd({ fail: 'cloud_consent' });
    await choose(pdf('report.pdf'));
    await userEvent.click(await screen.findByRole('button', { name: 'Enter by hand' }));
    expect(await h1('The details')).toBeInTheDocument();
    expect(screen.getByText('Type the details from the document.')).toBeInTheDocument();
  });

  it('a locked PDF is kept, with the message to fill in the details by hand', async () => {
    const { services } = renderAdd();
    await choose(pdf('bank-locked.pdf'));
    expect(await screen.findByText('This PDF is password-protected. It is saved; fill in the details by hand.')).toBeInTheDocument();
    expect((await services.documents.list(IDS.ramesh)).some((d) => d.title === 'bank locked')).toBe(true);
  });

  it('says how many pages were read when not all were', async () => {
    renderAdd();
    await choose(pdf('lipid-scan-5-pages-2026-11-01.pdf'));
    expect(await screen.findByText(/Read 2 of 5 pages/)).toBeInTheDocument();
    expect(screen.getByText(/The other pages were not read/)).toBeInTheDocument();
  });
});

describe('add a record: the demo prescription and Check the values', () => {
  async function toCheckStep() {
    const ctx = renderAdd();
    await choose(pdf('rx-rao-2026-11-13.pdf'));
    expect(await h1('The details')).toBeInTheDocument();
    expect(screen.getByLabelText('Kind')).toHaveValue('prescription');
    expect(screen.getByLabelText('Doctor')).toHaveValue(IDS.prescribers.rao);
    expect(screen.getByLabelText('Date on the document')).toHaveValue('2026-11-13');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await h1('Check the values')).toBeInTheDocument();
    return ctx;
  }

  it('corrects "7? mg" to 75 mg, then saves the prescription with "Aspirin 75 mg"', async () => {
    const { services, router } = await toCheckStep();
    const strength = card('Strength not clear');
    expect(within(strength).getByText('7? mg', { selector: 'code' })).toBeInTheDocument();
    expect(within(strength).getByText('Unclear digit')).toBeInTheDocument();
    expect(within(strength).getByText(/Page 1/)).toBeInTheDocument();
    expect(within(strength).getByRole('button', { name: 'It is right' })).toBeDisabled();
    await userEvent.click(within(strength).getByRole('button', { name: 'Show on the original' }));

    await userEvent.click(within(strength).getByRole('button', { name: 'Correct' }));
    await userEvent.click(within(strength).getByRole('button', { name: 'Use this value' }));
    expect(within(strength).getByLabelText('Correct strength')).toHaveAccessibleDescription(/Please type the correct value/);
    await userEvent.type(within(strength).getByLabelText('Correct strength'), '75');
    await userEvent.selectOptions(within(strength).getByLabelText('Unit'), 'mg');
    await userEvent.click(within(strength).getByRole('button', { name: 'Use this value' }));
    expect(within(strength).getByText('Corrected to 75 mg')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save the checks and continue' }));

    expect(await h1('Save the prescription')).toBeInTheDocument();
    expect(screen.getByText('Aspirin 75 mg')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
    expect(await screen.findByText('Prescription saved. Some medicines differ from the current routine. Review them now?')).toBeInTheDocument();

    const id = router.state.location.pathname === '/records/add'
      ? (await services.documents.list(IDS.ramesh)).find((d) => d.clinicalDate === '2026-11-13')!.id : '';
    expect(screen.getByRole('link', { name: 'Review changes' })).toHaveAttribute('href', `/records/${id}/review`);
    const fields = await services.documents.fields(id);
    expect(fields.find((f) => f.lineIndex === 3 && f.field === 'strength')).toMatchObject({ status: 'user_corrected', value: '75', raw: '7? mg' });
    const lines = await services.prescriptions.lines(id);
    expect(lines.map((l) => [l.productName, l.verified])).toEqual([
      ['Amlodipine 10 mg', true], ['Telmisartan 80 mg', true], ['Rosuvastatin 10 mg', true], ['Aspirin 75 mg', true],
    ]);
    expect((await services.documents.get(id)).state).toBe('filed');
    // Saving never changed the routine.
    expect((await services.routine.list(IDS.ramesh)).some((m) => m.productName.startsWith('Aspirin'))).toBe(false);

    // "Not now" puts the review off; it stays reopenable from the record page.
    const dismiss = vi.spyOn(services.routine, 'dismiss');
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/records/${id}`));
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('link', { name: 'Review changes to the current routine' })).toHaveAttribute('href', `/records/${id}/review`);
  });

  it('"Leave unknown" keeps the line unverified', async () => {
    const { services } = await toCheckStep();
    // The group's clean values can be confirmed together; the flagged one is left for its own answer.
    await userEvent.click(screen.getByRole('button', { name: 'Medicine 4: Aspirin 7? mg: the 5 values read automatically look right' }));
    const aspirinGroup = screen.getByRole('region', { name: 'Medicine 4: Aspirin 7? mg' });
    // The answer shows as a pill on each card (the flagged card still has its own "It is right" button).
    expect(within(aspirinGroup).getAllByText('It is right').filter((el) => !el.closest('button'))).toHaveLength(5);
    expect(within(card('Strength not clear')).getByText('Check this value')).toBeInTheDocument();
    await userEvent.click(within(card('Strength not clear')).getByRole('button', { name: 'Leave unknown' }));
    expect(within(card('Strength not clear')).getByText('Left unknown')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save the checks and continue' }));
    expect(await h1('Save the prescription')).toBeInTheDocument();
    expect(screen.getByText('Aspirin 7? mg')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save prescription' }));
    await screen.findByText(/Prescription saved/);
    const doc = (await services.documents.list(IDS.ramesh)).find((d) => d.clinicalDate === '2026-11-13')!;
    expect((await services.documents.fields(doc.id)).find((f) => f.lineIndex === 3 && f.field === 'strength')?.status).toBe('unknown');
    expect((await services.prescriptions.lines(doc.id)).find((l) => l.lineIndex === 3)?.verified).toBe(false);
  });

  it('"Check later" leaves the record not yet filed, with the check offered on its page', async () => {
    const { router } = await toCheckStep();
    await userEvent.click(screen.getByRole('button', { name: 'Check later' }));
    expect(await screen.findByRole('heading', { name: 'One value needs a check' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check the values' })).toHaveAttribute('href', `${router.state.location.pathname}/verify`);
    expect(screen.getAllByText('Not yet filed').length).toBeGreaterThan(0);
  });
});

describe('add a record: pack photos and retaking', () => {
  async function packAtCheck() {
    const ctx = renderAdd();
    await choose(photo('pack.jpg'));
    expect(await h1('The details')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await h1('Check the values')).toBeInTheDocument();
    return ctx;
  }

  it('ends with "Add it to the routine?" and adds the pack as taken after the checks', async () => {
    const { services } = await packAtCheck();
    await userEvent.click(within(card('Strength not clear')).getByRole('button', { name: 'It is right' }));
    await userEvent.click(within(card('Unit not clear')).getByRole('button', { name: 'It is right' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save the checks and continue' }));
    expect(await h1('Add it to the routine?')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Doses a day (optional)'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'He takes it' }));
    expect(await screen.findByText('Dolo 650 is now in the routine.')).toBeInTheDocument();
    const added = (await services.routine.list(IDS.ramesh)).filter((m) => m.productName === 'Dolo 650');
    expect(added.map((m) => [m.source, m.status, m.dosesPerDay])).toEqual([['from_pack', 'taking', 3], ['from_pack', 'taking', 3]]);
  });

  it('the gate sends an unchecked pack back to Check the values', async () => {
    await packAtCheck();
    await userEvent.click(screen.getByRole('button', { name: 'Save the checks and continue' }));
    // Nothing decided: the save is not offered yet.
    expect(screen.getByRole('button', { name: 'Save the checks and continue' })).toBeDisabled();
  });

  it('"Retake the photo" keeps the earlier decisions on the new photo', async () => {
    const { services } = await packAtCheck();
    const strength = card('Strength not clear');
    await userEvent.click(within(strength).getByRole('button', { name: 'Correct' }));
    // The box starts with the value read, so a small fix is quick.
    expect(within(strength).getByLabelText('Correct strength')).toHaveValue('650');
    await userEvent.clear(within(strength).getByLabelText('Correct strength'));
    await userEvent.type(within(strength).getByLabelText('Correct strength'), '500');
    await userEvent.click(within(strength).getByRole('button', { name: 'Use this value' }));
    // Choosing "mg" with the strength answered the unit too.
    expect(within(card('Unit not clear')).getByText('It is right')).toBeInTheDocument();
    await userEvent.click(within(card('Medicine name read automatically')).getByRole('button', { name: 'Retake the photo' }));

    expect(await screen.findByRole('heading', { name: /Retake the photo of/ })).toBeInTheDocument();
    const earlier = (await services.documents.list(IDS.ramesh)).find((d) => d.mimeType === 'image/jpeg')!;
    expect((await services.documents.fields(earlier.id)).find((f) => f.field === 'strength')).toMatchObject({ status: 'user_corrected', value: '500' });

    await choose(photo('pack-again.jpg', [4, 5, 6]));
    expect(await h1('The details')).toBeInTheDocument();
    expect(screen.getByText(/with your earlier checks applied/)).toBeInTheDocument();
    const fresh = (await services.documents.list(IDS.ramesh)).find((d) => d.mimeType === 'image/jpeg' && d.id !== earlier.id)!;
    const fields = await services.documents.fields(fresh.id);
    expect(fields.find((f) => f.field === 'strength')).toMatchObject({ status: 'user_corrected', value: '500' });
    // "It is right" carries over because the new photo reads the same unit.
    expect(fields.find((f) => f.field === 'unit')).toMatchObject({ status: 'user_confirmed', value: 'mg' });
    // The name was not decided before, so it still waits for a look.
    expect(fields.find((f) => f.field === 'medicine_name')?.status).toBe('extracted');

    await userEvent.click(screen.getByRole('button', { name: 'Remove the earlier photo' }));
    await screen.findByText('The earlier photo was removed');
    await expect(services.documents.get(earlier.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('add a record: patient and doctor', () => {
  it('a mismatch must be answered; "Yes" confirms the name and goes on', async () => {
    const { services } = renderAdd();
    await choose(pdf('ecg-mismatch-2026-11-01.pdf'));
    expect(await screen.findByRole('heading', { name: 'This looks like a record for Sunita Rao. Is it for Ramesh Iyer?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Please say whose record this is first.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(await screen.findByText(/Noted: it is Ramesh Iyer/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await h1('File it?')).toBeInTheDocument();
    const doc = (await services.documents.list(IDS.ramesh)).find((d) => d.patientNameRead === 'Sunita Rao')!;
    expect((await services.documents.fields(doc.id)).find((f) => f.field === 'patient_name')?.status).toBe('user_confirmed');
    await userEvent.click(screen.getByRole('button', { name: 'File it' }));
    expect(await screen.findByText(/is filed\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Open the record' }));
    expect(await screen.findByText("Sunita Rao · does not match Ramesh Iyer · you confirmed it is Ramesh Iyer's record")).toBeInTheDocument();
    expect(screen.queryByText('Name does not match')).toBeNull();
  });

  it('"It is for another profile" moves the record', async () => {
    const { services, router } = renderAdd();
    await choose(pdf('ecg-mismatch-2026-11-01.pdf'));
    await userEvent.click(await screen.findByRole('button', { name: 'It is for another profile' }));
    await userEvent.selectOptions(screen.getByLabelText('Whose record is it?'), 'Lakshmi Iyer (Mother)');
    await userEvent.click(screen.getByRole('button', { name: 'Move it' }));
    expect(await screen.findByText("Moved to Lakshmi Iyer's records, as not yet filed")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/records');
    expect((await services.documents.list(IDS.lakshmi)).some((d) => d.patientNameRead === 'Sunita Rao')).toBe(true);
    expect((await services.documents.list(IDS.ramesh)).some((d) => d.patientNameRead === 'Sunita Rao')).toBe(false);
  });

  it('"Not ours" removes the record', async () => {
    const { services } = renderAdd();
    await choose(pdf('ecg-mismatch-2026-11-01.pdf'));
    await userEvent.click(await screen.findByRole('button', { name: 'Not ours' }));
    expect(await screen.findByText(/^Removed /)).toBeInTheDocument();
    expect((await services.documents.list(IDS.ramesh)).some((d) => d.patientNameRead === 'Sunita Rao')).toBe(false);
  });

  it('"Add this doctor" adds the doctor read on the prescription and selects them', async () => {
    localStorage.setItem('cv.profileId', IDS.lakshmi);
    const { services } = renderAdd();
    await choose(pdf('rx-rao-2026-11-13.pdf'));
    expect(await screen.findByText(/“Dr. Kavita Rao” was read from the document but is not one of Lakshmi’s doctors/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add this doctor' }));
    expect(screen.getByLabelText("Doctor's name")).toHaveValue('Dr. Kavita Rao');
    await userEvent.type(screen.getByLabelText('Specialty (optional)'), 'Cardiology');
    await userEvent.click(screen.getByRole('button', { name: 'Save the doctor' }));
    const added = (await services.profiles.prescribers(IDS.lakshmi)).find((p) => p.name === 'Dr. Kavita Rao')!;
    await waitFor(() => expect(screen.getByLabelText('Doctor')).toHaveValue(added.id));
    expect(added.specialty).toBe('Cardiology');
  });
});

describe('add a record: Gmail', () => {
  it('connects, lists one row per PDF attachment, and imports the chosen one into the flow', async () => {
    const { services } = renderAdd();
    await userEvent.click(await screen.findByRole('button', { name: 'Import from Gmail' }));
    await userEvent.click(screen.getByRole('button', { name: 'Connect Gmail' }));
    const list = await screen.findByRole('list', { name: 'PDF attachments' });
    const boxes = within(list).getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    await userEvent.click(within(list).getByRole('checkbox', { name: 'cbc-2026-11-13.pdf' }));
    await userEvent.click(within(list).getByRole('checkbox', { name: 'chest-xray-2026-11-02.pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 report' }));
    expect(await h1('The details')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Kidney function test');
    const imported = (await services.documents.list(IDS.ramesh)).find((d) => d.title === 'Kidney function test')!;
    expect(imported).toMatchObject({ source: 'email', state: 'pending_review' });
  });
});

describe('Check the values page', () => {
  async function packRecord() {
    const services = createMockServicesV2({ delayMs: 0, fail: () => null });
    const { record } = await services.documents.add(IDS.ramesh, photo('pack.jpg'), { source: 'camera' });
    await services.reading.read(record.id, { allowCloud: false });
    return { services, record };
  }

  it('saves the checks at once and returns to the record', async () => {
    const { services, record } = await packRecord();
    const review = vi.spyOn(services.documents, 'reviewFields');
    const { router } = renderAdd({ services, path: `/records/${record.id}/verify` });
    expect(await h1('Check the values')).toBeInTheDocument();
    expect(document.title).toBe('Check the values · CareVault');
    await userEvent.click(within(await screen.findByRole('article', { name: 'Unit not clear' })).getByRole('button', { name: 'It is right' }));
    await userEvent.click(within(screen.getByRole('article', { name: 'Medicine name read automatically' })).getByRole('button', { name: 'Leave unknown' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save the checks' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/records/${record.id}`));
    // One call with every decision.
    expect(review).toHaveBeenCalledTimes(1);
    expect(review.mock.calls[0][1].map((d) => d.action).sort()).toEqual(['confirm', 'leave_unknown']);
    expect(await screen.findByText('Checks saved')).toBeInTheDocument();
  });

  it('"Retake the photo" opens the add flow for that record', async () => {
    const { services, record } = await packRecord();
    const { router } = renderAdd({ services, path: `/records/${record.id}/verify` });
    const strength = await screen.findByRole('article', { name: 'Strength not clear' });
    await userEvent.click(within(strength).getByRole('button', { name: 'Retake the photo' }));
    await waitFor(() => expect(router.state.location.search).toBe(`?retake=${record.id}`));
    expect(await screen.findByRole('heading', { name: /Retake the photo of pack/ })).toBeInTheDocument();
  });
});
