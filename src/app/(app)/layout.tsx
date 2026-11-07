import { CompanyProvider } from "@/components/company-context";
import { PermissionsProvider } from "@/components/permissions/permissions-context";
import { Sidebar } from "@/components/layout/sidebar";
import { TopTabBar } from "@/components/layout/top-tab-bar";
import { MobileNavProvider } from "@/components/layout/mobile-nav-context";
import { PageActionsProvider } from "@/components/layout/page-actions";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PermissionsProvider>
      <CompanyProvider>
        <MobileNavProvider>
          <PageActionsProvider>
          <div className="flex min-h-screen flex-col bg-background">
            <TopTabBar />
            <div className="flex flex-1">
              <Sidebar />
              <div className="min-w-0 flex-1">{children}</div>
            </div>
          </div>
          </PageActionsProvider>
        </MobileNavProvider>
      </CompanyProvider>
    </PermissionsProvider>
  );
}
