import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { Options } from "rehype-sanitize";

const schema: Options = {
  tagNames: [
    "p", "a", "ul", "ol", "li", "strong", "em", "code", "pre",
    "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr",
    "del", "ins", "sub", "sup", "abbr", "span",
  ],
  attributes: {
    "*": ["title", "id", "className"],
    a: ["href"],
  },
  strip: [],
};

// Source-level detection of constructs the rendered view excludes or makes
// inert (FR-075a). The renderer drops raw HTML and remote-loading elements
// and renders every non-fragment link target as inert text, so the notice
// must cover all of those. Detection runs on the raw Markdown source, never
// on the rendered DOM, and tolerates malformed input.

// CommonMark "tag" syntax: an opening or closing tag with optional attributes.
const HTML_TAG_RE =
  /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>/;

// Comments, processing instructions, and declarations are also raw HTML.
const HTML_SPECIAL_RE = /<!--[\s\S]*?(?:-->|$)|<\?[\s\S]*?(?:\?>|$)|<!\[?[A-Za-z][\s\S]*?>/;

// Inline links and images: [text](target) and ![alt](target), with the
// target either angle-bracketed or bare.
const INLINE_LINK_RE = /\[[^\]]*\]\(\s*(?:<[^>]*>|[^)\s][^)]*)\)/g;
const INLINE_IMAGE_RE = /!\[[^\]]*\]\(\s*(?:<[^>]*>|[^)\s][^)]*)\)/g;

// Reference-style links and images: [text][label], [text][], ![alt][label].
const REFERENCE_LINK_RE = /\[([^\]]+)\]\[([^\]]*)\]/g;
const REFERENCE_IMAGE_RE = /!\[[^\]]*\]\[([^\]]*)\]/g;

