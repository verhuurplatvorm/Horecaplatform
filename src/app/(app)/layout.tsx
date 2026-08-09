import { CompanyProvider } from "@/components/company-context";
import { PermissionsProvider } from "@/components/permissions/permissions-context";
import { Sidebar } from "@/components/layout/sidebar";
import { TopTabBar } from "@/components/layout/top-tab-bar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PermissionsProvider>
      <CompanyProvider>
        <div className="flex min-h-screen flex-col bg-background">
          <TopTabBar />
          <div className="flex flex-1">
            <Sidebar />
            <div className="flex-1">{children}</div>
          </div>
        </div>
      </CompanyProvider>
    </PermissionsProvider>
  );
}
