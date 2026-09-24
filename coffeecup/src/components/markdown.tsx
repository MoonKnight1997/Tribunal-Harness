/**
 * Minimal, dependency-free Markdown renderer for generated documents.
 * Supports headings, paragraphs, bullet/numbered lists, bold, italics,
 * horizontal rules and links. All text is escaped; no raw HTML passes through.
 */

import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
    const out: ReactNode[] = [];
    const re = /(\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const token = m[0];
        if (token.startsWith("**")) out.push(<strong key={`${key}-b${i}`}>{token.slice(2, -2)}</strong>);
        else if (token.startsWith("_")) out.push(<em key={`${key}-i${i}`}>{token.slice(1, -1)}</em>);
        else {
            const label = token.slice(1, token.indexOf("]"));
            out.push(
                <a key={`${key}-a${i}`} href={m[2]} target="_blank" rel="noopener noreferrer">
                    {label}
                </a>,
            );
        }
        last = m.index + token.length;
        i++;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

export function Markdown({ text }: { text: string }) {
    const lines = text.replace(/\r/g, "").split("\n");
    const blocks: ReactNode[] = [];
    let list: { type: "ul" | "ol"; items: string[] } | null = null;
    let para: string[] = [];
    const flushPara = () => {
        if (para.length) {
            blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), `p${blocks.length}`)}</p>);
            para = [];
        }
    };
    const flushList = () => {
        if (list) {
            const items = list.items.map((it, i) => <li key={i}>{inline(it, `li${blocks.length}-${i}`)}</li>);
            blocks.push(list.type === "ul" ? <ul key={`l${blocks.length}`}>{items}</ul> : <ol key={`l${blocks.length}`}>{items}</ol>);
            list = null;
        }
    };
    for (const raw of lines) {
        const line = raw.trimEnd();
        const h = line.match(/^(#{1,3})\s+(.*)$/);
        const ul = line.match(/^\s*[-*]\s+(.*)$/);
        const ol = line.match(/^\s*\d+\.\s+(.*)$/);
        if (h) {
            flushPara();
            flushList();
            const level = h[1].length;
            const content = inline(h[2], `h${blocks.length}`);
            blocks.push(level === 1 ? <h1 key={`h${blocks.length}`}>{content}</h1> : level === 2 ? <h2 key={`h${blocks.length}`}>{content}</h2> : <h3 key={`h${blocks.length}`}>{content}</h3>);
        } else if (line === "---") {
            flushPara();
            flushList();
            blocks.push(<hr key={`hr${blocks.length}`} />);
        } else if (ul || ol) {
            flushPara();
            const type = ul ? "ul" : "ol";
            const item = (ul ?? ol)![1];
            if (!list || list.type !== type) {
                flushList();
                list = { type, items: [] };
            }
            list.items.push(item);
        } else if (line.trim() === "") {
            flushPara();
            flushList();
        } else {
            flushList();
            para.push(line.trim());
        }
    }
    flushPara();
    flushList();
    return <div className="prose">{blocks}</div>;
}
