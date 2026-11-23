import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expected, IDS } from '../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/services';
import type { ExtractedLine, ProposalRow } from '../../contract/types';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { placeholderPdf } from '../mock/placeholderPdf';
import { createMockServicesV2 } from '../mock/v2/createMockServicesV2';
import {
  baseName, choiceLabel, doseValues, passiveLine, questionFor, reconcile, rowKey, sameLine, shownChoices, summarySentence, voiceFor,
} from './review/reviewText';

const demo = expected.demoPrescription;
const M = IDS.medicines;
const pdf = (name: string) => new File([placeholderPdf([name])], name, { type: 'application/pdf' });

/** The demo prescription, read, saved and filed: every value checked except the Aspirin strength, unless asked. */
async function demoSaved(s: CareVaultServices, opts: { verifyAspirin?: boolean } = {}) {
  const { record } = await s.documents.add(IDS.ramesh, pdf(demo.file), { source: 'upload' });
  const candidate = await s.reading.read(record.id, { allowCloud: false });
  const aspirin = candidate.fields.find((f) => f.lineIndex === 3 && f.field === 'strength')!;
  await s.documents.reviewFields(record.id, candidate.fields.filter((f) => f.id !== aspirin.id).map((f) => ({ evidenceId: f.id, action: 'confirm' as const })));
  await s.documents.update(record.id, { kind: 'prescription', title: 'Cardiology prescription', clinicalDate: candidate.clinicalDate, prescriberId: demo.prescriberId });
  await s.documents.fileRecord(record.id);
  if (opts.verifyAspirin) await s.documents.reviewFields(record.id, [{ evidenceId: aspirin.id, action: 'correct', value: '75' }]);
  const { proposal } = await s.prescriptions.save(record.id, demo.prescriberId, candidate.lines);
  return { id: record.id, proposal: proposal! };
}

function renderAt(path: string, services: CareVaultServices) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App services={services} router={router} />);
  return router;
}

const make = (fail: () => string | null = () => null) => createMockServicesV2({ delayMs: 0, fail });
const h1 = (name: string) => screen.findByRole('heading', { level: 1, name });
/** The review has loaded: its first card is shown. */
const ready = () => screen.findByRole('article', { name: 'Telmisartan' });
const card = (name: string) => screen.getByRole('article', { name });
const radios = (el: HTMLElement) => within(el).getAllByRole('radio').map((r) => r.closest('label')!.textContent);
const pickIn = (name: string, choice: string) => userEvent.click(within(card(name)).getByRole('radio', { name: choice }));
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save these choices' }));
const summaryItems = () => within(screen.getByRole('list', { name: 'What changed' })).getAllByRole('listitem');

afterEach(() => {
  localStorage.removeItem('cv.profileId');
  sessionStorage.clear();
});

