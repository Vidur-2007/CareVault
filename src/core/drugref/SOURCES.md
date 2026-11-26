# Drug reference: sources

`table.json` holds 70 products. Every entry has a `source` key that points at one of the rows below. All sources were read on 2026-11-14. Compositions are per dose unit (one tablet or capsule) and name the active part only: "pantoprazole 40 mg", not "pantoprazole sodium".

Product lists change. Before the demo, check any product you plan to scan against the pack in your hand.

| Key | Source | Entries |
| --- | --- | --- |
| `sun` | Sun Pharma, "India Product list" (brand, generic description, strength, form): https://sunpharma.com/wp-content/uploads/2021/04/INDIA-BUSINESS-product-List.pdf | 40 |
| `sanofi` | Sanofi India, consumer healthcare product table (brand, generic name, strengths): https://www.sanofi.com/en/india/consumer-healthcare/consumer-healthcare-products/all-products | Combiflam Plus, Novalgin NU, Baralgan NU, Buscogast Plus, Allegra 120, Allegra 180, Allegra M |
| `sanofi-pi` | Sanofi India, Combiflam Tablets prescribing information, January 2026 ("Ibuprofen I.P. 400 mg, Paracetamol I.P. 325 mg"): https://www.sanofi.com/assets/countries/india/docs/consumer-healthcare/for-healthcare-professionals/products-information/Combiflam-Tablets-PI-Jan-2026.pdf | Combiflam |
| `alkem` | Alkem Laboratories, Rx products page (pack name and composition): https://www.alkemlabs.com/our-offerings/rx-products | Sumo, Enzoflam, New Sumo Cold, Clavam 625 |
| `alkem-pi` | Alkem Laboratories prescribing information: https://www.alkemlabs.com/pdf/adverse/PAN.pdf and https://www.alkemlabs.com/pdf/adverse/PAN%20D.pdf | Pan 40, Pan D |
| `crocin` | Haleon, Crocin product information leaflets ("Each uncoated tablet contains Paracetamol I.P. 500 mg" / "650 mg"): https://www.crocin.com/content/dam/cf-consumer-healthcare/panadol/en_in/adult/productshots/pdfs/Crocin-650-mg-Product-Info.pdf and https://www.crocin.com/content/dam/cf-consumer-healthcare/panadol/en_in/adult/productshots/pdfs/Crocin-advance-Product-Info.pdf | Crocin 500, Crocin 650, Crocin Advance 500 |
| `gsk` | GSK India, Calpol prescribing information ("Each uncoated tablet contains Paracetamol IP 500 mg" / "650 mg"): https://india-pharma.gsk.com/media/3g4mchgd/calpol-tablets-oral-suspension-and-paediatric-drops.pdf | Calpol 500, Calpol 650 |
| `glenmark` | Glenmark, therapy areas product table (Telma: telmisartan 20/40/80 mg; Telma H: telmisartan 40 mg + hydrochlorothiazide 12.5 mg): https://pqr.glenmarkpharma.com/formulations/therapy-areas | Telma 40, Telma H |
| `cipla` | Cipla, generic product list ("Okacet 10 mg", cetirizine hydrochloride IP 10 mg tablets): https://www.cipla.com/generic-product-list | Okacet 10 |
| `generic` | A generic name with its strength in the name ("Amlodipine 5 mg"). No brand, so nothing to look up. These are the generic lines of the sample case. | 7 |
| `spec` | The project's own spec (overview section 10 and core spec section 6 give Dolo 650 as paracetamol 650 mg). See "Please check" below. | Dolo 650 |

## Evidence levels

Every entry in `table.json` also has an `evidence` level. Reading v2 uses it: only `manufacturer` entries may flag a strength as disagreeing with the reference; the others add a softer warning, and no entry is ever used to correct a value.

| Level | Meaning | Entries |
| --- | --- | --- |
| `manufacturer` | The composition was read on the maker's own product list, label or prescribing information, or quoted from it and confirmed by a second page that was opened (see "Please check") | 59 |
| `secondary` | Seen only through search results quoting the maker's page, which could not be opened | Telma 40, Telma H, Okacet 10 |
| `project` | Taken from this project's own spec or sample case, not from a maker | Dolo 650, and the seven generic names of the sample case (Amlodipine 5 mg, Amlodipine 10 mg, Telmisartan 40 mg, Atorvastatin 10 mg, Rosuvastatin 10 mg, Metformin 500 mg, Pantoprazole 40 mg) |

The generic names state their own composition, but no manufacturer source backs them, so they are `project` rather than `manufacturer`.

## Please check

How each source was read matters, so here is where the evidence is weaker.

- **Dolo 650.** It is in the sample case, so it has to be in the table. Micro Labs' site names Dolo-650 as its paracetamol brand (https://www.microlabsltd.com/therapy/fever-pain-management) but the pages I could open do not print "650 mg". The strength comes from the project spec and the product name. Check it against a pack.
- **Telma 40, Telma H, Okacet 10.** The Glenmark and Cipla pages would not open for a direct read (connection errors). What is recorded comes from search results that quoted those pages, twice and consistently for Telma. Open the pages in a browser and confirm.
- **Crocin Advance 500, Combiflam (prescribing information), Pan 40 and Pan D (prescribing information).** The leaflets were quoted by search results, not opened directly. Each agrees with a second source that was opened: the Crocin 500/650 leaflet, Sanofi's product table and Alkem's product page.
- **Sumo.** Alkem's page gives nimesulide 100 mg + paracetamol 500 mg. Sun Pharma's similar product, Dolamide, has paracetamol 325 mg. Both are recorded as their makers state them.
- **The Sun Pharma list is from April 2021.** It is the company's own list, but products may have changed since.

## Unconfirmed, left out of the table

No manufacturer page or pack label confirmed these, so they are not in `table.json`. Add them after checking a pack.

| Product | Maker | What was found |
| --- | --- | --- |
| Glycomet 500, Glycomet-GP 1 | USV | USV's site names the brands but gives no composition. |
| Ecosprin 75, Ecosprin-AV | USV | Brand named on USV's site, no strength. |
| Amlong 5 | Micro Labs | Brand named, no composition. |
| Stamlo 5, Omez 20 | Dr. Reddy's | Only Russian-market pages and generic lists were found. |
| Telma-AM 40 | Glenmark | The Glenmark table lists only telmisartan 80 mg + amlodipine 5 mg under Telma AM. |
| Okacet Cold | Cipla | Two Cipla pages disagree on the ingredients. |
| Brufen 400 | Abbott | Abbott India lists Brufen as ibuprofen 200, 400 and 600 mg, seen only through a search result. |
| Thyronorm | Abbott | Strengths listed, ingredient not stated next to the brand. |
| Saridon, Disprin, Vicks Action 500, Sinarest, Cheston Cold, Zerodol-P, D-Cold Total | various | Not searched to a manufacturer source. |
| Augmentin 625 Duo, Januvia, Janumet, Galvus, Concor, Met XL | various | Not searched to a manufacturer source. |

## Synonyms

The `synonyms` map in `table.json` holds 26 naming pairs, each an international nonproprietary name against its older British or United States name (acetaminophen and paracetamol, albuterol and salbutamol, frusemide and furosemide, and so on). These come from standard naming, not from a web source, and were not checked individually. Salt forms (hydrochloride, besylate, sodium) are handled in `src/core/rules/normalize.ts`.
