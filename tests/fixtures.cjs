const JSZip = require('jszip');
const xml = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

async function fixture({ version = 3, title = '风与书页', author = '林间', series = '蓝色故事', index = 1, cover = true, drm = false, scripted = false } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const seriesMeta = !series ? '' : version === 2
    ? `<meta name="calibre:series" content="${xml(series)}"/><meta name="calibre:series_index" content="${index}"/>`
    : `<meta property="belongs-to-collection" id="series">${xml(series)}</meta><meta refines="#series" property="collection-type">series</meta><meta refines="#series" property="group-position">${index}</meta>`;
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:uuid:lanread-${index}-${version}</dc:identifier><dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator><dc:language>zh-CN</dc:language>${seriesMeta}${cover ? '<meta name="cover" content="cover-img"/>' : ''}${version === 3 ? '<meta property="dcterms:modified">2026-10-06T00:00:00Z</meta>' : ''}</metadata><manifest><item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/>${cover ? '<item id="cover-img" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>' : ''}${version === 3 ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'}</manifest><spine${version === 2 ? ' toc="ncx"' : ''}><itemref idref="ch1"/><itemref idref="ch2"/></spine></package>`);
  zip.file('OEBPS/style.css', 'body{font-family:serif;}h1{font-size:1.5em;}p{margin:0 0 1em;text-indent:2em;}');
  if (cover) zip.file('OEBPS/cover.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect width="400" height="600" fill="#bed6e9"/><rect x="25" y="25" width="350" height="550" fill="none" stroke="#f1f7fc"/><text x="55" y="90" fill="#6489a9" font-size="14">LANREAD / ${index}</text><text x="55" y="255" fill="#345773" font-size="35">${xml(title)}</text><text x="55" y="315" fill="#6c8ba3" font-size="18">${xml(author)}</text><path d="M55 500H110" stroke="#6c8ba3"/></svg>`);
  for (let chapter = 1; chapter <= 2; chapter++) {
    const heading = chapter === 1 ? '第一章 风起' : '第二章 远行';
    const paragraphs = Array.from({ length: 32 }, (_, n) => `<p id="p${n}">第${n + 1}段。风从书页间经过，故事在这里继续。窗外的天空是一片淡蓝色，河流缓缓流过树林。我们带着一本书走向远方，记下沿途的光与影，也把值得回来的地方留在书签里。</p>`).join('');
    zip.file(`OEBPS/chapter${chapter}.xhtml`, `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${heading}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>${heading}</h1>${paragraphs}${scripted ? '<script>window.parent.bookScriptRan = true;</script><img src="https://example.com/tracker.png" alt="remote"/>' : ''}</body></html>`);
  }
  if (version === 3) zip.file('OEBPS/nav.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">第一章 风起</a></li><li><a href="chapter2.xhtml">第二章 远行</a></li></ol></nav></body></html>');
  else zip.file('OEBPS/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="lanread"/></head><docTitle><text>目录</text></docTitle><navMap><navPoint id="ch1" playOrder="1"><navLabel><text>第一章 风起</text></navLabel><content src="chapter1.xhtml"/></navPoint><navPoint id="ch2" playOrder="2"><navLabel><text>第二章 远行</text></navLabel><content src="chapter2.xhtml"/></navPoint></navMap></ncx>');
  if (drm) zip.file('META-INF/encryption.xml', '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/></EncryptedData></encryption>');
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { fixture };
