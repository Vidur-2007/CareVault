// Ingredient names that mean the same substance. Key: a name as it may be printed.
// Value: the name CareVault stores (the international nonproprietary name).
//
// Only well-established naming pairs belong here (INN against the older British or
// United States name). Different salts are handled in rules/normalize.ts, not here.
export const INGREDIENT_SYNONYMS: Readonly<Record<string, string>> = {
  acetaminophen: 'paracetamol',
  'acetylsalicylic acid': 'aspirin',
  albuterol: 'salbutamol',
  levalbuterol: 'levosalbutamol',
  amoxycillin: 'amoxicillin',
  beclomethasone: 'beclometasone',
  cephalexin: 'cefalexin',
  chlorpheniramine: 'chlorphenamine',
  dicyclomine: 'dicycloverine',
  epinephrine: 'adrenaline',
  norepinephrine: 'noradrenaline',
  frusemide: 'furosemide',
  glyburide: 'glibenclamide',
  glycopyrrolate: 'glycopyrronium',
  guaiphenesin: 'guaifenesin',
  hydroxyurea: 'hydroxycarbamide',
  isoproterenol: 'isoprenaline',
  lignocaine: 'lidocaine',
  meperidine: 'pethidine',
  rifampin: 'rifampicin',
  simethicone: 'simeticone',
  thyroxine: 'levothyroxine',
  'l-thyroxine': 'levothyroxine',
  torsemide: 'torasemide',
  'vitamin c': 'ascorbic acid',
  'vitamin d3': 'cholecalciferol',
};
