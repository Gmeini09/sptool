// Shown instead of a module the current license tier does not include.
import { Icon } from '../components/Icon';
import { RedeemForm } from './Account';
import { FEATURE_LABEL, FEATURES, TIER_LABEL, TIER_PERKS, TIERS, tierAtLeast, useTier, type Feature, type Tier } from '../account/perms';
import { useAccount } from '../account/account';

export function TierTable({ highlight }: { highlight?: Tier }) {
  const tier = useTier();
  const shown = TIERS.filter((t) => !tierAtLeast(t, 'admin') || tierAtLeast(tier, t)); // Admin/Developer only for those who have it
  return (
    <div className="tier-table">
      {shown.map((t) => (
        <div key={t} className={`tier-col${t === tier ? ' current' : ''}${t === highlight ? ' need' : ''}${tierAtLeast(tier, t) ? ' have' : ''}`}>
          <div className="tier-name">{TIER_LABEL[t]}{t === tier && <span className="chip ok">Dein Plan</span>}{t === highlight && t !== tier && <span className="chip accent">Benötigt</span>}</div>
          <ul>{TIER_PERKS[t].map((p) => <li key={p}><Icon name={tierAtLeast(tier, t) ? 'check' : 'lock'} size={13} />{p}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}

export function LockedView({ feature }: { feature: Feature }) {
  const tier = useTier();
  const need = FEATURES[feature] as Tier;
  const online = useAccount((a) => a.online);
  return (
    <div className="page locked-page">
      <div className="locked-hero">
        <div className="locked-icon"><Icon name="lock" size={30} /></div>
        <div>
          <h2>{FEATURE_LABEL[feature]} benötigt {TIER_LABEL[need]}</h2>
          <p className="muted">Deine Lizenz ist <b>{TIER_LABEL[tier]}</b>. Löse einen {TIER_LABEL[need]}-Key ein, um dieses Modul freizuschalten – er bleibt an dein Discord-Konto gebunden.</p>
        </div>
      </div>
      {need !== 'admin' && online && <div className="panel"><div className="panel-body"><div className="small muted" style={{ marginBottom: 8 }}>Mit einem Lizenz-Key upgraden</div><RedeemForm /></div></div>}
      <TierTable highlight={need} />
    </div>
  );
}
