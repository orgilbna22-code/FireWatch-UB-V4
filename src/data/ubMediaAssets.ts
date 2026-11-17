export const UB_MEDIA = {
  ger: new URL('../assets/images/ub_ger_hillside_1794629996135.jpg', import.meta.url).href,
  apartment: new URL('../assets/images/ub_urban_apartments_1794629996588.jpg', import.meta.url).href,
  mixed: new URL('../assets/images/ub_mixed_settlement_1794629996821.jpg', import.meta.url).href,
  satellite: new URL('../assets/images/ub_satellite_orthophoto_1794629996932.jpg', import.meta.url).href,
} as const;

export function pickSettlementPhoto(gerPercent: number): string {
  if (gerPercent >= 55) return UB_MEDIA.ger;
  if (gerPercent >= 25) return UB_MEDIA.mixed;
  return UB_MEDIA.apartment;
}
