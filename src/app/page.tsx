import { redirect } from "next/navigation";
import { LandingPage } from "./components/LandingPage";

interface HomePageProps {
  searchParams?: {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  };
}

export default function HomePage({ searchParams }: HomePageProps) {
  // Cognito sometimes returns to the site root: forward the code to the auth callback.
  if (searchParams?.code || searchParams?.error) {
    const params = new URLSearchParams();
    if (searchParams.code) params.set("code", searchParams.code);
    if (searchParams.state) params.set("state", searchParams.state);
    if (searchParams.error) params.set("error", searchParams.error);
    if (searchParams.error_description) params.set("error_description", searchParams.error_description);
    redirect(`/api/ac/auth/callback?${params.toString()}`);
  }

  // Everyone sees the landing page; signed-in visitors get their account panel and enrollment buttons on it.
  return <LandingPage />;
}