// Shortcut references: [label] or ![label] that resolve to a definition.
const SHORTCUT_LINK_RE = /(^|[^\\!])\[([^\]]+)\](?!\[|\()/g;
const SHORTCUT_IMAGE_RE = /!\[([^\]]+)\](?!\[|\()/g;

// Link definitions: [label]: <target> or [label]: target, with optional title.
const LINK_DEFINITION_RE =
  /^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]*)>|(\S+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/gm;

// Angle-bracket autolinks: <scheme:...>, <user@host>, <www....>. The www
// form only linkifies when the host passes the transform's isCorrectDomain
// check (at least two labels, the last two free of underscores and
// alphanumeric), so <www.example.com_> stays plain.
const AUTOLINK_URL_RE = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/;
const AUTOLINK_EMAIL_RE =
  /<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*>/;
const AUTOLINK_WWW_RE =
  /<www\.(?:[-\w]+\.)*(?:[A-Za-z0-9-]+\.)+[A-Za-z0-9-]+(?![-\w.])[^\s<>]*>/;

// GFM bare autolinks (remark-gfm linkifies these in plain text). The
// renderer runs two passes (micromark-extension-gfm-autolink-literal's
// tokenizer and mdast-util-gfm-autolink-literal's find-and-replace
// transform); a construct is a link if either pass accepts it, so the
// boundary classes mirror the union of the two: any character is allowed
// before www and URL autolinks except ASCII letters (and, for emails,
// digits and `/`), and only http/https schemes linkify. Bare emails require
// a dotted domain ending in a letter, matching what the renderer actually
// linkifies. Hosts are validated like the renderer: an underscore in the
// last two host labels prevents linkification (https://exa_mple.com and
// https://example.com_x stay plain), while a trailing underscore run that
// the tokenizer would strip as trail punctuation is still a link
// (https://example.com_! and www.example.com_! linkify).
const BARE_URL_RE =
  /(?:^|[^A-Za-z])(?:https?:\/\/)(?:(?:[A-Za-z0-9_-]+\.){2,}[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+)(?=$|[^A-Za-z0-9_.-]|\.(?![\w-])|_+[!"'*),.:;?~&_\]]*(?=$|[\s<]))/i;
const BARE_WWW_RE =
  /(?:^|(?!<)[\s\p{P}\p{S}])www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?=$|[^A-Za-z0-9_.-]|\.(?![\w-])|_+(?=$|[^A-Za-z0-9_-]))/iu;
const BARE_EMAIL_RE =
  /(?:^|[^A-Za-z0-9/])[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.[A-Za-z0-9_-]*[A-Za-z](?=$|[^A-Za-z0-9_.-]|\.(?![\w-]))/;

// Code spans and fenced code blocks render as plain text: nothing inside them
// becomes a link, an image, or raw HTML.
function stripCodeContent(markdown: string): string {
  return markdown
    .replace(/`{3,}[\s\S]*?(?:`{3,}|$)/g, "")
    .replace(/~{3,}[\s\S]*?(?:~{3,}|$)/g, "")
    .replace(/`[^`\n]*`/g, "");
}

function normalizeLabel(label: string | undefined): string {
  return (label ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function collectDefinitions(text: string): Map<string, string> {
  const definitions = new Map<string, string>();
  LINK_DEFINITION_RE.lastIndex = 0;
  for (const match of text.matchAll(LINK_DEFINITION_RE)) {
    definitions.set(normalizeLabel(match[1]), match[2] ?? match[3] ?? "");
  }
  return definitions;
}

function scan(
  pattern: RegExp,
  text: string,
  accept: (match: RegExpExecArray) => boolean,
): boolean {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (accept(match)) return true;
  }
  return false;
}

function linkDestination(link: string): string {
  const open = link.indexOf("(");
  const rest = link.slice(open + 1).trimStart();
  if (rest.startsWith("<")) {
    const close = rest.indexOf(">");
    return close === -1 ? rest.slice(1) : rest.slice(1, close);
  }
  return rest.split(/[\s)]/)[0] ?? "";
}

function hasNeutralizedContent(markdown: string): boolean {
  const text = stripCodeContent(markdown);

  if (HTML_TAG_RE.test(text) || HTML_SPECIAL_RE.test(text)) {
    return true;
  }

  const definitions = collectDefinitions(text);
  // Definition lines never render, so they cannot neutralize anything.
  const body = text.replace(LINK_DEFINITION_RE, "");
  const isExternalReference = (label: string | undefined): boolean => {
    const destination = definitions.get(normalizeLabel(label));
    return destination !== undefined && !destination.startsWith("#");
  };
  const isDefinedReference = (label: string | undefined): boolean =>
    definitions.has(normalizeLabel(label));

  const inlineLink = (match: RegExpExecArray): boolean =>
    !linkDestination(match[0]).startsWith("#");
  const referenceLink = (match: RegExpExecArray): boolean =>
    isExternalReference(match[2] !== "" ? match[2] : match[1]);
  const shortcutLink = (match: RegExpExecArray): boolean =>
    isExternalReference(match[2]);
  const referenceImage = (match: RegExpExecArray): boolean =>
    isDefinedReference(match[1]);
  const shortcutImage = (match: RegExpExecArray): boolean =>
    isDefinedReference(match[1]);

  if (
    scan(INLINE_LINK_RE, body, inlineLink) ||
    scan(INLINE_IMAGE_RE, body, () => true) ||
    scan(REFERENCE_LINK_RE, body, referenceLink) ||
    scan(REFERENCE_IMAGE_RE, body, referenceImage) ||
    scan(SHORTCUT_LINK_RE, body, shortcutLink) ||
    scan(SHORTCUT_IMAGE_RE, body, shortcutImage)
  ) {
    return true;
  }

  return (
    AUTOLINK_URL_RE.test(body) ||
    AUTOLINK_EMAIL_RE.test(body) ||
    AUTOLINK_WWW_RE.test(body) ||
    BARE_URL_RE.test(body) ||
    BARE_WWW_RE.test(body) ||
    BARE_EMAIL_RE.test(body)
  );
}

export interface SafeMarkdownProps {
  readonly markdown: string;
}

export function SafeMarkdown({ markdown }: SafeMarkdownProps) {
  const neutralized = useMemo(() => hasNeutralizedContent(markdown), [markdown]);

  return (
    <div className="safe-markdown">
      <div dir="auto">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeSanitize, schema]]}
          components={{
            a: ({ href, children, ...props }) => {
              if (href !== undefined && !href.startsWith("#")) {
                return <span {...props}>{children} ({href})</span>;
              }
              return <a href={href} {...props}>{children}</a>;
            },
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
      {neutralized ? (
        <p className="neutralization-notice" role="note">
          Potentially unsafe content was neutralised for safe display.
        </p>
      ) : null}
    </div>
  );
}
