import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { createMockServices } from '../mock/createMockServices';
import { validateProfile } from './welcome/validateProfile';

function renderWelcome() {
  const services = createMockServices({ delayMs: 0, seeded: false, fail: () => null });
  const router = createMemoryRouter(routes, { initialEntries: ['/welcome'] });
  render(<App services={services} router={router} />);
  return { services, router };
}

describe('validateProfile', () => {
  const valid = { name: ' Lakshmi  Iyer ', relation: 'mother', birthYear: '1958', caregiverName: 'Anjali Iyer', caregiverRelation: 'Daughter' };

  it('returns a cleaned profile when everything is valid', () => {
    expect(validateProfile(valid, 2026)).toEqual({
      errors: {},
      profile: { name: 'Lakshmi Iyer', relation: 'Mother', birthYear: 1958, caregiverName: 'Anjali Iyer', caregiverRelation: 'daughter' },
    });
  });

  it('requires the names and relations, and checks the birth year', () => {
    const { errors, profile } = validateProfile({ name: '', relation: ' ', birthYear: '58', caregiverName: '', caregiverRelation: '' }, 2026);
    expect(profile).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(['birthYear', 'caregiverName', 'caregiverRelation', 'name', 'relation']);
    expect(validateProfile({ ...valid, birthYear: '2031' }, 2026).errors.birthYear).toBeDefined();
    expect(validateProfile({ ...valid, birthYear: '' }, 2026).profile?.birthYear).toBeNull();
  });
});

describe('Welcome screen', () => {
  it('offers the sample profile and the create form', async () => {
    renderWelcome();
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome to CareVault' })).toBeInTheDocument();
    expect(screen.getByText(/stays on this device/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try the sample profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a profile' })).toBeInTheDocument();
  });

  it('shows linked errors and focuses the first invalid field', async () => {
    renderWelcome();
    await userEvent.click(await screen.findByRole('button', { name: 'Create a profile' }));
    const name = await screen.findByLabelText('Name');
    await userEvent.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Please enter their name.');
    expect(screen.getByText('Please enter your name.')).toBeInTheDocument();

    await userEvent.type(name, 'Lakshmi Iyer');
    expect(screen.queryByText('Please enter their name.')).toBeNull();
  });

  it('creates a profile and opens Review for it', async () => {
    const { services, router } = renderWelcome();
    await userEvent.click(await screen.findByRole('button', { name: 'Create a profile' }));
    await userEvent.type(await screen.findByLabelText('Name'), 'Lakshmi Iyer');
    await userEvent.type(screen.getByLabelText('Relation to you'), 'Mother');
    await userEvent.type(screen.getByLabelText('Birth year (optional)'), '1958');
    await userEvent.type(screen.getByLabelText('Your name'), 'Ravi Iyer');
    await userEvent.type(screen.getByLabelText('Your relation to them'), 'son');
    await userEvent.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(await screen.findByRole('heading', { level: 1, name: /Ravi/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect((await services.profiles.list()).map((p) => p.name)).toEqual(['Lakshmi Iyer']);
    expect(await screen.findByRole('heading', { name: 'Nothing needs your review' })).toBeInTheDocument();
  });
});
