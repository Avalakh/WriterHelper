import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { marked } from 'marked';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, PageBreak, HeadingLevel, AlignmentType } from 'docx';
import { children, fail, hash } from './store.js';

export const exportFormats = {
  txt: 'text/plain; charset=utf-8', fb2: 'application/x-fictionbook+xml', epub: 'application/epub+zip',
  md: 'text/markdown; charset=utf-8', html: 'text/html; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf',
};
const clean = text => String(text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
const xml = text => clean(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const plain = spans => spans.map(s => s.text).join('');
function inline(tokens, style = {}) {
  return tokens.flatMap(t => {
    if (t.type === 'strong' || t.type === 'em') return inline(t.tokens, {...style, [t.type === 'strong' ? 'bold' : 'italic']: true});
    if (t.tokens) return inline(t.tokens, style);
    return [{...style, text: clean(t.type === 'br' ? '\n' : t.type === 'image' ? t.text : t.text ?? t.raw)}];
  });
}
function blocks(tokens, quote = false) {
  return tokens.flatMap(t => {
    if (t.type === 'space' || t.type === 'def') return [];
    if (t.type === 'hr') return [{kind:'break', spans:[{text:'* * *'}]}];
    if (t.type === 'blockquote') return blocks(t.tokens, true);
    if (t.type === 'list') return t.items.flatMap((item, i) => {
      const list = blocks(item.tokens, quote);
      if (list[0]) list[0].spans.unshift({text: t.ordered ? `${Number(t.start) + i}. ` : '• '});
      return list;
    });
    if (t.type === 'table') return [t.header, ...t.rows].map(row => ({kind:'paragraph', quote, spans: row.flatMap((cell, i) => [...(i ? [{text:' | '}] : []), ...inline(cell.tokens)])}));
    if (t.type === 'text' && t.tokens?.some(v => v.type === 'paragraph')) return blocks(t.tokens, quote);
    return [{kind:t.type === 'heading' ? 'heading' : 'paragraph', quote, spans:t.tokens ? inline(t.tokens) : [{text:clean(t.text ?? t.raw)}]}];
  });
}
export function collectBook(store, bookId) {
  const book = store.get(bookId);
  if (book?.type !== 'book') fail('Выберите книгу для выгрузки', 404);
  const all = children(store, book.id, 'plan').flatMap(p => children(store, p.id, 'chapter'));
  const chapters = all.map(c => {
    const manuscripts = children(store, c.id, 'manuscript');
    const raw = manuscripts.map(m => m.content || '').filter(t => t.trim()).join('\n\n').replace(/\r\n?/g, '\n');
    // Imported manuscripts already contain a chapter heading; the current title owns it.
    const text = raw.replace(/^\s*#\s+[^\n]*(?:\n|$)/, '').trim();
    return {id:c.id, title:`${c.number ? `${c.number}. ` : ''}${c.title}`, text, blocks:blocks(marked.lexer(text)), manuscripts:manuscripts.map(m => ({id:m.id, rev:m.rev}))};
  });
  return {id:book.id, title:book.title, chapters:chapters.filter(c => c.text), skipped:chapters.filter(c => !c.text).map(c => c.title),
    fingerprint:hash(JSON.stringify({book, chapters}))};
}
export function bookExportSummary(store, bookId) {
  const b = collectBook(store, bookId);
  return {title:b.title, chapters:b.chapters.length, skipped:b.skipped, fingerprint:b.fingerprint};
}
const css = 'body{font-family:Georgia,serif;line-height:1.6;max-width:46em;margin:3em auto;padding:0 1em;color:#222}h1,h2{text-align:center}section{break-before:page}p{margin:.6em 0;text-indent:1.5em}blockquote{margin:1em 2em}p.scene-break{text-align:center;text-indent:0}nav li{margin:.4em 0}@media print{body{max-width:none;margin:0}nav{break-after:page}}';
function rich(spans, fb2 = false) {
  return spans.map(s => {
    let t = xml(s.text);
    if (s.italic) t = `<${fb2 ? 'emphasis' : 'em'}>${t}</${fb2 ? 'emphasis' : 'em'}>`;
    if (s.bold) t = `<strong>${t}</strong>`;
    return t;
  }).join('');
}
const htmlBlocks = chapter => chapter.blocks.map(b => b.kind === 'break' ? '<p class="scene-break">* * *</p>' : b.kind === 'heading' ? `<h3>${rich(b.spans)}</h3>` : b.quote ? `<blockquote><p>${rich(b.spans)}</p></blockquote>` : `<p>${rich(b.spans)}</p>`).join('\n');
const xhtml = (title, lang, body) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xml(lang)}" lang="${xml(lang)}"><head><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
async function epub(b, author, lang) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', {compression:'STORE'});
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('EPUB/style.css', css);
  zip.file('EPUB/title.xhtml', xhtml(b.title, lang, `<h1>${xml(b.title)}</h1>${author ? `<p>${xml(author)}</p>` : ''}`));
  const links = b.chapters.map((c,i) => `<li><a href="chapter-${i+1}.xhtml">${xml(c.title)}</a></li>`).join('');
  zip.file('EPUB/nav.xhtml', xhtml(b.title, lang, `<nav epub:type="toc" id="toc"><h1>Оглавление</h1><ol>${links}</ol></nav>`));
  b.chapters.forEach((c,i) => zip.file(`EPUB/chapter-${i+1}.xhtml`, xhtml(c.title, lang, `<h2>${xml(c.title)}</h2>${htmlBlocks(c)}`)));
  zip.file('EPUB/package.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:writerhelper:${xml(b.id)}</dc:identifier><dc:title>${xml(b.title)}</dc:title><dc:language>${xml(lang)}</dc:language>${author ? `<dc:creator>${xml(author)}</dc:creator>` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>${b.chapters.map((c,i) => `<item id="c${i+1}" href="chapter-${i+1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine><itemref idref="title"/>${b.chapters.map((c,i) => `<itemref idref="c${i+1}"/>`).join('')}</spine></package>`);
  return zip.generateAsync({type:'nodebuffer', compression:'DEFLATE'});
}
function fb2(b, author, lang) {
  const authorXml = author ? `<nickname>${xml(author)}</nickname>` : '<first-name/><last-name/>';
  return `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>unrecognised</genre><author>${authorXml}</author><book-title>${xml(b.title)}</book-title><lang>${xml(lang)}</lang></title-info><document-info><author><nickname>WriterHelper</nickname></author><program-used>WriterHelper</program-used><date value="${new Date().toISOString().slice(0,10)}">${new Date().toISOString().slice(0,10)}</date><id>${xml(b.id)}</id><version>1.0</version></document-info></description><body><title><p>${xml(b.title)}</p></title>${b.chapters.map(c => `<section><title><p>${xml(c.title)}</p></title>${c.blocks.map(p => p.kind === 'heading' ? `<subtitle>${rich(p.spans,true)}</subtitle>` : `<p>${rich(p.spans,true)}</p>`).join('')}</section>`).join('')}</body></FictionBook>`;
}
async function docx(b, author) {
  const paragraphs = [new Paragraph({text:b.title, heading:HeadingLevel.TITLE, alignment:AlignmentType.CENTER}), ...(author ? [new Paragraph({text:author, alignment:AlignmentType.CENTER})] : [])];
  for (const c of b.chapters) {
    paragraphs.push(new Paragraph({children:[new PageBreak()]}), new Paragraph({text:c.title, heading:HeadingLevel.HEADING_1}));
    for (const p of c.blocks) paragraphs.push(new Paragraph({
      children:p.spans.flatMap(s => s.text.split('\n').map((text,i) => new TextRun({text, bold:s.bold, italics:s.italic, ...(i ? {break:1} : {})}))),
      ...(p.kind === 'heading' ? {heading:HeadingLevel.HEADING_2} : {}),
      ...(p.kind === 'break' ? {alignment:AlignmentType.CENTER} : {}),
      ...(p.quote ? {indent:{left:480, right:480}} : {}), spacing:{after:160},
    }));
  }
  return Packer.toBuffer(new Document({
    title:b.title, creator:author || '',
    styles:{default:{
      document:{run:{font:'Georgia', size:24, color:'000000'}},
      title:{run:{font:'Georgia', color:'000000', size:44}},
      heading1:{run:{font:'Georgia', color:'000000', size:32}},
      heading2:{run:{font:'Georgia', color:'000000', size:28}},
    }}, sections:[{children:paragraphs}],
  }));
}
function pdf(b, author) {
  const fontRoot = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  const font = ['georgia.ttf','times.ttf','arial.ttf'].map(f => path.join(fontRoot,f)).find(f => fs.existsSync(f));
  if (!font) fail('Для PDF нужен системный шрифт Georgia, Times New Roman или Arial с кириллицей');
  return new Promise((resolve,reject) => {
    const doc = new PDFDocument({size:'A4', margin:54, info:{Title:clean(b.title), Author:clean(author)}}), chunks=[];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.font(font).fontSize(24).text(clean(b.title), {align:'center'});
    if (author) doc.moveDown().fontSize(14).text(clean(author), {align:'center'});
    for (const c of b.chapters) {
      doc.addPage().fontSize(18).text(clean(c.title), {align:'center'}).moveDown();
      for (const p of c.blocks) {
        doc.fontSize(p.kind === 'heading' ? 15 : 12).text(plain(p.spans), {align:p.kind === 'break' ? 'center' : 'left', paragraphGap:8, lineGap:3});
      }
    }
    doc.end();
  });
}
export async function exportBook(store, {book:bookId, format, author = '', language = 'ru', fingerprint}) {
  if (!Object.hasOwn(exportFormats, format)) fail('Неподдерживаемый формат выгрузки');
  if (typeof author !== 'string' || author.length > 300 || typeof language !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) fail('Проверьте автора и язык книги');
  const b = collectBook(store, bookId);
  if (fingerprint && b.fingerprint !== fingerprint) fail('Книга изменилась. Откройте выгрузку заново.', 409);
  if (!b.chapters.length) fail('В книге пока нет заполненных рукописей');
  const preface = [b.title, ...(author ? [author] : [])]; let data;
  if (format === 'txt') data = [...preface, ...b.chapters.map(c => [c.title,...c.blocks.map(p => plain(p.spans))].join('\n\n'))].join('\n\n') + '\n';
  if (format === 'md') data = [`# ${b.title}`, ...(author ? [author] : []), ...b.chapters.map(c => `## ${c.title}\n\n${c.text}`)].join('\n\n') + '\n';
  if (format === 'html') data = `<!doctype html><html lang="${xml(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xml(b.title)}</title><style>${css}</style></head><body><h1>${xml(b.title)}</h1>${author ? `<p>${xml(author)}</p>` : ''}<nav aria-label="Оглавление"><h2>Оглавление</h2><ol>${b.chapters.map((c,i)=>`<li><a href="#c${i+1}">${xml(c.title)}</a></li>`).join('')}</ol></nav>${b.chapters.map((c,i)=>`<section id="c${i+1}"><h2>${xml(c.title)}</h2>${htmlBlocks(c)}</section>`).join('')}</body></html>`;
  if (format === 'fb2') data = fb2(b, author, language);
  if (format === 'epub') data = await epub(b, author, language);
  if (format === 'docx') data = await docx(b, author);
  if (format === 'pdf') data = await pdf(b, author);
  const stem = clean(b.title).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,120) || 'Книга';
  return {data:Buffer.isBuffer(data) ? data : Buffer.from(data,'utf8'), filename:`${stem}.${format}`, mime:exportFormats[format]};
}
