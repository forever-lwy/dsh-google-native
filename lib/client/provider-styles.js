// rc.5 has no provider-editor override slot: its built-in editor only handles
// llm-deepseek and llm-pi-ai. Keep our working configuration entry and suppress
// the host's unusable Edit action/YAML fallback only on these two native cards.
// These CSS-module classes belong to the pinned host version; recheck on upgrade.
const nativeProviderCard = ':is(li.zGbnIq_rowCard,li.zGbnIq_setupCard):has(>[data-slot="settings.models.provider-card"]>.dsh-google-provider-card[data-google-provider-card="google-ai-studio"],>[data-slot="settings.models.provider-card"]>.dsh-google-provider-card[data-google-provider-card="google-vertex-native"])';
export const providerStyles = `
${nativeProviderCard}>.zGbnIq_rowHead>.zGbnIq_rowActions>button:first-child,
${nativeProviderCard}>.zGbnIq_editor{display:none}
.dsh-google-provider-settings{font-size:14px;line-height:1.5;color:var(--dsw-alias-label-primary,#202126)}
.dsh-google-provider-card{margin-top:12px;font-size:14px;color:var(--dsw-alias-label-primary,#202126)}
.dsh-google-provider-card-panel{padding-top:18px}
.dsh-google-provider-settings h3{font-size:16px;margin:0 0 12px;font-weight:600}
.dsh-google-provider-button{font:inherit;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:7px;padding:7px 12px;background:transparent;color:inherit;cursor:pointer}
.dsh-google-provider-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.dsh-google-provider-settings button:disabled{opacity:.5;cursor:default}
.dsh-google-provider-settings button:focus-visible,.dsh-google-provider-settings input:focus-visible,.dsh-google-provider-settings select:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4e73df);outline-offset:2px}
.dsh-google-provider-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px}
.dsh-google-provider-field{display:flex;min-width:0;flex-direction:column;gap:5px}
.dsh-google-provider-field.wide{grid-column:1/-1}
.dsh-google-provider-field input,.dsh-google-provider-field select,.dsh-google-provider-filter,.dsh-google-provider-manual input{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:7px;padding:8px 10px;font:inherit;color:inherit;background:var(--dsw-alias-bg-module-platform,#fff)}
.dsh-google-provider-field input:disabled,.dsh-google-provider-field select:disabled{opacity:.65}
.dsh-google-provider-hint{margin:0;color:var(--dsw-alias-label-caption,#72757c);font-size:12px;font-weight:400}
.dsh-google-provider-check{display:flex;align-items:flex-start;gap:8px;margin:0 0 16px;cursor:pointer}
.dsh-google-provider-check input,.dsh-google-provider-model input{margin-top:4px;accent-color:var(--dsw-alias-state-business-primary,#536dfe)}
.dsh-google-provider-discover{display:flex;align-items:center;gap:12px;margin:20px 0 8px;flex-wrap:wrap}
.dsh-google-provider-model-section{border-top:1px solid var(--dsw-alias-border-l1,#ddd);margin-top:24px;padding-top:20px}
.dsh-google-provider-model-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.dsh-google-provider-model-heading h3{margin:0}
.dsh-google-provider-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0}
.dsh-google-provider-model-list{max-height:350px;overflow:auto;border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:8px}
.dsh-google-provider-model-entry{border-bottom:1px solid var(--dsw-alias-border-l1,#ddd)}
.dsh-google-provider-model-entry:last-child{border-bottom:0}
.dsh-google-provider-model-head{display:flex;align-items:center;gap:8px;padding-right:10px}
.dsh-google-provider-model{display:flex;align-items:flex-start;gap:9px;padding:11px 12px;cursor:pointer;min-width:0;flex:1}
.dsh-google-provider-model-expand{padding:5px 9px;font-size:12px;white-space:nowrap}
.dsh-google-provider-model-advanced{padding:4px 14px 18px;border-top:1px solid var(--dsw-alias-border-l1,#ddd)}
.dsh-google-provider-model-advanced .dsh-google-provider-grid{margin-top:14px}
.dsh-google-provider-model-advanced fieldset{border:0;padding:0;margin:16px 0 0;min-width:0}
.dsh-google-provider-model-advanced legend{font-weight:500;margin-bottom:6px;padding:0}
.dsh-google-provider-model-types{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:8px}
.dsh-google-provider-model-types label{display:flex;align-items:center;gap:6px;cursor:pointer}
.dsh-google-provider-model-types input{accent-color:var(--dsw-alias-state-business-primary,#536dfe)}
.dsh-google-provider-model-reasoning{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.dsh-google-provider-model-effort{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto;gap:7px;align-items:end}
.dsh-google-provider-model-effort .dsh-google-provider-field{font-size:12px}
.dsh-google-provider-model-effort input,.dsh-google-provider-model-effort select{padding:6px 8px}
.dsh-google-provider-model-summary-error{margin:8px 0;color:var(--dsw-alias-state-danger-primary,#c22);font-size:13px}
.dsh-google-provider-model:has(input:disabled){cursor:default}
.dsh-google-provider-model-content{min-width:0;flex:1}
.dsh-google-provider-model-name{display:block;overflow-wrap:anywhere}
.dsh-google-provider-model-id{display:block;color:var(--dsw-alias-label-caption,#72757c);font-size:12px;overflow-wrap:anywhere}
.dsh-google-provider-model-badge{white-space:nowrap;color:var(--dsw-alias-label-secondary,#686b72);font-size:12px}
.dsh-google-provider-empty{padding:18px 12px;margin:0;color:var(--dsw-alias-label-caption,#72757c)}
.dsh-google-provider-manual{display:flex;gap:8px;margin:14px 0 8px}
.dsh-google-provider-footer{display:flex;align-items:center;gap:12px;margin-top:24px;flex-wrap:wrap}
.dsh-google-provider-primary{background:var(--dsw-alias-state-business-primary,#536dfe);border-color:transparent;color:#fff}
.dsh-google-provider-primary:hover:not(:disabled){filter:brightness(.95);background:var(--dsw-alias-state-business-primary,#536dfe)}
.dsh-google-provider-status{margin:10px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary,#686b72)}
.dsh-google-provider-error{color:var(--dsw-alias-state-danger-primary,#c22)}
@media(max-width:600px){.dsh-google-provider-grid{grid-template-columns:minmax(0,1fr)}.dsh-google-provider-field.wide{grid-column:auto}.dsh-google-provider-model-heading{align-items:flex-start;flex-direction:column}.dsh-google-provider-model-badge{display:none}.dsh-google-provider-model-effort{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
