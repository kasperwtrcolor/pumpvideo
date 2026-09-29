import { redirect } from "next/navigation";

/**
 * Portfolio now lives on the account page, alongside wallet management.
 * Kept as a redirect so existing links and bookmarks keep working.
 */
export default function PortfolioPage() {
  redirect("/account");
}
