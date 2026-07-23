// Runtime globals supplied by the Google Maps and HERE Maps SDKs.
declare const google: any;
declare const H: any;
declare const __DATA_UPDATED__: string;

interface Window {
  gm_authFailure?: () => void;
  initMapCallback?: () => void;
}
