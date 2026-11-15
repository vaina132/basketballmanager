/**
 * The real next divisions below the chosen leagues, 2026-27 (step 3.4d-4, researched online on 15 November 2026 from
 * the leagues' own sites, press reports and Wikipedia; sources in docs/competition-rules-2026.md). Clubs play here
 * with generated squads (labelled as generated) until promoted. Colours come from the clubs' public identities where
 * a source gives one; sponsor names are left out of club names.
 */
export interface LowerDivisionSource { country: string; tier: number; name: string; season: string; clubs: readonly { name: string; shortName: string; color: string | null }[] }

const club = (name: string, shortName: string, color: string | null = null) => ({ name, shortName, color });

export const LOWER_DIVISIONS_2026: readonly LowerDivisionSource[] = [
  { country: 'Turkey', tier: 3, name: 'Türkiye Basketbol 2. Ligi', season: '2026-27', clubs: [
    club('Teşvikiye SK', 'TES'), club('İTÜ', 'ITU'), club('Türk Telekom Gelişim', 'TTG', '#39C1DB'), club('Antalya Gençlik Spor', 'AGS'), club('Kütahya Belediyespor', 'KUT'),
    club('Çorlu Belediyespor', 'COR'), club('İBB Spor', 'IBB', '#193276'), club('Titan Akademi', 'TIT'), club('Karatay Belediyespor', 'KAR'), club('Manisa BŞB', 'MAN'),
    club('İlkler Şehri Uşak Basket', 'USK'), club('Güngören Doruk', 'GUN'), club('Beylikdüzü Basketbol', 'BEY'), club('Konya BŞB Spor Gelişim', 'KBB', '#FFFF00'),
    club('Akhisar Belediyespor', 'AKH', '#008000'), club('Aliağa Petkimspor Gelişim', 'ALI', '#000000'), club('Kocaeli BŞB Kağıtspor', 'KOC'), club('Watergarden HT', 'WAT'),
    club('Bayrampaşa Belediyesi', 'BAY'), club('ABB EGO Spor', 'EGO'), club('Giresun Kerasusspor', 'GIR'), club('Çorum Belediyespor', 'CRM'),
  ] },
  { country: 'Spain', tier: 3, name: 'Segunda FEB', season: '2026-27', clubs: [
    club('Melilla Ciudad del Deporte', 'MEL', '#1E2C51'), club('Spanish Basketball Academy', 'SBA'), club('CB Morón', 'MOR', '#FF4000'), club('Baloncesto Valladolid', 'VAL', '#4B0082'),
    club('Ciudad de Ponferrada', 'PON', '#0000FF'), club('Cáceres Patrimonio de la Humanidad', 'CAC', '#145A32'), club('CB Toledo Basket', 'TOL', '#008000'), club('CB Getafe', 'GET', '#0000FF'),
    club('Cultural y Deportiva Leonesa', 'LEO'), club('BCBadajoz', 'BAD'), club('Movistar Estudiantes B', 'EST', '#0060FF'), club('Jaén Paraíso Interior FS', 'JAE'),
    club('CB Tres Cantos', 'TCA'), club('CB Algeciras', 'ALG'), club('Basket Cartagena', 'CAR', '#0072CE'), club('Amics Castelló', 'CAS', '#008000'),
    club('Class Bàsquet Sant Antoni', 'SAN', '#000000'), club('Biele ISB', 'ISB', '#000000'), club('CE Bàsquet Llíria', 'LLI', '#FFFF00'), club('UPB Gandía', 'GAN', '#63257F'),
    club('Clavijo', 'CLA', '#314E9E'), club('Huesca La Magia', 'HUE', '#008000'), club('CB Zaragoza', 'ZAR', '#FF0000'), club('Bisbal Bàsquet', 'BIS', '#000000'),
    club('CB Benicarló', 'BEN', '#DF0000'), club('LogroBasket', 'LOG', '#FF0000'), club('Ciudad Molina Basket', 'MOL', '#000080'), club('CB Prat', 'PRA', '#1044BE'),
  ] },
  { country: 'Germany', tier: 2, name: 'ProA', season: '2026-27', clubs: [
    club('Artland Dragons', 'ART', '#000000'), club('BG Göttingen', 'GOE', '#642180'), club('Eisbären Bremerhaven', 'BRE', '#002448'), club('EPG Baskets Koblenz', 'KOB'),
    club('ETB Miners', 'ETB', '#000000'), club('GIESSEN 46ers', 'GIE', '#E30613'), club('Merlins Crailsheim', 'CRA', '#0055AA'), club('Kirchheim Knights', 'KIR', '#FFD900'),
    club('Bayreuth', 'BAY', '#000000'), club('Academics Heidelberg', 'HEI', '#012E4F'), club('Nürnberg Falcons', 'NUE', '#CC0000'), club('OrangeAcademy', 'ORA', '#F36F01'),
    club('Paderborn Baskets', 'PAD', '#DC143C'), club('PS Karlsruhe LIONS', 'KAR', '#004D9B'), club('RheinStars Köln', 'KOE', '#E70000'), club('SBB Börde Baskets', 'SBB', '#FF0000'),
    club('VfL Bochum', 'BOC', '#004D9B'), club('Tigers Tübingen', 'TUE', '#FFFF00'),
  ] },
  { country: 'Greece', tier: 2, name: 'Elite League', season: '2026-27', clubs: [
    club('Panionios', 'PAN', '#E41B17'), club('GS Lavriou', 'LAV', '#FACC2E'), club('AE Psychikou', 'PSY', '#FFDD00'), club('NE Megaridos', 'MEG'),
    club('AEPS Machites Peiramatiko', 'MAC'), club('GS Sofadon', 'SOF'), club('AS Papagou', 'PAP', '#006BB3'), club('GAS Komotini', 'KOM'),
    club('AGE Chalkidas', 'AGE', '#0000FF'), club('AO Amyntas', 'AMY', '#15317E'), club('ASA Koroivos Amaliadas', 'KOR', '#000000'), club('Panerythraikos AS', 'PNE'),
    club('AEO Proteas Voulas', 'PRO', '#FF0000'), club('Anagennisi Arkalochoriou', 'ANA'), club('GS Kronos Agiou Dimitriou', 'KRO'), club('AE Glafkou Esperou Patron', 'GLA'),
  ] },
];
