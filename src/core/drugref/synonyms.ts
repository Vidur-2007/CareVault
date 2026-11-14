// Ingredient names that mean the same substance. Key: a name as it may be printed.
// Value: the name CareVault stores (the international nonproprietary name).
//
// The list lives in table.json with the rest of the drug reference. Only well-established
// naming pairs belong there (INN against the older British or United States name).
// Different salts are handled in rules/normalize.ts, not here.
import table from './table.json';

export const INGREDIENT_SYNONYMS: Readonly<Record<string, string>> = table.synonyms;
