// External pages built from record fields: carrier tracking and USPTO trademark status.
export const TRACK: Record<string, (x: string) => string> = {
  Maersk: (x) => `https://www.maersk.com/tracking/${encodeURIComponent(x)}`,
  "Hapag-Lloyd": (x) => `https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html?container=${encodeURIComponent(x)}`,
  DHL: (x) => `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(x)}`,
  FedEx: (x) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(x)}`,
  UPS: (x) => `https://www.ups.com/track?tracknum=${encodeURIComponent(x)}`,
  Aramex: (x) => `https://www.aramex.com/us/en/track/results?ShipmentNumber=${encodeURIComponent(x)}`,
};
export const trackUrl = (carrier?: string, num?: string) => (carrier && num && TRACK[carrier] ? TRACK[carrier](num.trim()) : "");
export const usptoUrl = (num?: string) => (num && /^\d{8}$/.test(num.replace(/\D/g, "")) ? `https://tsdr.uspto.gov/#caseNumber=${num.replace(/\D/g, "")}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch` : "");

