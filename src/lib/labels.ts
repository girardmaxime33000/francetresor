export const AUCTION_TYPES: Record<string, string> = {
  adju_MT: 'Moyen terme',
  adju_LT: 'Long terme',
  adju_MLT: 'Moyen et long terme',
  adju_I: 'Indexées',
};

export const SYND_TYPES: Record<string, string> = {
  synd_LT: 'Long terme',
  synd_I: 'Indexées',
};

export const OPERATIONS: Record<string, string> = {
  emission: 'Émission',
  rachat: 'Rachat',
};

export const INDEX_TYPES: Record<string, string> = {
  inflation_france: 'OATi (inflation française)',
  inflation_zone_euro: 'OAT€i (inflation zone euro)',
};

export const BTF_SEGMENTS = ['3 mois', '6 mois', '12 mois'] as const;

export const MATURITY_BUCKETS = ['2 à 7 ans', '7 à 15 ans', 'Plus de 15 ans'] as const;

export const HOME = '/';
