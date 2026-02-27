import Link from "next/link";
import { ErrorState } from "@/components/blocks/ErrorState";
import { paths } from "@/lib/routes/paths";

export default function NotFoundPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <ErrorState status={404} />
      <div className="mt-4 text-sm">
        <Link href={paths.login} className="text-blue-700 hover:underline">
          Back to login
        </Link>
      </div>
    </main>
  );
}
