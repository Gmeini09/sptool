// Build-time account configuration (scripts/build.mjs → SPTOOL_API_URL, SPTOOL_LICENSE_PUBKEY).
declare const __API_URL__: string;
declare const __LICENSE_PUBKEY__: string;

export const API_URL: string = typeof __API_URL__ !== 'undefined' ? __API_URL__ : '';
/** Raw Ed25519 public key (base64url) of the license server. Tickets not signed by it are ignored. */
export const LICENSE_PUBKEY: string = typeof __LICENSE_PUBKEY__ !== 'undefined' ? __LICENSE_PUBKEY__ : '';

/** Accounts are on when the build knows the license server and its key. Otherwise: local profile only. */
export const accountsEnabled = () => !!API_URL && !!LICENSE_PUBKEY;

/** The owner account (always admin on the server; shown in the UI). */
export const OWNER_DISCORD_ID = '697402284849627180';
