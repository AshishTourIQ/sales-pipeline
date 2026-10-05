/**
 * Minimal .xlsx reader: unzips the workbook with the browser's DecompressionStream and reads
 * cell values from the sheet XML. Values come back as strings; date cells stay Excel serial
 * numbers, which anyDate() converts. No formatting, formulas are read as their cached value.
 */

type Entry = { method: number; size: number; offset: number };

const td = new TextDecoder();

function zipEntries(buf: ArrayBuffer): Map<string, Entry> {
  const v = new DataView(buf);
  // End of central directory: signature 0x06054b50, within the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Entry>();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("bad zip directory");
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const name = td.decode(new Uint8Array(buf, p + 46, nameLen));
    out.set(name, { method: v.getUint16(p + 10, true), size: v.getUint32(p + 20, true), offset: v.getUint32(p + 42, true) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function readEntry(buf: ArrayBuffer, e: Entry): Promise<string> {
  const v = new DataView(buf);
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  const raw = new Uint8Array(buf, start, e.size);
  if (e.method === 0) return td.decode(raw);
  if (e.method !== 8) throw new Error("unsupported zip compression");
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return td.decode(await new Response(stream).arrayBuffer());
}

const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
const tags = (root: Document | Element, name: string) => Array.from(root.getElementsByTagNameNS("*", name));

/** Text of a shared or inline string, ignoring phonetic runs. */
const richText = (el: Element) =>
  tags(el, "t").filter((t) => t.parentElement?.localName !== "rPh").map((t) => t.textContent ?? "").join("");

/** "BC12" → 54 (0-based column index). */
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function sheetRows(doc: Document, shared: string[], date1904: boolean): string[][] {
  const rows: string[][] = [];
  for (const r of tags(doc, "row")) {
    const row: string[] = [];
    for (const c of tags(r, "c")) {
      const ref = c.getAttribute("r");
      const i = ref ? colIndex(ref) : row.length;
      const t = c.getAttribute("t") ?? "n";
      const v = tags(c, "v")[0]?.textContent ?? "";
      let val = "";
      if (t === "s") val = shared[Number(v)] ?? "";
      else if (t === "inlineStr") val = tags(c, "is")[0] ? richText(tags(c, "is")[0]!) : "";
      else if (t === "b") val = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else if (t === "e") val = "";
      else if (t === "n" && v !== "") {
        const num = Number(v);
        // 1904 date system: shift 5-digit serials so anyDate() reads them as 1900-based
        val = date1904 && /^\d{5}(\.\d+)?$/.test(v) ? String(num + 1462) : String(num);
      } else val = v;
      while (row.length < i) row.push("");
      row[i] = val;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/* ---------- Writer: a plain workbook (inline strings, stored zip) for templates ---------- */

export type XlsxCell = string | number | null | undefined;
export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
  /** Column widths in characters. */
  widths?: number[];
  /** First row bold and frozen. */
  header?: boolean;
  /** 0-based columns formatted as yyyy-mm-dd (typed dates become real dates). */
  dateCols?: number[];
  /** Drop-down lists: column index → range on another sheet, e.g. "Lists!$A$2:$A$9". */
  lists?: { col: number; range: string }[];
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Uncompressed zip: templates are a few KB, so no deflate needed. */
function zip(files: [name: string, text: string][]): Uint8Array<ArrayBuffer> {
  const te = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const n = te.encode(name);
    const data = te.encode(text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + n.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const cd = new Uint8Array(46 + n.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true);
    cd.set(n, 46);
    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

const esc = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const OX = "application/vnd.openxmlformats-officedocument.spreadsheetml";
const LIST_ROWS = 1000;

function sheetXml(s: XlsxSheet): string {
  const dates = new Set(s.dateCols ?? []);
  const colCount = Math.max(s.widths?.length ?? 0, ...s.rows.map((r) => r.length), ...[...dates].map((c) => c + 1));
  const cols = Array.from({ length: colCount }, (_, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${s.widths?.[i] ?? 14}" customWidth="1"${dates.has(i) ? ' style="2"' : ""}/>`).join("");
  const rows = s.rows.map((r, ri) => {
    const cells = r.map((v, ci) => {
      if (v === null || v === undefined || v === "") return "";
      const ref = `${colName(ci)}${ri + 1}`;
      const st = s.header && ri === 0 ? 1 : dates.has(ci) ? 2 : 0;
      return typeof v === "number"
        ? `<c r="${ref}" s="${st}"><v>${v}</v></c>`
        : `<c r="${ref}" t="inlineStr" s="${st}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join("");
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join("");
  const view = s.header
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : "";
  const lists = s.lists?.length
    ? `<dataValidations count="${s.lists.length}">${s.lists.map((l) =>
        `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="warning" errorTitle="Not in the list" error="This value isn't in the list. Keep it anyway?" sqref="${colName(l.col)}2:${colName(l.col)}${LIST_ROWS}"><formula1>${esc(l.range)}</formula1></dataValidation>`).join("")}</dataValidations>`
    : "";
  return `${HEAD}<worksheet ${NS}>${view}<cols>${cols}</cols><sheetData>${rows}</sheetData>${lists}</worksheet>`;
}

/** A small .xlsx workbook built in the browser. */
export function writeXlsx(sheets: XlsxSheet[]): Blob {
  const styles = `${HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const files: [string, string][] = [
    ["[Content_Types].xml", `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/xl/workbook.xml" ContentType="${OX}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${OX}.styles+xml"/>`
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${OX}.worksheet+xml"/>`).join("") + "</Types>"],
    ["_rels/.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `${HEAD}<workbook ${NS}><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
      + `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", styles],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return new Blob([zip(files)], { type: `${OX}.sheet` });
}

async function openWorkbook(buf: ArrayBuffer) {
  const zip = zipEntries(buf);
  const get = async (name: string) => {
    const e = zip.get(name);
    return e ? readEntry(buf, e) : null;
  };
  const wbXml = await get("xl/workbook.xml");
  const relsXml = await get("xl/_rels/workbook.xml.rels");
  if (!wbXml || !relsXml) throw new Error("not an xlsx workbook");
  const wb = xml(wbXml);
  const date1904 = ["1", "true"].includes(tags(wb, "workbookPr")[0]?.getAttribute("date1904") ?? "");
  const targets = new Map(tags(xml(relsXml), "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target") ?? ""]));
  const sheets = tags(wb, "sheet").map((s) => {
    const target = targets.get(s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? s.getAttribute("r:id")) ?? "";
    return { name: s.getAttribute("name") ?? "", path: target.startsWith("/") ? target.slice(1) : `xl/${target}` };
  });
  if (!sheets.length) throw new Error("the workbook has no sheets");

  const ssXml = await get("xl/sharedStrings.xml");
  const shared = ssXml ? tags(xml(ssXml), "si").map(richText) : [];
  const load = async (path: string) => {
    const s = await get(path);
    return s ? sheetRows(xml(s), shared, date1904) : [];
  };
  return { sheets, load };
}

/** Every sheet's rows, by sheet name (the outreach tracker has several tabs). */
export async function readXlsxSheets(buf: ArrayBuffer): Promise<Map<string, string[][]>> {
  const { sheets, load } = await openWorkbook(buf);
  const out = new Map<string, string[][]>();
  for (const s of sheets) out.set(s.name, await load(s.path));
  return out;
}

/** Rows of the sheet named "Lead Tracker", else the first sheet with a "Company" cell, else the first sheet. */
export async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const { sheets, load } = await openWorkbook(buf);
  const hasCompany = (rows: string[][]) => rows.some((r) => r.some((c) => c.trim().toLowerCase() === "company"));

  const named = sheets.find((s) => /lead\s*tracker/i.test(s.name));
  if (named) {
    const rows = await load(named.path);
    if (hasCompany(rows)) return rows;
  }
  let first: string[][] | null = null;
  for (const s of sheets) {
    const rows = await load(s.path);
    first ??= rows;
    if (hasCompany(rows)) return rows;
  }
  return first ?? [];
}
