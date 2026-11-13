import { CompanyProvider } from "@/components/company-context";
import { PermissionsProvider } from "@/components/permissions/permissions-context";
import { Sidebar } from "@/components/layout/sidebar";
import { TopTabBar } from "@/components/layout/top-tab-bar";
import { MobileNavProvider } from "@/components/layout/mobile-nav-context";
import { PageActionsProvider } from "@/components/layout/page-actions";
import { TouchArea } from "@/components/touch/touch-keyboard";
import { RecentBar } from "@/components/layout/recent-bar";

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
          {/* Touchscherm-modus + schermtoetsenbord op alle schermen */}
          <TouchArea>
          <div className="flex min-h-screen flex-col bg-background">
            <TopTabBar />
            <RecentBar />
            <div className="flex flex-1">
              <Sidebar />
              <div className="min-w-0 flex-1">{children}</div>
            </div>
          </div>
          </TouchArea>
          </PageActionsProvider>
        </MobileNavProvider>
      </CompanyProvider>
    </PermissionsProvider>
  );
}
