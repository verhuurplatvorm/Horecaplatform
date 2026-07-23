import { CompanyProvider } from "@/components/company-context";
import { Sidebar } from "@/components/layout/sidebar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CompanyProvider>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1">{children}</div>
      </div>
    </CompanyProvider>
  );
}
