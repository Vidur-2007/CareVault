import '../test/configureTesting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { IDS } from '../../contract/fixtures/sampleCase';
import type { CareVaultServices } from '../../contract/services';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createMockServicesV2 } from '../mock/v2/createMockServicesV2';
import { ASK_FOOTER, examples, lookingFor, NOT_UNDERSTOOD } from './ask/askText';

const D = IDS.documents;
const make = () => createMockServicesV2({ delayMs: 0, fail: () => null });

function renderAsk(services: CareVaultServices, path = '/ask') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App services={services} router={router} />);
  return router;
}

const answer = () => screen.getByRole('region', { name: 'Answer' });
const examplesList = () => screen.getByRole('region', { name: 'Examples' });
const chip = (name: string) => within(examplesList()).getByRole('button', { name });

afterEach(() => {
  localStorage.removeItem('cv.profileId');
});

describe('Ask', () => {
  it('shows the box, the five example chips and the footer, and no answer yet', async () => {
    renderAsk(make());
    expect(await screen.findByRole('heading', { level: 1, name: 'Ask CareVault' })).toBeInTheDocument();
    expect(document.title).toBe('Ask · CareVault');
    expect(screen.getByRole('searchbox', { name: 'Your question' })).toHaveValue('');
    expect(within(examplesList()).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Latest lipid profile', 'Prescriptions from the cardiologist', 'Last three HbA1c reports', 'What questions did I save?', 'What medicines does he take?',
    ]);
    expect(screen.getByText(ASK_FOOTER)).toBeInTheDocument();
    expect(answer()).toBeEmptyDOMElement();
  });

  it('each example chip asks its question and shows the interpretation, the factual text and the results', async () => {
    const s = make();
    const router = renderAsk(s);
    await screen.findByRole('heading', { level: 1, name: 'Ask CareVault' });

    for (const question of examples({ relation: 'Father' })) {
      const expected = await s.records.ask(IDS.ramesh, question);
      expect(expected.understood).toBe(true);
      await userEvent.click(chip(question));
      expect(new URLSearchParams(router.state.location.search).get('q')).toBe(question);
      await within(answer()).findByText(expected.text);
      expect(within(answer()).getByText(lookingFor(expected.interpretedAs))).toBeInTheDocument();
      expect(screen.getByRole('searchbox', { name: 'Your question' })).toHaveValue(question);

      if (expected.kind === 'documents') {
        const links = within(within(answer()).getByRole('list', { name: 'Records found' })).getAllByRole('link');
        expect(links.map((l) => l.getAttribute('href'))).toEqual(expected.documents.map((h) => `/records/${h.document.id}`));
      } else if (expected.kind === 'questions') {
        for (const q of expected.questions) expect(within(answer()).getByText(q.text)).toBeInTheDocument();
        expect(within(answer()).getByRole('link', { name: 'Open the questions in the passport' })).toHaveAttribute('href', '/passport#questions');
      } else {
        const links = within(within(answer()).getByRole('list', { name: 'Medicines taken' })).getAllByRole('link');
        expect(links.map((l) => l.getAttribute('href'))).toEqual(expected.medicines.map((m) => `/passport/medicines/${m.id}`));
        expect(within(answer()).getByRole('link', { name: 'Open the current medicines in the passport' })).toHaveAttribute('href', '/passport#medicines');
      }
    }
  });

  it('the examples answer as the sample case expects', async () => {
    const s = make();
    renderAsk(s);
    await userEvent.click(await screen.findByRole('button', { name: 'Latest lipid profile' }));
    const lipid = await within(answer()).findByRole('link', { name: /Lipid profile/ });
    expect(lipid).toHaveAttribute('href', `/records/${D.lipidProfile}`);
    // Each result shows date, facility and source.
    expect(lipid).toHaveTextContent('12 Nov 2026 · Lakeside Diagnostics');
    expect(lipid).toHaveTextContent(/uploaded PDF/);
    expect(lipid).toHaveTextContent('Matched: test name');

    await userEvent.click(chip('Prescriptions from the cardiologist'));
    await waitFor(() => expect(within(answer()).getAllByRole('link').map((l) => l.getAttribute('href')))
      .toEqual([`/records/${D.raoLatest}`, `/records/${D.raoPrevious}`]));
    expect(within(answer()).getByText(/^Looking for: prescriptions from Dr\. Kavita Rao/)).toBeInTheDocument();

    // The HbA1c report has no date: it says so instead of inventing one.
    await userEvent.click(chip('Last three HbA1c reports'));
    const hba1c = await within(answer()).findByRole('link', { name: /HbA1c report/ });
    expect(hba1c).toHaveAttribute('href', `/records/${D.hba1c}`);
    expect(hba1c).toHaveTextContent(/^HbA1c reportLab reportDate not known · Lakeside Diagnostics · PDF from email/);

    const expected6 = (await s.routine.list(IDS.ramesh)).filter((m) => m.status === 'taking');
    expect(expected6).toHaveLength(6);
    await userEvent.click(chip('What medicines does he take?'));
    const meds = await within(answer()).findByRole('list', { name: 'Medicines taken' });
    expect(within(meds).getAllByRole('link')).toHaveLength(expected6.length);
  });

  it('when the question is not understood, says what can be asked and offers the examples', async () => {
    const s = make();
    const router = renderAsk(s);
    await screen.findByRole('heading', { level: 1, name: 'Ask CareVault' });
    const box = screen.getByRole('searchbox', { name: 'Your question' });
    await userEvent.type(box, 'tell me a joke');
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

    expect((await s.records.ask(IDS.ramesh, 'tell me a joke')).understood).toBe(false);
    await waitFor(() => expect(answer()).toHaveTextContent(`${NOT_UNDERSTOOD} latest lipid profile or prescriptions from the cardiologist.`));
    expect(NOT_UNDERSTOOD).toBe('CareVault can search your records by test, doctor, place and date. Try:');
    expect(within(answer()).queryByText(/^Looking for/)).toBeNull();
    expect(within(answer()).queryAllByRole('link')).toHaveLength(0);
    // The hint's examples ask straight away.
    expect(within(answer()).getAllByRole('button').map((b) => b.textContent)).toEqual(['latest lipid profile', 'prescriptions from the cardiologist']);
    await userEvent.click(within(answer()).getByRole('button', { name: 'latest lipid profile' }));
    expect(await within(answer()).findByRole('link', { name: /Lipid profile/ })).toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe('Latest lipid profile');
  });

  it('results open the right record, medicine and passport section', async () => {
    const s = make();
    const router = renderAsk(s, `/ask?q=${encodeURIComponent('latest lipid profile')}`);
    // A question in the address (from the Records "Ask CareVault" link) is answered at once.
    await screen.findByRole('heading', { level: 1, name: 'Ask CareVault' });
    expect(screen.getByRole('searchbox', { name: 'Your question' })).toHaveValue('latest lipid profile');
    await userEvent.click(await within(answer()).findByRole('link', { name: /Lipid profile/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Lipid profile' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/records/${D.lipidProfile}`);

    // Back returns to the same answer.
    await router.navigate(-1);
    await screen.findByRole('heading', { level: 1, name: 'Ask CareVault' });
    expect(await within(answer()).findByRole('link', { name: /Lipid profile/ })).toBeInTheDocument();

    await router.navigate(`/ask?q=${encodeURIComponent('What medicines does he take?')}`);
    await screen.findByRole('heading', { level: 1, name: 'Ask CareVault' });
    await userEvent.click(await within(answer()).findByRole('link', { name: /^Metformin 500 mg/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Metformin 500 mg' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/passport/medicines/${IDS.medicines.metformin500}`);

    await router.navigate(`/ask?q=${encodeURIComponent('What questions did I save?')}`);
    await screen.findByRole('heading', { level: 1, name: 'Ask CareVault' });
    await userEvent.click(await within(answer()).findByRole('link', { name: 'Open the questions in the passport' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/passport'));
    expect(router.state.location.hash).toBe('#questions');
    expect(await screen.findByRole('region', { name: 'Questions for the doctor' })).toHaveAttribute('id', 'questions');
  });

  it('answers only from the current profile’s records', async () => {
    localStorage.setItem('cv.profileId', IDS.lakshmi);
    const s = make();
    renderAsk(s, `/ask?q=${encodeURIComponent('latest lipid profile')}`);
    await screen.findByRole('heading', { level: 1, name: 'Ask CareVault' });
    const none = await s.records.ask(IDS.lakshmi, 'latest lipid profile');
    expect(none.documents).toEqual([]);
    expect(await within(answer()).findByText(none.text)).toBeInTheDocument();
    expect(within(answer()).queryAllByRole('link')).toHaveLength(0);
    expect(within(examplesList()).getByRole('button', { name: 'What medicines does she take?' })).toBeInTheDocument();
  });

  it('example wording follows the profile', () => {
    expect(examples({ relation: 'Mother' }).at(-1)).toBe('What medicines does she take?');
    expect(examples({ relation: 'Friend' }).at(-1)).toBe('What medicines do they take?');
    expect(examples({ relation: 'Myself' }).at(-1)).toBe('What medicines do I take?');
    expect(lookingFor('Latest report with Lipid profile')).toBe('Looking for: latest report with Lipid profile');
    expect(lookingFor('')).toBe('');
  });
});
