// BALANCE-INV — Cloudinary (fotos de producto para el catálogo).
// cloudName: aparece en tu panel de Cloudinary (Dashboard → Cloud name).
// uploadPreset: debe existir en Settings → Upload → Upload presets, con Signing mode "Unsigned".
//   La carpeta de destino se define EN EL PRESET (Asset folder), no aquí.
// No pegues nunca el API Key ni el API Secret en este archivo.
window.CLOUDINARY_CONFIG = {
  cloudName: 'djvnquks',
  uploadPreset: 'balanceinv_fotos'
};
