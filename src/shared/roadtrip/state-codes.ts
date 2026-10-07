/**
 * The OFFICIAL abbreviations of the states, where a country writes its towns
 * with one — «Cairns, QLD», «Austin, TX», «Banff, AB» (ISO 3166-2 and the
 * postal codes, identical for these three). 2026-10-07, the maintainer's «corrige
 * aussi QLD»: deriving a code from the name gave Queensland QUE, which no
 * Australian reads.
 *
 * It reverses «no table of codes is shipped» (v30) for these countries only:
 * a place's own code, the trip's table and the search's answer still come
 * first (`stateCodeFor`), and a state outside these lists still derives.
 * Matched by the state's NAME (accents and case forgiven), within the place's
 * country when it has one — «Northern Territory» is NT in both Australia and
 * Canada, and only the name tells «Western Australia» from «Washington».
 */

const AU: Record<string, string> = {
  'New South Wales': 'NSW',
  Victoria: 'VIC',
  Queensland: 'QLD',
  'South Australia': 'SA',
  'Western Australia': 'WA',
  Tasmania: 'TAS',
  'Northern Territory': 'NT',
  'Australian Capital Territory': 'ACT',
  'Jervis Bay Territory': 'JBT',
};

const CA: Record<string, string> = {
  Alberta: 'AB',
  'British Columbia': 'BC',
  Manitoba: 'MB',
  'New Brunswick': 'NB',
  'Newfoundland and Labrador': 'NL',
  'Nova Scotia': 'NS',
  Ontario: 'ON',
  'Prince Edward Island': 'PE',
  Quebec: 'QC',
  Saskatchewan: 'SK',
  'Northwest Territories': 'NT',
  Nunavut: 'NU',
  Yukon: 'YT',
};

const US: Record<string, string> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
  'District of Columbia': 'DC',
  'Washington, D.C.': 'DC',
  'Puerto Rico': 'PR',
};

const BY_COUNTRY: Record<string, Record<string, string>> = { AU, CA, US };

function key(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

const INDEX: Record<string, Map<string, string>> = Object.fromEntries(
  Object.entries(BY_COUNTRY).map(([country, table]) => [country, new Map(Object.entries(table).map(([name, code]) => [key(name), code]))]),
);

/**
 * The official abbreviation of a state, '' when none is known: within the
 * place's country when it has one, else the first country listing the name.
 */
export function officialStateCode(state: string, countryCode?: string): string {
  const k = key(state);
  if (!k) return '';
  const country = (countryCode ?? '').trim().toUpperCase();
  if (country) return INDEX[country]?.get(k) ?? '';
  for (const table of Object.values(INDEX)) {
    const code = table.get(k);
    if (code) return code;
  }
  return '';
}
