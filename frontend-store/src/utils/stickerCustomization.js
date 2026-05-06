export function isStickerProduct(product) {
  const category = String(product?.category_name || product?.category || '').trim().toLowerCase();
  return category === 'sticker' || product?.device_customization_enabled === 1 || product?.device_customization_enabled === true;
}

export function getDeviceModelValue(value) {
  return String(value || '').trim();
}
