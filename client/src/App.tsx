import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import NotFound from "@/pages/not-found";
import SearchPage from "@/pages/search";
import LibraryPage from "@/pages/library";
import UploadPage from "@/pages/upload";
import OpponentPage from "@/pages/opponent";
import DocumentPage from "@/pages/document";

function Router() {
  return (
    <Switch>
      <Route path="/" component={SearchPage} />
      <Route path="/library" component={LibraryPage} />
      <Route path="/upload" component={UploadPage} />
      <Route path="/opponent" component={OpponentPage} />
      <Route path="/documents/:id" component={DocumentPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

const sidebarStyle = {
  "--sidebar-width": "16rem",
  "--sidebar-width-icon": "3rem",
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={sidebarStyle as React.CSSProperties}>
          <div className="flex h-screen w-full">
            <AppSidebar />
            <div className="flex flex-col flex-1 min-w-0">
              <header className="flex items-center gap-2 p-3 border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <h1 className="text-sm font-semibold text-muted-foreground tracking-wide uppercase">PF Vault</h1>
              </header>
              <main className="flex-1 overflow-auto">
                <Router />
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
