import {
  CalendarCheck,
  ChartLine,
  Gauge,
  Globe,
  Image as ImageIcon,
  Mail,
  MapPin,
  Palette,
  Search,
  Share2,
  ShoppingBag,
  Smartphone,
  Sparkles,
} from "lucide-react";
import type { BlockOf, PROPOSAL_ICONS } from "@/domain/expose/schema";
import { Section } from "../section";

const icons: Record<(typeof PROPOSAL_ICONS)[number], typeof Globe> = {
  website: Globe,
  mobile: Smartphone,
  search: Search,
  map: MapPin,
  social: Share2,
  brand: Palette,
  photo: ImageIcon,
  speed: Gauge,
  calendar: CalendarCheck,
  shop: ShoppingBag,
  mail: Mail,
  chart: ChartLine,
};

export function ProposalBlock({ block }: { block: BlockOf<"proposal"> }) {
  return (
    <Section id={block.id} type="proposal" title={block.title} intro={block.intro} wide>
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {block.items.map((item, index) => {
          const Icon = item.icon ? icons[item.icon] : Sparkles;
          return (
            <li
              key={index}
              className="grid content-start gap-4 rounded-xl border border-border bg-surface p-6 shadow-sm"
            >
              <span className="grid size-12 place-items-center rounded-lg bg-accent-soft text-accent-soft-foreground">
                <Icon aria-hidden className="size-6" />
              </span>
              <h3 className="text-xl font-semibold">{item.title}</h3>
              <p className="text-foreground-muted">{item.description}</p>
              <p className="mt-auto border-t border-border pt-4 font-medium">
                <span className="text-accent">Ihr Nutzen: </span>
                {item.benefit}
              </p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
