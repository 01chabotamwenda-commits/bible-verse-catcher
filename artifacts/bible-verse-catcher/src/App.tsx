import { Switch, Route, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";

const queryClient = new QueryClient();

// Electron loads from file:// — pathname is a full filesystem path so normal
// location-based routing never matches "/". Use hash routing instead, which
// reads from window.location.hash and works fine with file:// protocol.
const isFileProtocol =
  typeof window !== 'undefined' && window.location.protocol === 'file:';

const routerBase = (() => {
  if (isFileProtocol) return '';
  const raw = import.meta.env.BASE_URL ?? '';
  // Treat './', '.', '/' or empty as no base (Electron local server or root deploy)
  if (!raw || raw === '/' || raw === '.' || raw === './') return '';
  return raw.replace(/\/$/, '');
})();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div className="min-h-screen bg-background text-foreground">
            <WouterRouter
              hook={isFileProtocol ? useHashLocation : undefined}
              base={routerBase}
            >
              <Router />
            </WouterRouter>
            <Toaster />
          </div>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
