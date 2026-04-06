import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { Check, Copy } from "lucide-react"
import { useState, type ReactNode } from "react"

interface Props {
  content: string
  className?: string
}

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const code = String(children ?? "").replace(/\n$/, "")
  const match = /language-(\w+)/.exec(className || "")
  const lang = match?.[1]

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="relative group my-3 rounded-xl overflow-hidden border border-border bg-slate-100 dark:bg-[#0d1117]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-foreground/4 border-b border-border">
        <span className="text-[11px] text-muted-foreground font-mono">{lang ?? "code"}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
        >
          {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code className={className}>{code}</code>
      </pre>
    </div>
  )
}

export function MarkdownRenderer({ content, className = "" }: Props) {
  return (
    <div className={`prose-chat ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className, children, ...props }) {
            const isBlock = !!className
            if (isBlock) {
              return <CodeBlock className={className}>{children}</CodeBlock>
            }
            return (
              <code
                {...props}
                className="px-1.5 py-0.5 rounded bg-foreground/8 text-[0.85em] font-mono text-primary/90"
              >
                {children}
              </code>
            )
          },
          pre({ children }) {
            return <>{children}</>
          },
          p({ children }) {
            return <p className="mb-3 last:mb-0 leading-relaxed text-foreground/90">{children}</p>
          },
          h1({ children }) {
            return <h1 className="text-xl font-bold mb-3 text-foreground">{children}</h1>
          },
          h2({ children }) {
            return <h2 className="text-lg font-bold mb-2 text-foreground">{children}</h2>
          },
          h3({ children }) {
            return <h3 className="text-base font-semibold mb-2 text-foreground">{children}</h3>
          },
          ul({ children }) {
            return <ul className="mb-3 ml-5 space-y-1 list-disc text-foreground/90">{children}</ul>
          },
          ol({ children }) {
            return <ol className="mb-3 ml-5 space-y-1 list-decimal text-foreground/90">{children}</ol>
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-primary/50 pl-4 my-3 text-muted-foreground italic">
                {children}
              </blockquote>
            )
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3 rounded-lg border border-border">
                <table className="w-full text-sm">{children}</table>
              </div>
            )
          },
          thead({ children }) {
            return <thead className="bg-foreground/5">{children}</thead>
          },
          th({ children }) {
            return <th className="px-4 py-2 text-left font-semibold text-foreground border-b border-border">{children}</th>
          },
          td({ children }) {
            return <td className="px-4 py-2 text-foreground/80 border-b border-border/50">{children}</td>
          },
          a({ children, href }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
              >
                {children}
              </a>
            )
          },
          hr() {
            return <hr className="my-4 border-border" />
          },
          strong({ children }) {
            return <strong className="font-semibold text-foreground">{children}</strong>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
