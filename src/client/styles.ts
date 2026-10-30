/** Scoped plugin styles follow the host's light/dark design tokens. */
export const nativeStyles = `
.dsh-google-native-trigger{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 7px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#686b72);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer}
.dsh-google-native-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.dsh-google-native-trigger:focus-visible,.dsh-google-native-panel button:focus-visible,.dsh-google-native-panel input:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4e73df);outline-offset:2px}
.dsh-google-native-dot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#536dfe)}
.dsh-google-native-panel{position:fixed;z-index:1100;box-sizing:border-box;width:310px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 32px);overflow:auto;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));border-radius:var(--dsw-radius-md,12px);padding:14px;background:var(--dsw-alias-bg-module-platform,#fff);color:var(--dsw-alias-label-primary,#202126);box-shadow:var(--dsw-elevation-prominent,0 8px 32px rgba(0,0,0,.15));font-size:13px;line-height:1.5}
.dsh-google-native-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:3px;font-weight:600}
.dsh-google-native-close{display:grid;place-items:center;width:24px;height:24px;border:0;background:transparent;color:inherit;border-radius:5px;cursor:pointer;font-size:20px;line-height:1}
.dsh-google-native-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.dsh-google-native-caption{margin:0 0 11px;color:var(--dsw-alias-label-caption,#72757c);font-size:12px}
.dsh-google-native-option{display:flex;gap:9px;align-items:flex-start;padding:7px 3px;cursor:pointer}
.dsh-google-native-option input{flex:none;margin:4px 0 0;accent-color:var(--dsw-alias-state-business-primary,#536dfe)}
.dsh-google-native-option:has(input:disabled){opacity:.55;cursor:default}
.dsh-google-native-help{display:block;margin-top:3px;color:var(--dsw-alias-label-caption,#72757c);font-size:12px;line-height:1.5}
.dsh-google-native-divider{height:1px;margin:10px 0;background:var(--dsw-alias-border-l1,rgba(128,128,128,.2))}
.dsh-google-native-section{margin:0 3px 2px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#686b72)}
.dsh-google-native-note{margin:8px 3px 0;color:var(--dsw-alias-label-caption,#72757c);font-size:12px}
.dsh-google-native-status{margin:10px 3px 0;font-size:12px;color:var(--dsw-alias-label-secondary,#686b72)}
.dsh-google-native-error{color:var(--dsw-alias-state-danger-primary,#c22)}
.dsh-google-native-retry{margin-left:8px;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font:inherit}
`
