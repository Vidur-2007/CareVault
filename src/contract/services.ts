// CareVault contract v2: the services interface both laptops build against.
// FROZEN after Phase 0. Copied from docs/specs/00-overview.spec.md, section 8; change only
// through docs/contract-requests-<side>.md. The v1 contract is in ./legacy until the merge checkpoint.

import type * as T from './types';

export interface CareVaultServices {
  profiles: {
    list(): Promise<T.Profile[]>;
    create(input: Omit<T.Profile, 'id' | 'createdAt'>): Promise<T.Profile>;
    update(id: T.ID, patch: Partial<Omit<T.Profile, 'id' | 'createdAt'>>): Promise<T.Profile>;
    loadSampleProfile(): Promise<T.Profile>;            // seeds both sample profiles, idempotent
    prescribers(profileId: T.ID): Promise<T.Prescriber[]>;
    // Returns the existing prescriber when the name matches case-insensitively.
    addPrescriber(profileId: T.ID, input: { name: string; specialty: string }): Promise<T.Prescriber>;
  };

  documents: {
    // Stores the original first, as 'pending_review'. Reading happens afterwards.
    add(profileId: T.ID, file: Blob, meta: { source: T.DocumentRecord['source']; title?: string }):
      Promise<{ record: T.DocumentRecord; duplicate: T.DuplicateInfo | null }>;
    get(id: T.ID): Promise<T.DocumentRecord>;
    list(profileId: T.ID): Promise<T.DocumentRecord[]>;           // newest clinical date first, undated last
    update(id: T.ID, patch: Partial<Pick<T.DocumentRecord,
      'kind' | 'title' | 'clinicalDate' | 'prescriberId' | 'facility' | 'tags' | 'testNames' | 'starred'>>):
      Promise<T.DocumentRecord>;                                   // clinicalDate set here makes dateSource 'user'
    file(id: T.ID): Promise<T.DocumentRecord & { blob: Blob }>;    // also works for the shipped sample documents
    fileRecord(id: T.ID): Promise<T.DocumentRecord>;               // marks it 'filed'
    remove(id: T.ID): Promise<{ snapshotsMentioning: T.ID[]; activeShares: T.ShareLink[] }>;
    assignProfile(id: T.ID, profileId: T.ID): Promise<T.DocumentRecord>;  // for unassigned email imports
    fields(id: T.ID): Promise<T.FieldEvidence[]>;
    reviewFields(id: T.ID, decisions: T.FieldDecision[]): Promise<T.FieldEvidence[]>;
  };

  reading: {
    // Reads a stored document. Never stores routine changes. Human field decisions are kept on re-read.
    read(documentId: T.ID, opts: { allowCloud: boolean }): Promise<T.ExtractionCandidate>;
  };

  prescriptions: {
    // Stores the prescription lines. Never changes the routine. Returns the proposal,
    // or null when nothing differs from the routine.
    save(documentId: T.ID, prescriberId: T.ID, lines: T.ExtractedLine[]):
      Promise<{ lines: T.PrescriptionLine[]; proposal: T.RoutineProposal | null }>;
    lines(documentId: T.ID): Promise<T.PrescriptionLine[]>;
  };

  routine: {
    list(profileId: T.ID): Promise<T.RoutineMedicine[]>;
    get(id: T.ID): Promise<T.RoutineMedicine>;
    history(medicineId: T.ID): Promise<T.RoutineEvent[]>;
    profileHistory(profileId: T.ID): Promise<T.RoutineEvent[]>;
    revision(profileId: T.ID): Promise<number>;
    add(profileId: T.ID, input: T.RoutineMedicineInput,
      opts: { status: 'taking' | 'uncertain'; source: T.RoutineSource; documentId: T.ID | null }):
      Promise<T.RoutineMedicine>;
    update(id: T.ID, patch: Partial<T.RoutineMedicineInput>): Promise<T.RoutineMedicine>;
    setStatus(id: T.ID, status: T.RoutineStatus): Promise<T.RoutineMedicine>;
    undo(eventId: T.ID): Promise<T.RoutineMedicine>;
    // Contextual review
    proposalFor(documentId: T.ID): Promise<T.RoutineProposal | null>;  // recomputed if the routine changed
    decide(proposalId: T.ID, decisions: T.RowDecision[], expectedRevision: number):
      Promise<{ proposal: T.RoutineProposal; changed: T.RoutineMedicine[]; questionsAdded: T.Question[] }>;
    dismiss(proposalId: T.ID): Promise<T.RoutineProposal>;
    // Batch review of migrated (legacy) entries
    resolveLegacy(profileId: T.ID, takingIds: T.ID[], notTakingIds: T.ID[]): Promise<T.RoutineMedicine[]>;
    ingredientTotals(profileId: T.ID): Promise<T.IngredientTotal[]>;
  };

  health: {
    list(profileId: T.ID): Promise<T.HealthEntry[]>;
    add(profileId: T.ID, input: Omit<T.HealthEntry, 'id' | 'profileId' | 'recordedAt'>): Promise<T.HealthEntry>;
    remove(id: T.ID): Promise<void>;
  };

  attention: {
    list(profileId: T.ID): Promise<T.AttentionItem[]>;
  };

  records: {
    search(profileId: T.ID, query: T.RecordQuery): Promise<T.RecordHit[]>;
    ask(profileId: T.ID, question: string): Promise<T.AskAnswer>;
  };

  visits: {
    next(profileId: T.ID): Promise<T.Visit | null>;
    save(visit: Omit<T.Visit, 'id'> & { id?: T.ID }): Promise<T.Visit>;
    addQuestion(visitId: T.ID, text: string, link?: { medicineId?: T.ID; documentId?: T.ID }): Promise<T.Visit>;
    removeQuestion(visitId: T.ID, questionId: T.ID): Promise<T.Visit>;
    setSharedDocuments(visitId: T.ID, documentIds: T.ID[]): Promise<T.Visit>;
  };

  passport: {
    live(profileId: T.ID): Promise<T.Passport>;        // computed now, never stored
    snapshot(profileId: T.ID, reason: T.PassportSnapshot['reason']): Promise<T.PassportSnapshot>;
    // Reuses the latest snapshot when the live passport is identical to it.
    snapshots(profileId: T.ID): Promise<T.PassportSnapshot[]>;   // newest first
    getSnapshot(id: T.ID): Promise<T.PassportSnapshot>;
  };

  sharing: {
    create(snapshotId: T.ID, hours: number): Promise<T.ShareLink>;
    list(profileId: T.ID): Promise<T.ShareLink[]>;     // never returns another profile's links
    listUnowned(): Promise<T.ShareLink[]>;            // v1 links whose owner cannot be proven; Settings only
    revoke(id: T.ID): Promise<void>;
    open(id: T.ID, key: string): Promise<T.PassportSnapshot>;   // public /share/:id page
  };

  gmail: {
    connect(): Promise<void>;
    findCandidates(profileId: T.ID): Promise<T.GmailCandidate[]>;   // one row per PDF attachment
    importAttachment(profileId: T.ID, messageId: string, attachmentId: string):
      Promise<{ record: T.DocumentRecord; duplicate: T.DuplicateInfo | null }>;
  };

  backup: {
    export(passphrase: string): Promise<Blob>;
    import(file: Blob, passphrase: string): Promise<void>;          // reads v1 and v2 backups
  };

  settings: {
    get(): Promise<{ cloudReadingAllowed: boolean }>;
    setCloudReadingAllowed(value: boolean): Promise<void>;
  };

  subscribe(listener: () => void): () => void;
}
