/**
 * A small, dependency-free renderer for the subset of Markdown an AI
 * assistant's responses actually use: fenced code blocks, inline code,
 * bold/italic, headers, links, and lists. TRACE's frontend has no
 * Markdown dependency today (just Next/React/Tailwind/React Flow) —
 * react-markdown's own dependency tree (unified/remark/rehype, ~15+
 * transitive packages) is a disproportionate addition for this, so
 * this file exists instead. It does not handle tables, images, nested
 * blockquotes, or footnotes — if the assistant's output ever needs
 * those, this is the file to extend or finally justify the dependency.
 */
import { Fragment, type ReactNode } from "react";

interface Segment {
  kind: "code" | "text";
  lang?: string;
  content: string;
}

function splitCodeFences(markdown: string): Segment[] {
  const segments: Segment[] = [];
  const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(markdown))) {
    if (match.index > lastIndex) segments.push({ kind: "text", content: markdown.slice(lastIndex, match.index) });
    segments.push({ kind: "code", lang: match[1] || undefined, content: match[2] });
    lastIndex = fenceRe.lastIndex;
  }
  if (lastIndex < markdown.length) segments.push({ kind: "text", content: markdown.slice(lastIndex) });
  return segments;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const inlineRe = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = inlineRe.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      nodes.push(<code key={key++} className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[11px] text-sky-300">{match[1]}</code>);
    } else if (match[2] !== undefined) {
      nodes.push(<strong key={key++} className="font-semibold text-slate-100">{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      nodes.push(<em key={key++}>{match[3]}</em>);
    } else if (match[4] !== undefined && match[5] !== undefined) {
      nodes.push(
        <a key={key++} href={match[5]} target="_blank" rel="noreferrer" className="text-sky-400 underline hover:text-sky-300">
          {match[4]}
        </a>,
      );
    }
    lastIndex = inlineRe.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function renderTextBlock(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let listBuffer: { ordered: boolean; items: string[] } | null = null;
  let paragraphBuffer: string[] = [];
  let blockKey = 0;

  function flushParagraph() {
    if (paragraphBuffer.length === 0) return;
    blocks.push(<p key={`${keyPrefix}-p-${blockKey++}`} className="whitespace-pre-wrap">{renderInline(paragraphBuffer.join(" "))}</p>);
    paragraphBuffer = [];
  }

  function flushList() {
    if (!listBuffer) return;
    const Tag = listBuffer.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`${keyPrefix}-list-${blockKey++}`} className={listBuffer.ordered ? "ml-5 list-decimal space-y-0.5" : "ml-5 list-disc space-y-0.5"}>
        {listBuffer.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
      </Tag>,
    );
    listBuffer = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const headerMatch = /^(#{1,4})\s+(.*)$/.exec(line);
    const unorderedMatch = /^[-*]\s+(.*)$/.exec(line);
    const orderedMatch = /^\d+\.\s+(.*)$/.exec(line);

    if (headerMatch) {
      flushParagraph();
      flushList();
      const level = headerMatch[1].length;
      const sizes: Record<number, string> = { 1: "text-base font-semibold", 2: "text-sm font-semibold", 3: "text-sm font-medium", 4: "text-xs font-medium" };
      blocks.push(<p key={`${keyPrefix}-h-${blockKey++}`} className={`${sizes[level] ?? sizes[4]} text-slate-100`}>{renderInline(headerMatch[2])}</p>);
    } else if (unorderedMatch) {
      flushParagraph();
      if (!listBuffer || listBuffer.ordered) { flushList(); listBuffer = { ordered: false, items: [] }; }
      listBuffer.items.push(unorderedMatch[1]);
    } else if (orderedMatch) {
      flushParagraph();
      if (!listBuffer || !listBuffer.ordered) { flushList(); listBuffer = { ordered: true, items: [] }; }
      listBuffer.items.push(orderedMatch[1]);
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraphBuffer.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function MarkdownLite({ content }: { content: string }) {
  const segments = splitCodeFences(content);
  return (
    <div className="space-y-2 text-sm leading-relaxed text-slate-200">
      {segments.map((segment, i) =>
        segment.kind === "code" ? (
          <div key={i} className="overflow-hidden rounded-md border border-slate-800">
            {segment.lang && (
              <div className="border-b border-slate-800 bg-slate-900 px-3 py-1 text-[10px] uppercase tracking-wide text-slate-500">{segment.lang}</div>
            )}
            <pre className="overflow-x-auto bg-slate-950 p-3 font-mono text-[12px] text-slate-300">
              <code>{segment.content.replace(/\n$/, "")}</code>
            </pre>
          </div>
        ) : (
          <Fragment key={i}>{renderTextBlock(segment.content, `s${i}`)}</Fragment>
        ),
      )}
    </div>
  );
}
