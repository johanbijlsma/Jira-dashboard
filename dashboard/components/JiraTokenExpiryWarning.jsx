import { useCallback, useEffect, useState } from "react";
import { API } from "../lib/dashboard-constants";

const DOCUMENTATION_URL = "https://planningsagenda.atlassian.net/wiki/spaces/Servicedes/pages/1101168641/Jira-koppeling+met+een+service+account+Doel+vereisten+en+stappenplan";
const formatDate = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "onbekend";
};

export default function JiraTokenExpiryWarning() {
  const [warning, setWarning] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalDismissed, setModalDismissed] = useState(false);

  const refresh = useCallback(() => fetch(`${API}/config/jira-token-warning`).then((r) => r.ok ? r.json() : null).then(setWarning).catch(() => {}), []);
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 5000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => { if (!warning?.api_error) setModalDismissed(false); }, [warning?.api_error]);
  if (!warning?.visible) return null;
  const criticalModal = warning.api_error && !modalDismissed ? <><div style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(25, 44, 46, 0.5)" }} /><section role="alertdialog" aria-modal="true" style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: 41, width: "min(480px, calc(100vw - 32px))", padding: 20, borderRadius: 12, border: "2px solid var(--danger)", background: "var(--surface)", boxShadow: "0 18px 50px var(--shadow-strong)" }}><strong style={{ color: "var(--danger)", fontSize: 18 }}>Jira-koppeling kan geen gegevens ophalen</strong><p style={{ color: "var(--text-main)", lineHeight: 1.5 }}>De token is verlopen of wordt door Jira geweigerd (HTTP {warning.api_error.status_code}). Daardoor worden synchronisatie en live gegevens niet bijgewerkt.</p><p style={{ color: "var(--text-subtle)", lineHeight: 1.5 }}>Vernieuw de token in Jira en laat Development de nieuwe token in de .env-file zetten. De tokenwaarschuwing linksonder blijft zichtbaar totdat de nieuwe token is gevalideerd.</p><button type="button" onClick={() => setModalDismissed(true)} style={{ border: 0, borderRadius: 7, padding: "7px 10px", background: "var(--danger)", color: "#fff", fontWeight: 700 }}>Begrepen</button></section></> : null;
  const isExpired = Number(warning.days_remaining) < 0;
  if (warning.renewal_pending) return <>{criticalModal}<aside style={{ position: "fixed", left: 16, bottom: 16, zIndex: 45, width: "min(390px, calc(100vw - 32px))", padding: 12, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", boxShadow: "0 8px 20px var(--shadow-medium)", fontSize: 12, color: "var(--text-main)" }}><strong>{warning.previous_token_expired ? "Jira-token is verlopen" : "Jira-token vernieuwd in Jira"}{warning.is_test ? " · testmelding" : ""}</strong><div style={{ marginTop: 4, color: "var(--text-subtle)" }}>{warning.previous_token_expired ? <>De oude token is verlopen voordat Development de nieuwe token in de .env-file heeft geüpdatet.<br />Zodra de nieuwe token is gevalideerd sluit deze waarschuwing vanzelf.</> : <>De vervaldatum is aangepast naar <strong style={{ color: "var(--accent)" }}>{formatDate(warning.expires_at)}</strong>.<br />Zodra Development de token heeft geüpdatet in de .env-file sluit deze waarschuwing vanzelf.</>}</div></aside></>;

  const renew = async () => {
    setSaving(true);
    try {
      const url = warning.is_test ? `${API}/dev/jira-token-warning/advance` : `${API}/config/jira-token-warning/renew`;
      const r = await fetch(url, warning.is_test ? { method: "POST" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
      if (r.ok) setWarning(await r.json());
    } finally { setSaving(false); }
  };

  return <>{criticalModal}<aside style={{ position: "fixed", left: 16, bottom: 16, zIndex: 45, width: "min(390px, calc(100vw - 32px))", padding: 12, border: "1px solid color-mix(in srgb, var(--warning) 58%, var(--border))", borderRadius: 10, background: "color-mix(in srgb, var(--brand-yellow) 25%, var(--surface))", boxShadow: "0 8px 20px var(--shadow-medium)", fontSize: 12, color: "var(--text-main)" }}>
    <strong>{isExpired ? "Jira-token is verlopen" : `Jira-token verloopt ${warning.days_remaining != null ? `over ${warning.days_remaining} dagen` : "binnenkort"}`}{warning.is_test ? " · testmelding" : ""}</strong>
    <div style={{ marginTop: 4, color: "var(--text-subtle)" }}>{isExpired ? "Vernieuw de token zo snel mogelijk." : "Vernieuw de token uiterlijk vóór de vervaldatum."} <a href={DOCUMENTATION_URL} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Meer informatie</a></div>
    <label style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: 9 }}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Ik heb vandaag de token vernieuwd in Jira, en de nieuwe token doorgegeven aan Development. Zij passen dit zo snel mogelijk aan in de .env-file.</label>
    <button type="button" disabled={!confirmed || saving} onClick={renew} style={{ marginTop: 9, border: 0, borderRadius: 7, padding: "6px 9px", background: confirmed ? "var(--accent)" : "var(--border)", color: "#fff", fontWeight: 700, cursor: confirmed ? "pointer" : "not-allowed" }}>{saving ? "Opslaan…" : warning.is_test ? "Testmelding sluiten" : "Bevestigen en sluiten"}</button>
  </aside></>;
}