describe('review changes: the demo prescription', () => {
  it('shows the rows of fixtures `expected`, with exactly the questions and choices of the spec', async () => {
    const s = make();
    const { id, proposal } = await demoSaved(s);
    expect(proposal.rows.map((r) => ({ kind: r.kind, medicineId: r.medicine?.id ?? null, asked: r.asked, blockedByVerification: r.blockedByVerification })))
      .toEqual(demo.proposalRows.map((r) => ({ kind: r.kind, medicineId: r.medicineId, asked: r.asked, blockedByVerification: r.blockedByVerification })));

    renderAt(`/records/${id}/review`, s);
    expect(await h1('What changed on this prescription')).toBeInTheDocument();
    expect(document.title).toBe('Review changes · CareVault');
    expect(await screen.findByText('Dr. Kavita Rao · 13 Nov 2026. Nothing changes until you choose.')).toBeInTheDocument();

    // One card per asked row, in the order changed, new, not_mentioned.
    const cards = await screen.findAllByRole('article');
    expect(cards.map((c) => within(c).getByRole('heading', { level: 2 }).textContent)).toEqual(['Telmisartan', 'Aspirin', 'Atorvastatin']);
    expect(within(cards[0]).getByText('Different strength')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Newly prescribed')).toBeInTheDocument();
    expect(within(cards[2]).getByText('Not on this prescription')).toBeInTheDocument();

    // Changed: the routine value beside the prescription value.
    expect(within(cards[0]).getByText('Telmisartan 40 mg')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Telmisartan 80 mg')).toBeInTheDocument();
    expect(within(cards[0]).getByRole('group', { name: 'Is he taking Telmisartan as on this prescription?' })).toBeInTheDocument();
    expect(radios(cards[0])).toEqual(['Yes, he has started 80 mg', 'No, still 40 mg', 'He is not taking it', 'Not sure, ask the doctor', 'Skip']);

    // New, blocked until the strength is checked: no choice that writes a value.
    expect(within(cards[1]).getByText('Not in the routine')).toBeInTheDocument();
    expect(within(cards[1]).getByRole('group', { name: 'Has he started taking Aspirin?' })).toBeInTheDocument();
    expect(radios(cards[1])).toEqual(['He is not taking it', 'Not sure, ask the doctor', 'Skip']);
    expect(within(cards[1]).getByText(/It reads “7\? mg” on the original/)).toBeInTheDocument();
    expect(within(cards[1]).getByRole('link', { name: 'Check the strength first' }))
      .toHaveAttribute('href', `/records/${id}/verify?return=${encodeURIComponent(`/records/${id}/review`)}`);

    // Not mentioned (same prescriber).
    expect(within(cards[2]).getByRole('group', {
      name: 'Atorvastatin was not on this prescription. That does not mean it should be stopped. Is he still taking it?',
    })).toBeInTheDocument();
    expect(radios(cards[2])).toEqual(['Yes, still taking', 'No, he has stopped', 'Not sure, ask the doctor', 'Skip']);

    // "No change" and passive rows: one line each, without buttons.
    const same = screen.getByText('2 medicines are the same as in the routine');
    expect(same.parentElement).toHaveTextContent('Amlodipine 10 mg, Rosuvastatin 10 mg');
    const passive = screen.getByText('3 other medicines in the routine are not on this prescription. Nothing changes for them.');
    for (const line of [same.parentElement!, passive]) {
      expect(within(line).queryAllByRole('button')).toHaveLength(0);
      expect(within(line).queryAllByRole('radio')).toHaveLength(0);
    }
    expect(screen.queryByRole('article', { name: /Amlodipine|Rosuvastatin|Metformin|Dolo|Crocin/ })).toBeNull();
  });

  it('a blocked row goes to Check the values and back, keeping the choices, then can be chosen', async () => {
    const s = make();
    const { id } = await demoSaved(s);
    const router = renderAt(`/records/${id}/review`, s);
    await ready();
    await pickIn('Telmisartan', 'Yes, he has started 80 mg');

    await userEvent.click(within(card('Aspirin')).getByRole('link', { name: 'Check the strength first' }));
    expect(await h1('Check the values')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', `/records/${id}/review`);
    const strength = await screen.findByRole('article', { name: 'Strength not clear' });
    await userEvent.click(within(strength).getByRole('button', { name: 'Correct' }));
    await userEvent.type(within(strength).getByLabelText('Correct strength'), '75');
    await userEvent.selectOptions(within(strength).getByLabelText('Unit'), 'mg');
    await userEvent.click(within(strength).getByRole('button', { name: 'Use this value' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save the checks' }));

    // Back on the review: the choice made before is still there, and Aspirin can now be started.
    expect(await h1('What changed on this prescription')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/records/${id}/review`);
    await waitFor(() => expect(radios(card('Aspirin'))).toEqual(['Yes, he takes it', 'Not started yet', 'He is not taking it', 'Not sure, ask the doctor', 'Skip']));
    expect(within(card('Aspirin')).queryByRole('link', { name: 'Check the strength first' })).toBeNull();
    expect(within(card('Aspirin')).getByText('Aspirin 75 mg')).toBeInTheDocument();
    expect(within(card('Telmisartan')).getByRole('radio', { name: 'Yes, he has started 80 mg' })).toBeChecked();

    await pickIn('Aspirin', 'Yes, he takes it');
    await save();
    expect(await screen.findByRole('heading', { name: 'Your choices are saved' })).toBeInTheDocument();
    expect(summaryItems().map((li) => li.textContent)).toEqual(['Telmisartan updated to 80 mg.Undo', 'Aspirin added.Undo']);
    const aspirin = (await s.routine.list(IDS.ramesh)).find((m) => m.productName === 'Aspirin 75 mg');
    expect(aspirin).toMatchObject({ status: 'taking', source: 'from_prescription', sourceDocumentId: id });
    // Atorvastatin was not answered: it is still offered.
    expect(within(screen.getByRole('region', { name: 'Still to answer' })).getByRole('article', { name: 'Atorvastatin' })).toBeInTheDocument();
  });

  it('a choice that writes a value is never sent unverified: verification_required goes to the check', async () => {
    const s = make(() => 'verification');
    const { id } = await demoSaved(s, { verifyAspirin: true });
    const router = renderAt(`/records/${id}/review`, s);
    await ready();
    await pickIn('Telmisartan', 'Yes, he has started 80 mg');
    await save();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/records/${id}/verify`));
    expect(router.state.location.search).toBe(`?return=${encodeURIComponent(`/records/${id}/review`)}`);
  });

  it('skip leaves the routine as it was, and nothing about it reaches Home', async () => {
    const s = make();
    const { id } = await demoSaved(s, { verifyAspirin: true });
    const routineBefore = await s.routine.list(IDS.ramesh);
    const attentionBefore = await s.attention.list(IDS.ramesh);
    const eventsBefore = (await s.routine.profileHistory(IDS.ramesh)).length;

    const router = renderAt(`/records/${id}/review`, s);
    await ready();
    for (const name of ['Telmisartan', 'Aspirin', 'Atorvastatin']) await pickIn(name, 'Skip');
    expect(screen.getByText('3 of 3 answered. Medicines without an answer stay as they are.')).toBeInTheDocument();
    await save();
    expect(await screen.findByRole('heading', { name: 'Your choices are saved' })).toBeInTheDocument();
    expect(summaryItems().map((li) => li.textContent)).toEqual(['Telmisartan unchanged.', 'Aspirin unchanged.', 'Atorvastatin unchanged.']);
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();

    expect(await s.routine.list(IDS.ramesh)).toEqual(routineBefore);
    expect(await s.routine.profileHistory(IDS.ramesh)).toHaveLength(eventsBefore);
    expect(await s.attention.list(IDS.ramesh)).toEqual(attentionBefore);
    expect(attentionBefore.map((a) => a.kind)).toEqual(['possible_duplicate_ingredient']);

    await router.navigate('/');
    expect(await h1('Ramesh Iyer')).toBeInTheDocument();
    expect(screen.queryByText(/Telmisartan|Aspirin|Atorvastatin|review/i)).toBeNull();
  });

  it('Not now puts the review off; it is reopened from the record page', async () => {
    const s = make();
    const dismiss = vi.spyOn(s.routine, 'dismiss');
    const { id, proposal } = await demoSaved(s, { verifyAspirin: true });
    const attentionBefore = await s.attention.list(IDS.ramesh);
    const router = renderAt(`/records/${id}/review`, s);
    await ready();
    await pickIn('Telmisartan', 'Yes, he has started 80 mg');
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/records/${id}`));
    expect(dismiss).toHaveBeenCalledWith(proposal.id);
    expect(await s.attention.list(IDS.ramesh)).toEqual(attentionBefore);
    expect((await s.routine.list(IDS.ramesh)).find((m) => m.id === M.telmisartan40)?.status).toBe('taking');

    const section = await screen.findByRole('region', { name: 'Changes to the current routine' });
    expect(within(section).getByText('3 medicines on this prescription differ from the current routine and have no answer yet.')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('link', { name: 'Review changes to the current routine' }));
    expect(await h1('What changed on this prescription')).toBeInTheDocument();
    expect((await screen.findAllByRole('article')).map((c) => within(c).getByRole('heading', { level: 2 }).textContent))
      .toEqual(['Telmisartan', 'Aspirin', 'Atorvastatin']);
    // Not now forgot the choices that were not saved.
    expect(within(card('Telmisartan')).getByRole('radio', { name: 'Yes, he has started 80 mg' })).not.toBeChecked();
  });

  it('on stale, reloads the proposal and keeps the choices whose rows still match', async () => {
    let fail: string | null = null;
    const s = make(() => fail);
    const { id } = await demoSaved(s, { verifyAspirin: true });
    renderAt(`/records/${id}/review`, s);
    await ready();
    await pickIn('Telmisartan', 'Yes, he has started 80 mg');
    await pickIn('Aspirin', 'Yes, he takes it');
    await pickIn('Atorvastatin', 'Yes, still taking');

    // Meanwhile Atorvastatin is marked as stopped elsewhere, and the save meets a newer revision.
    await s.routine.setStatus(M.atorvastatin10, 'stopped');
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Atorvastatin' })).toBeNull());
    fail = 'stale';
    const decide = vi.spyOn(s.routine, 'decide');
    await save();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The routine changed since this review was prepared. It has been refreshed, and your choices are kept where they still apply.');
    expect(alert).toHaveTextContent('Choose again for Atorvastatin 10 mg: it changed.');
    expect(within(card('Telmisartan')).getByRole('radio', { name: 'Yes, he has started 80 mg' })).toBeChecked();
    expect(within(card('Aspirin')).getByRole('radio', { name: 'Yes, he takes it' })).toBeChecked();

    fail = null;
    await save();
    expect(await screen.findByRole('heading', { name: 'Your choices are saved' })).toBeInTheDocument();
    expect(summaryItems().map((li) => li.textContent)).toEqual(['Telmisartan updated to 80 mg.Undo', 'Aspirin added.Undo']);
    // Both saves sent the choices together, with the revision the proposal was computed against.
    expect(decide).toHaveBeenCalledTimes(2);
    const [, decisions, revision] = decide.mock.calls[1];
    expect(decisions.map((d) => d.choice)).toEqual(['started_new', 'started']);
    expect(revision).toBe((await s.routine.revision(IDS.ramesh)) - 3); // the save wrote 3 events
    expect((await s.routine.get(M.atorvastatin10)).status).toBe('stopped');
  });

  it('saves the expected decisions, summarises them, and undoes each change on its own', async () => {
    const s = make();
    const { id } = await demoSaved(s, { verifyAspirin: true });
    renderAt(`/records/${id}/review`, s);
    await ready();
    await pickIn('Telmisartan', 'Yes, he has started 80 mg');
    await pickIn('Atorvastatin', 'Skip');
    await pickIn('Aspirin', 'Yes, he takes it');
    await save();
    expect(await screen.findByRole('heading', { name: 'Your choices are saved' })).toHaveFocus();
    expect(summaryItems().map((li) => li.textContent)).toEqual(['Telmisartan updated to 80 mg.Undo', 'Aspirin added.Undo', 'Atorvastatin unchanged.']);

    const after = demo.afterDecisions;
    const names = async () => (await s.passport.live(IDS.ramesh)).currentMedicines.map((m) => m.productName);
    expect(await names()).toEqual(after.currentMedicineNames);
    expect((await s.routine.get(M.atorvastatin10)).status).toBe(after.atorvastatinStatus);

    // Undo Telmisartan: 40 mg is back as taking, 80 mg is gone, and the row can be answered again.
    await userEvent.click(screen.getByRole('button', { name: 'Undo: Telmisartan updated to 80 mg.' }));
    await waitFor(() => expect(summaryItems()[0]).toHaveTextContent('Undone'));
    expect(await s.routine.get(M.telmisartan40)).toMatchObject({ status: 'taking', replacedByMedicineId: null });
    expect((await s.routine.list(IDS.ramesh)).some((m) => m.productName === 'Telmisartan 80 mg')).toBe(false);
    expect(await within(screen.getByRole('region', { name: 'Still to answer' })).findByRole('article', { name: 'Telmisartan' })).toBeInTheDocument();
    // Aspirin is untouched by that undo.
    expect(await names()).toContain('Aspirin 75 mg');

    await userEvent.click(screen.getByRole('button', { name: 'Undo: Aspirin added.' }));
    await waitFor(() => expect(summaryItems()[1]).toHaveTextContent('Undone'));
    expect((await s.routine.list(IDS.ramesh)).some((m) => m.productName.startsWith('Aspirin'))).toBe(false);
    expect(await names()).toEqual(expected.ramesh.passport.currentMedicineNames);
  });

  it('with slow services, a card just answered never reappears while the review reloads', async () => {
    const s = make();
    const { id } = await demoSaved(s, { verifyAspirin: true });
    renderAt(`/records/${id}/review`, s);
    await ready();
    await pickIn('Telmisartan', 'Yes, he has started 80 mg');
    // From here the review loads slowly, as it can on a real device.
    const proposalFor = s.routine.proposalFor.bind(s.routine);
    vi.spyOn(s.routine, 'proposalFor').mockImplementation(async (docId) => {
      await new Promise((r) => setTimeout(r, 400));
      return proposalFor(docId);
    });
    await save();
    expect(await screen.findByRole('heading', { name: 'Your choices are saved' })).toBeInTheDocument();
    // At once, before the reload arrives: only the unanswered medicines are offered.
    const still = screen.getByRole('region', { name: 'Still to answer' });
    expect(within(still).getAllByRole('article').map((c) => within(c).getByRole('heading', { level: 2 }).textContent)).toEqual(['Aspirin', 'Atorvastatin']);
    await waitFor(() => expect((within(still).getAllByRole('article'))).toHaveLength(2));
  });

  it('asks before "He has stopped" and "He is not taking it", and an Undo refused after a later change shows the history', async () => {
    const s = make();
    const { id } = await demoSaved(s, { verifyAspirin: true });
    renderAt(`/records/${id}/review`, s);
    await ready();

    await pickIn('Atorvastatin', 'No, he has stopped');
    const dialog = await screen.findByRole('dialog', { name: 'Mark Atorvastatin 10 mg as stopped?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(within(card('Atorvastatin')).getByRole('radio', { name: 'No, he has stopped' })).not.toBeChecked();
    await pickIn('Atorvastatin', 'No, he has stopped');
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark as stopped' }));
    expect(within(card('Atorvastatin')).getByRole('radio', { name: 'No, he has stopped' })).toBeChecked();

    await pickIn('Aspirin', 'He is not taking it');
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Leave Aspirin out of the routine?' })).getByRole('button', { name: 'Leave it out' }));
    await pickIn('Telmisartan', 'Not sure, ask the doctor');
    await save();

    expect(await screen.findByRole('heading', { name: 'Your choices are saved' })).toBeInTheDocument();
    expect(summaryItems().map((li) => li.textContent)).toEqual([
      'Telmisartan marked as not sure. Question saved for the next visit.Undo', 'Aspirin not added.', 'Atorvastatin marked as stopped.Undo',
    ]);
    expect((await s.routine.get(M.atorvastatin10)).status).toBe('stopped');
    expect((await s.visits.next(IDS.ramesh))!.questions).toHaveLength(3);

    // Undo of the question removes it and restores Telmisartan 40 mg as taking.
    await userEvent.click(screen.getByRole('button', { name: 'Undo: Telmisartan marked as not sure. Question saved for the next visit.' }));
    await waitFor(() => expect(summaryItems()[0]).toHaveTextContent('Undone'));
    expect((await s.visits.next(IDS.ramesh))!.questions).toHaveLength(2);
    expect((await s.routine.get(M.telmisartan40)).status).toBe('taking');

    // A later change to Atorvastatin: its Undo is refused, with the history offered.
    await s.routine.setStatus(M.atorvastatin10, 'taking');
    await userEvent.click(screen.getByRole('button', { name: 'Undo: Atorvastatin marked as stopped.' }));
    const refused = await within(summaryItems()[2]).findByRole('alert');
    expect(refused).toHaveTextContent('A later change was made; see the history.');
    expect(within(refused).getByRole('link', { name: 'See the history' })).toHaveAttribute('href', `/passport/medicines/${M.atorvastatin10}`);
    expect((await s.routine.get(M.atorvastatin10)).status).toBe('taking');
  });

  it('a prescription with nothing to review says so, and another profile’s record is not shown', async () => {
    const s = make();
    const { record } = await s.documents.add(IDS.ramesh, pdf('same.pdf'), { source: 'upload' });
    const line = (lineIndex: number, productName: string, name: string, strength: number, instruction: string): ExtractedLine =>
      ({ lineIndex, productName, ingredients: [{ name, strength, unit: 'mg' }], form: 'tablet', dosesPerDay: 1, instruction, warnings: [] });
    await s.documents.update(record.id, { prescriberId: IDS.prescribers.rao });
    const { proposal } = await s.prescriptions.save(record.id, IDS.prescribers.rao, [
      line(0, 'Amlodipine 10 mg', 'amlodipine', 10, '1 tablet, morning'),
      line(1, 'Telmisartan 40 mg', 'telmisartan', 40, '1 tablet, morning'),
      line(2, 'Rosuvastatin 10 mg', 'rosuvastatin', 10, '1 tablet, night'),
      line(3, 'Atorvastatin 10 mg', 'atorvastatin', 10, '1 tablet, night'),
    ]);
    expect(proposal).toBeNull();
    const router = renderAt(`/records/${record.id}/review`, s);
    expect(await screen.findByRole('heading', { name: 'No differences with the current routine' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();

    await router.navigate(`/records/${IDS.documents.lakshmiThyroid}/review`);
    expect(await screen.findByText('This record is not in these records')).toBeInTheDocument();
  });

  it('shows a load error with Retry', async () => {
    let fail: string | null = null;
    const s = make(() => fail);
    const { id } = await demoSaved(s);
    fail = 'routine';
    renderAt(`/records/${id}/review`, s);
    expect(await screen.findByText('The review could not be loaded')).toBeInTheDocument();
    fail = null;
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('article', { name: 'Telmisartan' })).toBeInTheDocument();
  });
});

describe('review wording', () => {
  const row = (kind: ProposalRow['kind'], extra: Partial<ProposalRow> = {}): ProposalRow => ({
    id: 'r', kind, line: null, medicine: null, asked: true, blockedByVerification: false, choices: [], decision: null, decidedAt: null, note: '', ...extra,
  });
  const med = (productName: string, strength: number) => ({
    productName, ingredients: [{ name: 'x', strength, unit: 'mg' as const }], form: 'tablet' as const, dosesPerDay: 1, instruction: '',
  });

  it('uses the pronouns of the relation, and "you" for my own records', () => {
    const changed = row('changed', { line: { ...med('Telmisartan 80 mg', 80), id: 'l', documentId: 'd', lineIndex: 1, verified: true }, medicine: { ...med('Telmisartan 40 mg', 40) } as never });
    expect(questionFor(changed, voiceFor({ relation: 'Mother' }))).toBe('Is she taking Telmisartan as on this prescription?');
    expect(choiceLabel(changed, 'started_new', voiceFor({ relation: 'Mother' }))).toBe('Yes, she has started 80 mg');
    expect(questionFor(changed, voiceFor({ relation: 'Friend' }))).toBe('Are they taking Telmisartan as on this prescription?');
    expect(choiceLabel(changed, 'not_taking', voiceFor({ relation: 'Friend' }))).toBe('They are not taking it');
    expect(questionFor(changed, voiceFor({ relation: 'Myself' }))).toBe('Are you taking Telmisartan as on this prescription?');
    expect(choiceLabel(changed, 'started_new', voiceFor({ relation: 'Myself' }))).toBe('Yes, I have started 80 mg');
    const notMentioned = row('not_mentioned', { medicine: med('Atorvastatin 10 mg', 10) as never });
    expect(choiceLabel(notMentioned, 'not_taking', voiceFor({ relation: 'Myself' }))).toBe('No, I have stopped');
    expect(questionFor(row('new', { line: { ...med('Aspirin 75 mg', 75), id: 'l', documentId: 'd', lineIndex: 3, verified: true } }), voiceFor({ relation: 'Myself' })))
      .toBe('Have you started taking Aspirin?');
    expect(questionFor(row('uncertain_match'), voiceFor({ relation: 'Father' }))).toBe('These may be the same medicine, but CareVault could not confirm it.');
  });

  it('names, doses, counts and summary sentences', () => {
    expect(baseName('Telmisartan 80 mg')).toBe('Telmisartan');
    expect(baseName('Aspirin 7? mg')).toBe('Aspirin');
    expect(baseName('Crocin Advance 500')).toBe('Crocin Advance 500');
    expect(doseValues(med('A 40 mg', 40), med('A 80 mg', 80))).toEqual(['40 mg', '80 mg']);
    expect(doseValues({ ...med('A', 40), dosesPerDay: 1 }, { ...med('A', 40), dosesPerDay: 2 })).toEqual(['once a day', 'twice a day']);
    expect(doseValues(med('A', 40), med('A', 40))).toBeNull();
    expect(sameLine(1)).toBe('1 medicine is the same as in the routine');
    expect(passiveLine(1)).toBe('1 other medicine in the routine is not on this prescription. Nothing changes for it.');
    const nm = row('not_mentioned', { medicine: med('Atorvastatin 10 mg', 10) as never });
    expect(summarySentence(nm, 'skip', false)).toBe('Atorvastatin unchanged.');
    expect(summarySentence(nm, 'still_taking', false)).toBe('Atorvastatin confirmed as still taken.');
    expect(summarySentence(row('new', { line: { ...med('Aspirin 75 mg', 75), id: 'l', documentId: 'd', lineIndex: 3, verified: true } }), 'ask_doctor', false))
      .toBe('Aspirin unchanged. No visit is planned, so no question was saved.');
  });

  it('keeps a held choice only while its row still matches and offers it', () => {
    const line = { ...med('Aspirin 75 mg', 75), id: 'l', documentId: 'd', lineIndex: 3, verified: true };
    const open = row('new', { id: 'a', line, choices: ['started', 'not_started', 'not_taking', 'ask_doctor', 'skip'] });
    const held = { [rowKey(open)]: { choice: 'started' as const, name: 'Aspirin 75 mg' } };
    expect(reconcile(held, [open]).kept.get('a')).toBe('started');
    // Blocked again (a value was reopened): the choice that writes values is not kept.
    const blocked = { ...open, blockedByVerification: true };
    expect(shownChoices(blocked)).toEqual(['not_taking', 'ask_doctor', 'skip']);
    expect(reconcile(held, [blocked])).toEqual({ kept: new Map(), dropped: ['Aspirin 75 mg'] });
    // The same line now matched against an entry is another question.
    expect(reconcile(held, [{ ...open, kind: 'changed', medicine: med('Aspirin 150 mg', 150) as never }]).dropped).toEqual(['Aspirin 75 mg']);
    // "Same medicine" needs an entry to be the same as.
    expect(shownChoices(row('uncertain_match', { choices: ['same_medicine', 'different_medicine', 'ask_doctor', 'skip'] })))
      .toEqual(['different_medicine', 'ask_doctor', 'skip']);
  });
});
