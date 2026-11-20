import type * as T from './types';

export interface CareVaultServices {
  profiles: {
    list(): Promise<T.Profile[]>;
    create(input: Omit<T.Profile, 'id' | 'createdAt'>): Promise<T.Profile>;
    loadSampleProfile(): Promise<T.Profile>;      // seeds the demo case, idempotent
    prescribers(profileId: T.ID): Promise<T.Prescriber[]>;
  };
  medicines: {
    list(profileId: T.ID): Promise<T.Medicine[]>;
    get(id: T.ID): Promise<T.Medicine>;
    history(medicineId: T.ID): Promise<T.MedicationEvent[]>;
    addFromLine(profileId: T.ID, line: T.ExtractedLine,
      opts: { origin: T.Medicine['origin']; documentId: T.ID | null }): Promise<T.Medicine>;
    confirm(id: T.ID, patch?: Partial<Pick<T.Medicine,
      'productName' | 'ingredients' | 'form' | 'dosesPerDay' | 'instruction'>>): Promise<T.Medicine>;
    setStatus(id: T.ID, status: T.MedicineStatus): Promise<T.Medicine>;
    ingredientTotals(profileId: T.ID): Promise<T.IngredientTotal[]>;  // only ingredients in 2+ active medicines
  };
  reading: {
    read(file: Blob, opts: { allowCloud: boolean }): Promise<T.ExtractionCandidate>;
  };
  documents: {
    list(profileId: T.ID): Promise<T.DocumentRecord[]>;
    get(id: T.ID): Promise<T.DocumentRecord>;
    add(profileId: T.ID, file: Blob, meta: Pick<T.DocumentRecord,
      'type' | 'title' | 'documentDate' | 'source' | 'prescriberId'>):
      Promise<{ record: T.DocumentRecord; duplicateOf: T.ID | null }>;
    confirm(id: T.ID): Promise<T.DocumentRecord>;
    remove(id: T.ID): Promise<void>;
    star(id: T.ID, starred: boolean): Promise<T.DocumentRecord>;
    file(id: T.ID): Promise<Blob>;
    search(profileId: T.ID, text: string): Promise<T.DocumentRecord[]>;
  };
  prescriptions: {
    // Saves confirmed lines for a prescription document, updates medicines, creates review items.
    apply(profileId: T.ID, documentId: T.ID, prescriberId: T.ID,
      lines: T.ExtractedLine[]): Promise<T.PrescriptionDiff>;
    latestDiff(profileId: T.ID, prescriberId: T.ID): Promise<T.PrescriptionDiff | null>;
  };
  review: {
    listOpen(profileId: T.ID): Promise<T.ReviewItem[]>;
    resolve(id: T.ID, resolution: T.ReviewResolution,
      opts?: { keepMedicineId?: T.ID }): Promise<void>;
  };
  visits: {
    next(profileId: T.ID): Promise<T.Visit | null>;
    save(visit: Omit<T.Visit, 'id'> & { id?: T.ID }): Promise<T.Visit>;
    addQuestion(visitId: T.ID, text: string): Promise<T.Visit>;
    removeQuestion(visitId: T.ID, questionId: T.ID): Promise<T.Visit>;
    setSharedDocuments(visitId: T.ID, documentIds: T.ID[]): Promise<T.Visit>;
    changeSummary(profileId: T.ID): Promise<T.ChangeSummary | null>;
    buildPassport(profileId: T.ID): Promise<T.Passport>;
  };
  sharing: {
    create(passport: T.Passport, hours: number): Promise<T.ShareLink>;
    list(): Promise<T.ShareLink[]>;
    revoke(id: T.ID): Promise<void>;
    open(id: T.ID, key: string): Promise<T.Passport>;   // used by the public /share/:id page
  };
  gmail: {
    connect(): Promise<void>;                            // opens Google consent
    findCandidates(): Promise<T.GmailCandidate[]>;
    importAttachment(profileId: T.ID, messageId: string): Promise<T.DocumentRecord>;
  };
  backup: {
    export(passphrase: string): Promise<Blob>;
    import(file: Blob, passphrase: string): Promise<void>;
  };
  settings: {
    get(): Promise<{ cloudReadingAllowed: boolean }>;
    setCloudReadingAllowed(value: boolean): Promise<void>;
  };
  // Fires after any write. The UI re-runs its queries.
  subscribe(listener: () => void): () => void;
}
