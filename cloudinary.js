// =========================================================
// BALANCE-INV — Subida de fotos a Cloudinary (carga "unsigned")
// =========================================================
// Firebase guarda solo la URL que devuelve Cloudinary; la imagen vive en Cloudinary
// (plan gratis permanente, sin tarjeta). Se reduce la foto en el teléfono antes de subirla
// para gastar menos datos y menos cuota.

function cloudinaryConfigured() {
  const c = window.CLOUDINARY_CONFIG || {};
  return !!c.cloudName && !!c.uploadPreset && !/^TU_/.test(c.cloudName) && !/^TU_/.test(c.uploadPreset);
}

function comprimirImagen(file, maxLado = 1200, calidad = 0.82) {
  return new Promise((ok, fail) => {
    if (!file || !/^image\//.test(file.type)) return fail(new Error('Elige un archivo de imagen.'));
    if (file.size > 15 * 1024 * 1024) return fail(new Error('La imagen pesa más de 15 MB.'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxLado / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);   // los PNG con fondo transparente no quedan negros
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? ok(b) : fail(new Error('No se pudo procesar la imagen.')), 'image/jpeg', calidad);
    };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

async function uploadImageToCloudinary(blob, nombreArchivo) {
  if (!cloudinaryConfigured()) throw new Error('Cloudinary no está configurado todavía (ver cloudinary-config.js).');
  const c = window.CLOUDINARY_CONFIG, fd = new FormData();
  // Con nombre propio, en la biblioteca de Cloudinary cada foto se ve como el código del producto (si no, todas dirían "blob").
  fd.append('file', blob, String(nombreArchivo || 'foto').replace(/[^\w.-]+/g, '_').slice(0, 80));
  fd.append('upload_preset', c.uploadPreset);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${c.cloudName}/image/upload`, { method: 'POST', body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error((err && err.error && err.error.message) || 'No se pudo subir la imagen a Cloudinary.');
  }
  return (await res.json()).secure_url;
}
