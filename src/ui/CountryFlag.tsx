/** Inline flag geometry works offline and on Windows, where flag emoji often render as country-code letters. */
export function CountryFlag({ country, decorative = false }: { country: string | null; decorative?: boolean }) {
  const name = country === 'Türkiye' ? 'Turkey' : country;
  const flags: Record<string, React.ReactNode> = {
    France: <><path fill="#002395" d="M0 0h10v20H0z"/><path fill="#fff" d="M10 0h10v20H10z"/><path fill="#ed2939" d="M20 0h10v20H20z"/></>,
    Italy: <><path fill="#009246" d="M0 0h10v20H0z"/><path fill="#fff" d="M10 0h10v20H10z"/><path fill="#ce2b37" d="M20 0h10v20H20z"/></>,
    Germany: <><path fill="#151515" d="M0 0h30v7H0z"/><path fill="#d00" d="M0 7h30v6H0z"/><path fill="#ffce00" d="M0 13h30v7H0z"/></>,
    Spain: <><path fill="#aa151b" d="M0 0h30v20H0z"/><path fill="#f1bf00" d="M0 5h30v10H0z"/></>,
    Turkey: <><path fill="#e30a17" d="M0 0h30v20H0z"/><circle fill="#fff" cx="12" cy="10" r="5"/><circle fill="#e30a17" cx="13.5" cy="10" r="4"/><path fill="#fff" d="m19 6.6.8 2.5h2.6l-2.1 1.5.8 2.5-2.1-1.5-2.1 1.5.8-2.5-2.1-1.5h2.6z"/></>,
    Greece: <><path fill="#0d5eaf" d="M0 0h30v20H0z"/>{[1, 3, 5, 7].map(row => <path key={row} fill="#fff" d={`M0 ${row * 20 / 9}h30v${20 / 9}H0z`}/>)}<path fill="#0d5eaf" d="M0 0h11.111v11.111H0z"/><path fill="#fff" d="M4.444 0h2.223v11.111H4.444zM0 4.444h11.111v2.223H0z"/></>,
  };
  if (!name || !flags[name]) return null;
  return <svg className="country-flag" viewBox="0 0 30 20" width="30" height="20" role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `${name} flag`} focusable="false">{flags[name]}</svg>;
}
