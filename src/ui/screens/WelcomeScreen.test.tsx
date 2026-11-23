import '../test/configureTesting';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../app/App';
import { routes } from '../app/routes';
import { deviceToday } from '../lib/today';
import { createMockServicesV2 } from '../mock/v2/createMockServicesV2';
import { EMPTY_PROFILE_FORM, validateProfile } from './welcome/validateProfile';

function renderWelcome(path = '/welcome', seeded = false) {
  const services = createMockServicesV2({ delayMs: 0, seeded, fail: () => null });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App services={services} router={router} />);
  return { services, router };
}

afterEach(() => {
  localStorage.removeItem('cv.profileId');
});

describe('validateProfile', () => {
  const valid = {
    ...EMPTY_PROFILE_FORM, name: ' Lakshmi  Iyer ', relation: 'mother', birthYear: '1958', caregiverName: 'Anjali Iyer',
    caregiverRelation: 'Daughter', emergencyContact: ' Anjali Iyer,  +91 90000 00000 ',
  };

  it('returns a cleaned profile when everything is valid', () => {
    expect(validateProfile(valid, 2026)).toEqual({
      errors: {},
      profile: {
        name: 'Lakshmi Iyer', relation: 'Mother', birthYear: 1958, caregiverName: 'Anjali Iyer', caregiverRelation: 'daughter',
        emergencyContact: 'Anjali Iyer, +91 90000 00000',
      },
    });
    expect(validateProfile({ ...valid, emergencyContact: '  ' }, 2026).profile?.emergencyContact).toBeNull();
  });

  it('"I manage my own records" needs only a name and sets relation Myself, with no caregiver', () => {
    const { errors, profile } = validateProfile({ ...EMPTY_PROFILE_FORM, selfManaged: true, name: 'Meera Nair', relation: 'ignored', caregiverName: 'ignored' }, 2026);
    expect(errors).toEqual({});
    expect(profile).toEqual({ name: 'Meera Nair', relation: 'Myself', birthYear: null, caregiverName: '', caregiverRelation: '', emergencyContact: null });
    expect(validateProfile({ ...EMPTY_PROFILE_FORM, selfManaged: true }, 2026).errors).toEqual({ name: 'Please enter your name.' });
  });

  it('requires the names and relations, and checks the birth year and contact length', () => {
    const { errors, profile } = validateProfile({ ...EMPTY_PROFILE_FORM, relation: ' ', birthYear: '58', emergencyContact: 'x'.repeat(101) }, 2026);
    expect(profile).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(['birthYear', 'caregiverName', 'caregiverRelation', 'emergencyContact', 'name', 'relation']);
    expect(validateProfile({ ...valid, birthYear: '2031' }, 2026).errors.birthYear).toBeDefined();
    expect(validateProfile({ ...valid, birthYear: '' }, 2026).profile?.birthYear).toBeNull();
  });
});

describe('Welcome screen', () => {
  it('offers the sample profiles and the create form', async () => {
    renderWelcome();
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome to CareVault' })).toBeInTheDocument();
    expect(document.title).toBe('Welcome · CareVault');
    expect(screen.getByText(/stays on this device/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try the sample profiles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a profile' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to Home' })).toBeNull();
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

  it('creates a caregiver profile with an emergency contact and opens Home for it', async () => {
    const { services, router } = renderWelcome();
    await userEvent.click(await screen.findByRole('button', { name: 'Create a profile' }));
    await userEvent.type(await screen.findByLabelText('Name'), 'Lakshmi Iyer');
    await userEvent.type(screen.getByLabelText('Relation to you'), 'Mother');
    await userEvent.type(screen.getByLabelText('Birth year (optional)'), '1958');
    await userEvent.type(screen.getByLabelText('Emergency contact (optional)'), 'Ravi Iyer, +91 90000 11111');
    await userEvent.type(screen.getByLabelText('Your name'), 'Ravi Iyer');
    await userEvent.type(screen.getByLabelText('Your relation to them'), 'son');
    await userEvent.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Lakshmi Iyer' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    const [profile] = await services.profiles.list();
    expect(profile).toMatchObject({ name: 'Lakshmi Iyer', relation: 'Mother', caregiverName: 'Ravi Iyer', caregiverRelation: 'son', emergencyContact: 'Ravi Iyer, +91 90000 11111' });
    // Not a sample profile, so its age uses the device's date (todayFor).
    const age = Number(deviceToday().slice(0, 4)) - 1958;
    expect(screen.getAllByRole('button', { name: `Profile: Lakshmi Iyer, Mother, ${age}. Profile menu` })).toHaveLength(3);
  });

  it('"I manage my own records" hides the caregiver fields and sets relation Myself', async () => {
    const { services } = renderWelcome();
    await userEvent.click(await screen.findByRole('button', { name: 'Create a profile' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'I manage my own records' }));
    expect(screen.queryByLabelText('Relation to you')).toBeNull();
    expect(screen.queryByLabelText('Your relation to them')).toBeNull();
    expect(screen.queryByText('You, the caregiver')).toBeNull();
    await userEvent.type(screen.getByLabelText('Your name'), 'Meera Nair');
    await userEvent.click(screen.getByRole('button', { name: 'Create profile' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Meera Nair' })).toBeInTheDocument();
    expect((await services.profiles.list())[0]).toMatchObject({ name: 'Meera Nair', relation: 'Myself', caregiverName: '', caregiverRelation: '', emergencyContact: null });
  });

  it('"Add a profile" opens the form straight away, with a way back', async () => {
    renderWelcome('/welcome?new=profile', true);
    expect(await screen.findByRole('heading', { level: 2, name: 'Create a profile' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
    expect(document.title).toBe('Add a profile · CareVault');
  });
});
