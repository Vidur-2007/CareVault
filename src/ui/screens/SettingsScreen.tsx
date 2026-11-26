// Settings, UI spec 4.13: profiles (edit, emergency contact, add, switch), doctors, cloud reading,
// Gmail for this session, backup (with the version note), older share links and sample data.
import { ShieldCheck, Smartphone } from 'lucide-react';
import { useLocation } from 'react-router';
import { Card } from '../components/Card';
import { useProfile } from '../hooks/useContexts';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { BackupSection } from './settings/BackupSection';
import {
  CloudReadingSection, DoctorsSection, GmailSection, OlderLinksSection, ProfilesSection, SampleSection,
} from './settings/SettingsSections';

export function SettingsScreen() {
  useDocumentTitle('Settings');
  const { today } = useProfile();
  const location = useLocation();

  return (
    <div className="page-gutter py-6 md:py-12">
      <h1 className="text-page-sm md:text-page">Settings</h1>
      <p className="mt-3 max-w-2xl text-ink-2 md:text-[20px] md:leading-[1.5]">Profiles, doctors, privacy and backups for this device.</p>

      <div className="mt-8 flex max-w-4xl flex-col gap-6 md:mt-10">
        <ProfilesSection startAdding={location.hash === '#add-profile'} />
        <DoctorsSection />
        <CloudReadingSection />
        <GmailSection />
        <BackupSection today={today} />
        <OlderLinksSection />
        <SampleSection />

        <Card as="section" aria-labelledby="about-title">
          <h2 id="about-title" className="font-sans text-card-sm font-semibold md:text-card">About CareVault</h2>
          <ul className="mt-3 flex flex-col gap-3 text-ink-2">
            <li className="flex gap-3">
              <Smartphone aria-hidden className="mt-0.5 size-5 shrink-0 text-teal" />
              <span>
                Your records stay on this device. They leave it only when you send a hard-to-read page to the cloud reader, import from Gmail, or
                share a passport, which is encrypted on this device first.
              </span>
            </li>
            <li className="flex gap-3">
              <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-teal" />
              <span>
                CareVault is not medical advice. It lists what you entered and confirmed, and never tells anyone to start or stop a medicine. Please
                check with a pharmacist or the prescriber.
              </span>
            </li>
          </ul>
          <p className="mt-4 text-secondary text-ink-3">All sample data is synthetic.</p>
        </Card>
      </div>
    </div>
  );
}
