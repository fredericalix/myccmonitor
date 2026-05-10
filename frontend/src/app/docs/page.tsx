import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import {
  ArrowSquareOut,
  CaretLeft,
  Factory,
  GithubLogo,
} from "@phosphor-icons/react/dist/ssr";
import { MarkdownProse } from "@/components/forge/MarkdownProse";

export const metadata = {
  title: "Documentation — myccmonitor",
  description: "User guide for myccmonitor — Forge Mécanique edition.",
};

// Read the bundled markdown at request time. The file is copied from
// ../../docs/USER_GUIDE.md at build time by `frontend/scripts/copy-docs.mjs`
// so that it lives inside frontend/ (the only directory CC ships).
async function readUserGuide(): Promise<string> {
  const file = path.join(process.cwd(), "src/_docs/USER_GUIDE.md");
  return fs.readFile(file, "utf-8");
}

export default async function DocsPage() {
  let content: string;
  try {
    content = await readUserGuide();
  } catch (err) {
    content = `# Documentation\n\nThe user guide could not be loaded.\n\n\`\`\`\n${
      err instanceof Error ? err.message : String(err)
    }\n\`\`\`\n\nMake sure \`frontend/scripts/copy-docs.mjs\` ran before \`next build\`.`;
  }

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-[var(--forge-rim-dim)] bg-forge-panel">
        <div className="mx-auto max-w-4xl px-6 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[1px] text-[var(--forge-text-muted)] hover:text-[var(--forge-text-accent)]"
          >
            <CaretLeft size={12} weight="bold" />
            Back to entrance
          </Link>
          <span className="ml-auto inline-flex items-center gap-2 font-bold uppercase tracking-[1px] text-[12px] text-[var(--forge-text-accent)]">
            <Factory weight="fill" size={14} />
            Documentation
          </span>
          <a
            href="https://github.com/fredericalix/myccmonitor"
            target="_blank"
            rel="noopener noreferrer"
            title="View source on GitHub"
            className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[1px] text-[var(--forge-text-muted)] hover:text-[var(--forge-text-accent)]"
          >
            <GithubLogo weight="duotone" size={14} />
            <ArrowSquareOut size={10} weight="bold" />
          </a>
        </div>
      </header>

      <article className="mx-auto max-w-4xl px-6 py-10">
        <MarkdownProse markdown={content} />

        <footer className="mt-16 pt-6 border-t border-[var(--forge-rim-dim)] text-[10px] uppercase tracking-[1.5px] text-[var(--forge-text-dim)] font-mono flex items-center justify-between">
          <span>
            source · <code className="text-[var(--forge-text-muted)]">docs/USER_GUIDE.md</code>
          </span>
          <span className="hidden sm:block">Forge Mécanique edition</span>
        </footer>
      </article>
    </main>
  );
}
