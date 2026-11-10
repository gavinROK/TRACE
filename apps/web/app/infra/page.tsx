import { redirect } from "next/navigation";

/** TRACE v0.2 unified the infra dashboard into the root route — this
 * page only exists so old links/bookmarks to /infra keep working. */
export default function InfraRedirectPage() {
  redirect("/");
}
