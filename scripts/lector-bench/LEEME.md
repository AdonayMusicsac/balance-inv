# Banco de pruebas del lector de comprobantes

Herramientas (fuera de `www`, no se publican) para medir el lector de PDF/OCR de Compras con muchos formatos distintos.

1. `python3 generar-pdfs.py ./corpus 12` crea facturas PDF sintéticas (14 diseños: SUNAT clásico, Nubefact, logo como imagen, solo precio sin IGV,
   boletas, tickets, varias páginas, dólares, miles con coma…) y `truth.json` con la respuesta correcta de cada una. Requiere `reportlab` y `pillow`.
2. `node medir-pdfs.js ./corpus [-v]` pasa cada PDF por pdf.js + el lector real y muestra cuántas salen perfectas por diseño.
   Requiere `npm i pdfjs-dist@3.11.174 jsdom` (en una carpeta aparte).
3. `node medir-ocr.js` hace lo mismo sobre imágenes (`pdftoppm -r 200 -png`) leídas con tesseract.js.

Las pruebas rápidas de azar que corren con `npm test` están en `tests/lector-fuzz.test.js`.
