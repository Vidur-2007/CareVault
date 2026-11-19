// Encrypted backup (UI spec 7.11): export with a passphrase, import with a passphrase after confirming
// that it replaces everything on this device.
import { Download, Upload } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Field } from '../../components/Field';
import { FileDrop } from '../../components/FileDrop';
import { toServiceError } from '../../hooks/toServiceError';
import { useServices, useToast } from '../../hooks/useContexts';

const MIN = 8;

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BackupSection({ today }: { today: string }) {
  const services = useServices();
  const toast = useToast();

  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [exportErrors, setExportErrors] = useState<{ pass?: string; again?: string }>({});
  const [exporting, setExporting] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [importPass, setImportPass] = useState('');
  const [importErrors, setImportErrors] = useState<{ file?: string; pass?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);

  const doExport = async (e: FormEvent) => {
    e.preventDefault();
    const errors: typeof exportErrors = {};
    if (pass.length < MIN) errors.pass = `Please use at least ${MIN} characters. A short sentence is easy to remember.`;
    else if (pass !== again) errors.again = 'The two passphrases do not match.';
    setExportErrors(errors);
    if (errors.pass || errors.again) {
      document.getElementById(errors.pass ? 'backup-pass' : 'backup-again')?.focus();
      return;
    }
    setExporting(true);
    try {
      const blob = await services.backup.export(pass);
      downloadBlob(blob, `carevault-backup-${today}.cvbackup`);
      toast.show({ message: 'Backup saved. Keep the passphrase somewhere safe: without it the backup cannot be opened.', tone: 'success', durationMs: 8000 });
      setPass('');
      setAgain('');
    } catch (err) {
      toast.show({ message: `The backup could not be made. ${toServiceError(err).message}`, tone: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const askImport = (e: FormEvent) => {
    e.preventDefault();
    const errors: typeof importErrors = {};
    if (!file) errors.file = 'Please choose a backup file.';
    if (!importPass) errors.pass = 'Please enter the passphrase used for this backup.';
    setImportErrors(errors);
    if (errors.pass) document.getElementById('restore-pass')?.focus();
    if (errors.file || errors.pass) return;
    setConfirming(true);
  };

  const doImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      await services.backup.import(file, importPass);
      setConfirming(false);
      setFile(null);
      setImportPass('');
      toast.show({ message: 'The backup was restored on this device.', tone: 'success' });
    } catch (err) {
      const e = toServiceError(err);
      setConfirming(false);
      if (e.code === 'bad_passphrase') {
        setImportErrors({ pass: 'The passphrase does not match this backup.' });
        document.getElementById('restore-pass')?.focus();
      } else if (e.code === 'unsupported_file') {
        setImportErrors({ file: 'This is not a CareVault backup file.' });
      } else {
        toast.show({ message: `The backup could not be restored. ${e.message}`, tone: 'error' });
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="backup-title">
      <h2 id="backup-title" className="font-sans text-card-sm font-semibold md:text-card">
        Backup
      </h2>
      <p className="mt-3 text-ink-2">
        Everything lives only on this device. A backup is one encrypted file you can keep elsewhere, for example on a computer. It can only be
        opened with its passphrase.
      </p>

      <div className="mt-6 grid gap-8 wide:grid-cols-2">
        <form noValidate onSubmit={doExport} aria-labelledby="export-title" className="flex flex-col gap-4">
          <h3 id="export-title" className="text-[18px]">
            Save a backup
          </h3>
          <Field
            id="backup-pass"
            label="Passphrase"
            type="password"
            autoComplete="new-password"
            hint={`At least ${MIN} characters.`}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            error={exportErrors.pass}
          />
          <Field
            id="backup-again"
            label="Passphrase again"
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            error={exportErrors.again}
          />
          <Button type="submit" icon={<Download aria-hidden className="size-5" />} loading={exporting} className="self-start">
            Save backup file
          </Button>
        </form>

        <form noValidate onSubmit={askImport} aria-labelledby="import-title" className="flex flex-col gap-4">
          <h3 id="import-title" className="text-[18px]">
            Restore a backup
          </h3>
          <div>
            <FileDrop
              accept=".cvbackup,application/json,application/octet-stream"
              title="Choose a backup file"
              hint="Restoring replaces everything on this device."
              selectedName={file?.name ?? null}
              onFiles={(files) => {
                setFile(files[0] ?? null);
                setImportErrors((e) => ({ ...e, file: undefined }));
              }}
            />
            {importErrors.file && (
              <p role="alert" className="mt-2 text-secondary font-medium text-red-ink">
                {importErrors.file}
              </p>
            )}
          </div>
          <Field
            id="restore-pass"
            label="Passphrase of the backup"
            type="password"
            autoComplete="current-password"
            value={importPass}
            onChange={(e) => setImportPass(e.target.value)}
            error={importErrors.pass}
          />
          <Button type="submit" variant="secondary" icon={<Upload aria-hidden className="size-5" />} className="self-start">
            Restore backup
          </Button>
        </form>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Replace all data on this device?"
        message="Restoring replaces every profile, medicine and record on this device with the contents of the backup. This cannot be undone."
        confirmLabel="Replace and restore"
        tone="danger"
        pending={importing}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void doImport()}
      />
    </Card>
  );
}
