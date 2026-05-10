import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  h1: ({ children, ...rest }) => (
    <h1
      className="font-serif italic text-[34px] leading-[1.1] tracking-tight text-[var(--forge-text-accent)] mt-2 mb-4"
      {...rest}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...rest }) => (
    <h2
      className="mt-12 mb-3 pb-2 border-b border-[var(--forge-rim-dim)] text-[18px] font-bold uppercase tracking-[1.5px] text-[var(--forge-text-accent)] flex items-center gap-3"
      {...rest}
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--copper-glow)] shadow-[0_0_8px_var(--copper-glow)]" />
      {children}
    </h2>
  ),
  h3: ({ children, ...rest }) => (
    <h3
      className="mt-8 mb-2 text-[12px] font-bold uppercase tracking-[1.2px] text-[var(--forge-text)]"
      {...rest}
    >
      {children}
    </h3>
  ),
  h4: ({ children, ...rest }) => (
    <h4
      className="mt-6 mb-2 text-[12px] font-semibold tracking-[0.5px] text-[var(--forge-text)]"
      {...rest}
    >
      {children}
    </h4>
  ),
  p: ({ children, ...rest }) => (
    <p className="my-3 text-[14px] leading-[1.7] text-[var(--forge-text)]" {...rest}>
      {children}
    </p>
  ),
  a: ({ children, href, ...rest }) => (
    <a
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
      className="text-[var(--copper-glow-strong)] underline decoration-[var(--copper-glow)]/50 underline-offset-2 hover:decoration-[var(--copper-glow)] hover:text-[var(--forge-text-accent)]"
      {...rest}
    >
      {children}
    </a>
  ),
  ul: ({ children, ...rest }) => (
    <ul className="my-3 ml-5 list-disc text-[14px] leading-[1.7] text-[var(--forge-text)] marker:text-[var(--copper-glow)]" {...rest}>
      {children}
    </ul>
  ),
  ol: ({ children, ...rest }) => (
    <ol className="my-3 ml-5 list-decimal text-[14px] leading-[1.7] text-[var(--forge-text)] marker:text-[var(--copper-glow)]" {...rest}>
      {children}
    </ol>
  ),
  li: ({ children, ...rest }) => (
    <li className="my-1" {...rest}>
      {children}
    </li>
  ),
  blockquote: ({ children, ...rest }) => (
    <blockquote
      className="my-4 border-l-2 border-[var(--copper-glow)] bg-[var(--forge-floor-deep)]/50 pl-4 py-2 italic text-[var(--forge-text-muted)]"
      {...rest}
    >
      {children}
    </blockquote>
  ),
  code: ({ children, className, ...rest }) => {
    const inline = !className;
    if (inline) {
      return (
        <code
          className="rounded-[3px] border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--copper-glow-strong)]"
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  },
  pre: ({ children, ...rest }) => (
    <pre
      className="my-4 overflow-x-auto rounded-[6px] border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)] p-4 font-mono text-[12px] leading-[1.55] text-[var(--forge-text)]"
      {...rest}
    >
      {children}
    </pre>
  ),
  table: ({ children, ...rest }) => (
    <div className="my-4 overflow-x-auto rounded-[6px] border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)]/40">
      <table className="min-w-full text-[12px] text-[var(--forge-text)]" {...rest}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...rest }) => (
    <thead className="bg-[var(--forge-machine-bottom)] text-[var(--forge-text-accent)]" {...rest}>
      {children}
    </thead>
  ),
  th: ({ children, ...rest }) => (
    <th
      className="px-3 py-2 text-left font-bold uppercase tracking-[0.5px] text-[10px] border-b border-[var(--forge-rim-dim)]"
      {...rest}
    >
      {children}
    </th>
  ),
  td: ({ children, ...rest }) => (
    <td className="px-3 py-2 border-t border-[var(--forge-rim-dim)]/40 align-top" {...rest}>
      {children}
    </td>
  ),
  hr: () => (
    <hr aria-hidden className="my-8 h-px border-0 bg-gradient-to-r from-[var(--forge-rim)] via-[var(--copper-glow)]/40 to-transparent" />
  ),
  strong: ({ children, ...rest }) => (
    <strong className="font-semibold text-[var(--forge-text-accent)]" {...rest}>
      {children}
    </strong>
  ),
  em: ({ children, ...rest }) => (
    <em className="italic text-[var(--forge-text)]" {...rest}>
      {children}
    </em>
  ),
};

export function MarkdownProse({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {markdown}
    </ReactMarkdown>
  );
}
