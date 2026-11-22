// A faster drop-in for csv-reader 1.0.0: run(input) returns exactly what
// csv-reader returns for {text, header} -> {columns, rows, errors}.
//
// How it works, in one pass over the text:
//  - Unquoted fields are scanned with charCodeAt and taken out with a
//    single slice once the end is found; quoted fields jump straight to
//    the next quote with indexOf. A field costs one string allocation
//    instead of one per character.
//  - The field readers write their result (value, how it ended, how many
//    characters were kept) into shared variables instead of allocating a
//    result object per field, which keeps garbage collection low.
//  - Doubled quotes, CR/LF inside quotes, junk after a closing quote and
//    stray CRs are handled on paths that only run when such a thing
//    actually appears (rare in practice).
//  - Errors are recorded with the line the record starts on and the row
//    index the record takes, exactly as csv-reader does.
//
// No dependencies, no state kept between calls, deterministic.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null for the header). Every error reports these two.
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters
  // the read kept. The readers below write these instead of returning a
  // fresh object per field.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  // Read unquoted characters onto `init`, up to the next comma or line
  // break. A CR not followed by LF is dropped and reported as stray_cr.
  function readUnquoted(init) {
    const initLen = init.length;
    let start = pos;
    let value = init;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        // comma
        value += text.slice(start, pos);
        pos += 1;
        fValue = value;
        fEnded = COMMA;
        fAdded = value.length - initLen;
        return;
      }
      if (c === 10) {
        // LF
        value += text.slice(start, pos);
        pos += 1;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = value.length - initLen;
        return;
      }
      if (c === 13) {
        // CR
        if (text.charCodeAt(pos + 1) === 10) {
          value += text.slice(start, pos);
          pos += 2;
          line += 1;
          fValue = value;
          fEnded = LINE_BREAK;
          fAdded = value.length - initLen;
          return;
        }
        // A lone CR: dropped, reported, and the field goes on after it.
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        value += text.slice(start, pos);
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    value += text.slice(start, pos);
    fValue = value;
    fEnded = END;
    fAdded = value.length - initLen;
  }

  // Read a quoted field whose opening quote is at pos. The closing quote
  // is jumped to with indexOf; doubled quotes and line breaks inside are
  // handled as they are met.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let start = pos;
    let value = '';
    while (true) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      const l = text.indexOf('\n', pos);
      const r = text.indexOf('\r', pos);
      if ((l !== -1 && l < q) || (r !== -1 && r < q)) {
        // A line break sits inside the quoted field before the next quote:
        // it reads as one LF. Handle it and carry on looking for the quote.
        let b = -1;
        if (l !== -1 && (r === -1 || l < r)) b = l;
        else b = r;
        value += text.slice(start, b) + '\n';
        line += 1;
        if (text.charCodeAt(b) === 13 && text.charCodeAt(b + 1) === 10) pos = b + 2;
        else pos = b + 1;
        start = pos;
        continue;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one literal quote.
        value += text.slice(start, q) + '"';
        pos = q + 2;
        start = pos;
        continue;
      }
      value += text.slice(start, q);
      pos = q + 1;
      if (pos >= n) {
        fValue = value;
        fEnded = END;
        fAdded = 0;
        return;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fValue = value;
        fEnded = COMMA;
        fAdded = 0;
        return;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = 0;
        return;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = 0;
        return;
      }
      // What follows the closing quote is appended as it stands, up to
      // the next comma or line break.
      readUnquoted(value);
      if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
