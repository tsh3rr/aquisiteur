import { Fragment } from "react";
import { parseRichText, type Inline } from "@/domain/expose/rich-text";
import { cn } from "@/lib/cn";

function renderInline(nodes: Inline[]) {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "break":
        return <br key={index} />;
      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "link":
        return (
          <a
            key={index}
            href={node.href}
            className="font-medium text-accent underline underline-offset-4"
            {...(node.href.startsWith("http")
              ? { rel: "noopener noreferrer", target: "_blank" }
              : {})}
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

/** Renders the exposé Markdown subset as React elements, never as HTML. */
export function RichText({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn("grid gap-4", className)}>
      {parseRichText(source).map((block, index) =>
        block.kind === "paragraph" ? (
          <p key={index}>{renderInline(block.children)}</p>
        ) : (
          <ul key={index} className="grid list-disc gap-1.5 pl-5 marker:text-accent">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{renderInline(item)}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
