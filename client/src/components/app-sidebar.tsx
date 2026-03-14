import { FileSearch, Bookmark, CloudUpload, Swords, BookMarked } from "lucide-react";
import { useLocation, Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Search", url: "/", icon: FileSearch },
  { title: "Evidence Library", url: "/library", icon: Bookmark },
  { title: "Upload Files", url: "/upload", icon: CloudUpload },
  { title: "Opponent Case", url: "/opponent", icon: Swords },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarContent>
        <div className="p-4 pb-3 border-b border-sidebar-border/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-sm">
              <BookMarked className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight">PF Vault</p>
              <p className="text-xs text-muted-foreground">Evidence Manager</p>
            </div>
          </div>
        </div>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2">Nav</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5 px-2">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild data-active={location === item.url} className="transition-all duration-200">
                    <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                      <item.icon className="w-4 h-4 shrink-0" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
