//! DOCX raw-text extraction — the equivalent of `mammoth.extractRawText`,
//! which the TypeScript `/api/triage` route uses: every paragraph is emitted
//! followed by a blank line (`"\n\n"`, including after the last one), tabs
//! and line breaks preserved.

use quick_xml::events::Event;
use quick_xml::Reader;
use std::io::{Cursor, Read};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DocxError {
    #[error("not a valid DOCX package: {0}")]
    Zip(String),
    #[error("word/document.xml missing")]
    MissingDocument,
    #[error("document.xml is not valid XML: {0}")]
    Xml(String),
}

/// Extract the raw text of a `.docx` (WordprocessingML) package.
pub fn extract_raw_text(bytes: &[u8]) -> Result<String, DocxError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| DocxError::Zip(e.to_string()))?;
    let mut xml = String::new();
    {
        let mut file = archive.by_name("word/document.xml").map_err(|_| DocxError::MissingDocument)?;
        file.read_to_string(&mut xml).map_err(|e| DocxError::Zip(e.to_string()))?;
    }
    let mut reader = Reader::from_str(&xml);
    let mut paragraphs: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_paragraph = false;
    let mut in_text = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match local_name(e.name().as_ref()) {
                "p" => {
                    in_paragraph = true;
                    current.clear();
                }
                "t" => in_text = true,
                "tab" => current.push('\t'),
                "br" | "cr" => current.push('\n'),
                _ => {}
            },
            Ok(Event::Empty(e)) => match local_name(e.name().as_ref()) {
                "tab" => current.push('\t'),
                "br" | "cr" => current.push('\n'),
                "p" => paragraphs.push(String::new()),
                _ => {}
            },
            Ok(Event::End(e)) => match local_name(e.name().as_ref()) {
                "p" => {
                    if in_paragraph {
                        paragraphs.push(std::mem::take(&mut current));
                    }
                    in_paragraph = false;
                }
                "t" => in_text = false,
                _ => {}
            },
            Ok(Event::Text(t)) => {
                if in_text {
                    let s = t.xml_content().map_err(|e| DocxError::Xml(e.to_string()))?;
                    current.push_str(&s);
                }
            }
            Ok(Event::GeneralRef(r)) => {
                if in_text {
                    if let Some(c) = r.resolve_char_ref().map_err(|e| DocxError::Xml(e.to_string()))? {
                        current.push(c);
                    } else {
                        let name = r.decode().map_err(|e| DocxError::Xml(e.to_string()))?;
                        match name.as_ref() {
                            "lt" => current.push('<'),
                            "gt" => current.push('>'),
                            "amp" => current.push('&'),
                            "apos" => current.push('\''),
                            "quot" => current.push('"'),
                            other => return Err(DocxError::Xml(format!("unknown entity &{other};"))),
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => return Err(DocxError::Xml(e.to_string())),
        }
    }
    let mut out = String::new();
    for p in paragraphs {
        out.push_str(&p);
        out.push_str("\n\n");
    }
    Ok(out)
}

fn local_name(qname: &[u8]) -> &str {
    let s = std::str::from_utf8(qname).unwrap_or("");
    s.rsplit(':').next().unwrap_or(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_docx() {
        assert!(extract_raw_text(b"PK garbage").is_err());
        assert!(extract_raw_text(b"").is_err());
    }
}
