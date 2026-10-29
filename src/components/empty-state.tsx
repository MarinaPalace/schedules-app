import Link from "next/link";
import { Icon } from "@/components/icons";

/** What an empty page is for, why it matters, and the one action that fills it. */
export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text: string; action?: { href: string; label: string } }) {
  return (
    <div className="card flex flex-col items-center gap-3 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-700">
        <Icon name={icon} />
      </span>
      <h2 className="font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-gray-600">{text}</p>
      {action && (
        <Link href={action.href} className="btn btn-primary min-h-11">
          {action.label}
        </Link>
      )}
    </div>
  );
}
