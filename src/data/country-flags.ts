/**
 * Country names to flag codes (owner feedback, 22 November 2026, evening: real flags everywhere instead of emoji, which
 * Windows shows as letter pairs such as "HR"). Codes are ISO 3166-1 alpha-2, plus Kosovo's XK and the home nations of
 * the United Kingdom (GB-ENG, GB-SCT, GB-WLS, GB-NIR), as named by the `country-flag-icons` flag set (MIT).
 *
 * Every spelling the game meets is listed: the data pack's nationalities and club countries, the national teams, staff
 * nationalities and the manager's suggestions, plus common variants ("Türkiye", "Bosnia", "Czechia", "Côte d'Ivoire",
 * "Congo DR", "USA", "Great Britain"). Anything else (a club or city name that slipped into a nationality field) has
 * no flag and stays blank. `tests/country-flags.test.ts` checks the pack's list.
 */
const NAMES: Readonly<Record<string, string>> = {
  Afghanistan: 'AF', Albania: 'AL', Algeria: 'DZ', Andorra: 'AD', Angola: 'AO', 'Antigua and Barbuda': 'AG', Argentina: 'AR', Armenia: 'AM',
  Aruba: 'AW', Australia: 'AU', Austria: 'AT', Azerbaijan: 'AZ', Bahamas: 'BS', 'The Bahamas': 'BS', Bahrain: 'BH', Bangladesh: 'BD',
  Barbados: 'BB', Belarus: 'BY', Belgium: 'BE', Belize: 'BZ', Benin: 'BJ', Bermuda: 'BM', Bhutan: 'BT', Bolivia: 'BO',
  'Bosnia and Herzegovina': 'BA', 'Bosnia & Herzegovina': 'BA', 'Bosnia-Herzegovina': 'BA', Bosnia: 'BA', Botswana: 'BW', Brazil: 'BR',
  'British Virgin Islands': 'VG', 'Virgin Islands, British': 'VG', Brunei: 'BN', Bulgaria: 'BG', 'Burkina Faso': 'BF', Burundi: 'BI',
  'Cabo Verde': 'CV', 'Cape Verde': 'CV', Cambodia: 'KH', Cameroon: 'CM', Canada: 'CA', 'Cayman Islands': 'KY', 'Central African Republic': 'CF',
  Chad: 'TD', Chile: 'CL', China: 'CN', "People's Republic of China": 'CN', 'Chinese Taipei': 'TW', Taiwan: 'TW', Colombia: 'CO', Comoros: 'KM',
  'Democratic Republic of the Congo': 'CD', 'DR Congo': 'CD', 'Congo DR': 'CD', 'Congo-DR': 'CD', 'D.R. Congo': 'CD', 'Congo-Kinshasa': 'CD', 'Congo - Kinshasa': 'CD',
  'Republic of the Congo': 'CG', Congo: 'CG', 'Congo-Brazzaville': 'CG', 'Congo - Brazzaville': 'CG', 'Costa Rica': 'CR',
  "Côte d'Ivoire": 'CI', "Cote d'Ivoire": 'CI', 'Ivory Coast': 'CI', Croatia: 'HR', Cuba: 'CU', 'Curaçao': 'CW', Cyprus: 'CY',
  Czechia: 'CZ', 'Czech Republic': 'CZ', Denmark: 'DK', Djibouti: 'DJ', Dominica: 'DM', 'Dominican Republic': 'DO', Ecuador: 'EC', Egypt: 'EG',
  'El Salvador': 'SV', England: 'GB-ENG', 'Equatorial Guinea': 'GQ', Eritrea: 'ER', Estonia: 'EE', Eswatini: 'SZ', Swaziland: 'SZ', Ethiopia: 'ET',
  'Faroe Islands': 'FO', Fiji: 'FJ', Finland: 'FI', France: 'FR', Gabon: 'GA', Gambia: 'GM', 'The Gambia': 'GM', Georgia: 'GE', Germany: 'DE',
  Ghana: 'GH', 'Great Britain': 'GB', Greece: 'GR', Greenland: 'GL', Grenada: 'GD', Guam: 'GU', Guatemala: 'GT', Guinea: 'GN', 'Guinea-Bissau': 'GW',
  Guyana: 'GY', Haiti: 'HT', Holland: 'NL', Honduras: 'HN', 'Hong Kong': 'HK', 'Hong Kong, China': 'HK', Hungary: 'HU', Iceland: 'IS', India: 'IN',
  Indonesia: 'ID', Iran: 'IR', 'IR Iran': 'IR', Iraq: 'IQ', Ireland: 'IE', 'Republic of Ireland': 'IE', Israel: 'IL', Italy: 'IT', Jamaica: 'JM',
  Japan: 'JP', Jordan: 'JO', Kazakhstan: 'KZ', Kenya: 'KE', Kiribati: 'KI', Kosovo: 'XK', Kuwait: 'KW', Kyrgyzstan: 'KG', Laos: 'LA', Latvia: 'LV',
  Lebanon: 'LB', Lesotho: 'LS', Liberia: 'LR', Libya: 'LY', Liechtenstein: 'LI', Lithuania: 'LT', Luxembourg: 'LU', Macau: 'MO', Macao: 'MO',
  'North Macedonia': 'MK', Macedonia: 'MK', 'FYR Macedonia': 'MK', Madagascar: 'MG', Malawi: 'MW', Malaysia: 'MY', Maldives: 'MV', Mali: 'ML',
  Malta: 'MT', 'Marshall Islands': 'MH', Mauritania: 'MR', Mauritius: 'MU', Mexico: 'MX', Micronesia: 'FM', 'Federated States of Micronesia': 'FM',
  Moldova: 'MD', Monaco: 'MC', Mongolia: 'MN', Montenegro: 'ME', Morocco: 'MA', Mozambique: 'MZ', Myanmar: 'MM', Burma: 'MM', Namibia: 'NA',
  Nauru: 'NR', Nepal: 'NP', Netherlands: 'NL', 'The Netherlands': 'NL', 'New Zealand': 'NZ', Nicaragua: 'NI', Niger: 'NE', Nigeria: 'NG',
  'North Korea': 'KP', 'Northern Ireland': 'GB-NIR', Norway: 'NO', Oman: 'OM', Pakistan: 'PK', Palau: 'PW', Palestine: 'PS', Panama: 'PA',
  'Papua New Guinea': 'PG', Paraguay: 'PY', Peru: 'PE', Philippines: 'PH', Poland: 'PL', Portugal: 'PT', 'Puerto Rico': 'PR', Qatar: 'QA',
  Romania: 'RO', Russia: 'RU', 'Russian Federation': 'RU', Rwanda: 'RW', 'Saint Kitts and Nevis': 'KN', 'Saint Lucia': 'LC',
  'Saint Vincent and the Grenadines': 'VC', Samoa: 'WS', 'San Marino': 'SM', 'São Tomé and Príncipe': 'ST', 'Saudi Arabia': 'SA', Scotland: 'GB-SCT',
  Senegal: 'SN', Serbia: 'RS', Seychelles: 'SC', 'Sierra Leone': 'SL', Singapore: 'SG', Slovakia: 'SK', 'Slovak Republic': 'SK', Slovenia: 'SI',
  'Solomon Islands': 'SB', Somalia: 'SO', 'South Africa': 'ZA', 'South Korea': 'KR', Korea: 'KR', 'Republic of Korea': 'KR', 'Korea, South': 'KR',
  'South Sudan': 'SS', Spain: 'ES', 'Sri Lanka': 'LK', Sudan: 'SD', Suriname: 'SR', Sweden: 'SE', Switzerland: 'CH', Syria: 'SY', Tajikistan: 'TJ',
  Tanzania: 'TZ', Thailand: 'TH', 'Timor-Leste': 'TL', 'East Timor': 'TL', Togo: 'TG', Tonga: 'TO', 'Trinidad and Tobago': 'TT', 'Trinidad & Tobago': 'TT',
  Tunisia: 'TN', Turkey: 'TR', Türkiye: 'TR', Turkmenistan: 'TM', Tuvalu: 'TV', Uganda: 'UG', Ukraine: 'UA', 'United Arab Emirates': 'AE', UAE: 'AE',
  'United Kingdom': 'GB', UK: 'GB', 'United States': 'US', 'United States of America': 'US', USA: 'US', 'U.S.A.': 'US', US: 'US',
  'US Virgin Islands': 'VI', 'U.S. Virgin Islands': 'VI', Uruguay: 'UY', Uzbekistan: 'UZ', Vanuatu: 'VU', 'Vatican City': 'VA', Venezuela: 'VE',
  Vietnam: 'VN', Wales: 'GB-WLS', Yemen: 'YE', Zambia: 'ZM', Zimbabwe: 'ZW',
}

/** Case, accents, apostrophes and spacing do not matter ("Türkiye", "turkiye", "Côte d’Ivoire"). */
function normalize(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase()
}
const CODES: ReadonlyMap<string, string> = new Map(Object.entries(NAMES).map(([name, code]) => [normalize(name), code]))

/** The flag code of a country name, or null when the name is no country the game knows. */
export function countryFlagCode(country: string | null | undefined): string | null {
  return country ? CODES.get(normalize(country)) ?? null : null
}

/** Every flag code the game can show (the flag files the build must include). */
export const FLAG_CODES: readonly string[] = Object.freeze([...new Set(Object.values(NAMES))].sort())
