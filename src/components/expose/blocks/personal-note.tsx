import type { BlockOf } from "@/domain/expose/schema";
import { OwnerBadge } from "../owner";
import { resolveFile, resolveImage, type RenderContext } from "../render-context";
import { RichText } from "../rich-text";
import { Section } from "../section";

export function PersonalNoteBlock({
  block,
  context,
}: {
  block: BlockOf<"personal_note">;
  context: RenderContext;
}) {
  const video = block.video;
  const videoSrc = video ? resolveFile(video.src, context) : null;
  const captions = video ? resolveFile(video.captions, context) : null;
  const poster = video ? resolveImage(video.poster, context) : null;
  return (
    <Section
      id={block.id}
      type="personal_note"
      title={block.title ?? "Eine persönliche Nachricht"}
      hiddenTitle={!block.title}
    >
      <div className="grid gap-6 rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-10">
        <RichText source={block.body} className="text-lg leading-relaxed sm:text-xl" />
        {video && videoSrc && captions ? (
          // Captions are mandatory (§7.2); the file is required by the schema.
          <video
            controls
            preload="none"
            playsInline
            poster={poster?.src}
            className="aspect-video w-full rounded-lg bg-surface-sunken"
            aria-label={video.title}
          >
            <source
              src={videoSrc}
              type={video.src.endsWith(".webm") ? "video/webm" : "video/mp4"}
            />
            <track kind="captions" src={captions} srcLang="de" label="Deutsch" default />
          </video>
        ) : null}
        {block.showSignature ? <OwnerBadge context={context} /> : null}
      </div>
    </Section>
  );
}
